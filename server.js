import 'dotenv/config'
import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as paypal from './lib/paypal.js'
import * as ai from './lib/ai.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000
app.set('trust proxy', true)
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ==================== RULES (draft numbers from the PRD) ====================
const RULES = {
  commfyShare: 0.15, // Commfy keeps 15% of each community's slice
  deposit: 0.3, // organisers get 30% of their share when the brand approves
  minTurnout: 0.6, // the rest is released only if 60% of sign-ups check in
  perCheckIn: 100, // £1 (in pence) into the member's wallet per verified check-in
  minCashOut: 200, // members cash out from £2
  codeSeconds: 30, // the door code changes every 30 seconds
}

const COMMUNITIES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/communities.json'), 'utf8'))
const communityById = (id) => COMMUNITIES.find((c) => c.id === id)
const SECRET = process.env.CHECKIN_SECRET || crypto.randomBytes(16).toString('hex')

// Everything lives in memory: a restart is a clean demo.
const campaigns = new Map()
const wallets = new Map()

const gbp = (pence) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// Keyed with the server secret so a reference can't be traced back to an email by guessing.
const anon = (email) => `M-${crypto.createHmac('sha256', SECRET).update(email.toLowerCase()).digest('hex').slice(0, 6)}`

function ledger(c, row) {
  c.ledger.push({ at: new Date().toISOString(), mode: paypal.mode(), ...row })
}

function getCampaign(req, res) {
  const c = campaigns.get(req.params.id)
  if (!c) res.status(404).json({ error: 'Campaign not found. The demo resets when the server restarts; start a new request.' })
  return c
}

// ==================== BASICS ====================
app.get('/api/health', (req, res) => {
  res.json({ ok: true, paypal: paypal.isLive(), ai: ai.isLive() })
})

app.get('/api/config', (req, res) => {
  res.json({
    paypalMode: paypal.mode(),
    paypalClientId: paypal.isLive() ? process.env.PAYPAL_CLIENT_ID : null, // client id is public by design
    currency: paypal.CURRENCY,
    aiMode: ai.mode(),
    rules: RULES,
  })
})

app.get('/api/communities', (req, res) => res.json(COMMUNITIES))

// ==================== 1. REQUEST: AI picks communities + deal; server does the maths ====================
app.post('/api/campaigns', async (req, res) => {
  const { brand, goal, audience } = req.body || {}
  const budget = Math.round(Number(req.body?.budget))
  if (!brand || !audience || !(budget >= 100 && budget <= 10000)) {
    return res.status(400).json({ error: 'Add a brand name, an audience and a budget between 100 and 10,000.' })
  }
  if (!['awareness', 'product feedback'].includes(goal)) {
    return res.status(400).json({ error: 'This demo builds two goals end to end: awareness and product feedback.' })
  }
  const request = { brand: String(brand).slice(0, 60), goal, audience: String(audience).slice(0, 300), budget, currency: paypal.CURRENCY }
  const match = await ai.matchCommunities(request, COMMUNITIES)

  // Split the budget by the AI's weights. Pence throughout so every row adds up.
  const budgetPence = budget * 100
  const totalWeight = match.picks.reduce((s, p) => s + p.weight, 0)
  let left = budgetPence
  const plan = match.picks.map((p, i) => {
    const com = communityById(p.id)
    const slice = i === match.picks.length - 1 ? left : Math.round((budgetPence * p.weight) / totalWeight)
    left -= slice
    const commfy = Math.round(slice * RULES.commfyShare)
    const members = Math.min(com.regulars * RULES.perCheckIn, slice - commfy)
    const organiser = slice - commfy - members
    const deposit = Math.round(organiser * RULES.deposit)
    return {
      communityId: com.id, name: com.name, area: com.area, event: com.event, contact: com.organiser,
      reason: p.reason, weight: p.weight, signups: com.regulars,
      slice, commfy, members, organiser, deposit, rest: organiser - deposit,
    }
  })

  const id = crypto.randomBytes(5).toString('hex')
  const c = { id, createdAt: new Date().toISOString(), stage: 'proposed', request, match, plan, checkins: {}, ledger: [], paypal: {} }
  plan.forEach((p) => { c.checkins[p.communityId] = [] })
  campaigns.set(id, c)
  if (campaigns.size > 300) campaigns.delete(campaigns.keys().next().value)
  res.json(c)
})

app.get('/api/campaigns/:id', (req, res) => {
  const c = getCampaign(req, res)
  if (c) res.json(c)
})

// ==================== 2–3. APPROVE + HOLD: PayPal order (AUTHORIZE), then deposits ====================
app.post('/api/campaigns/:id/order', async (req, res) => {
  const c = getCampaign(req, res)
  if (!c) return
  if (c.stage !== 'proposed') return res.status(409).json({ error: 'This budget is already held.' })
  try {
    const order = await paypal.createOrder({
      pence: c.request.budget * 100,
      referenceId: c.id,
      description: `Turnout: ${c.request.brand} funds ${c.plan.length} community events (pays only for verified turnout)`,
    })
    c.paypal.orderId = order.id
    ledger(c, { step: 'Approve', what: 'Order created for the brand budget (intent AUTHORIZE)', from: c.request.brand, to: 'Commfy', pence: c.request.budget * 100, api: 'Orders v2: create', paypalId: order.id, status: order.status })
    res.json({ orderId: order.id })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

app.post('/api/campaigns/:id/authorize', async (req, res) => {
  const c = getCampaign(req, res)
  if (!c) return
  if (c.stage !== 'proposed') return res.status(409).json({ error: 'This budget is already held.' })
  // Only the order this server created for this campaign can be authorized.
  const orderId = c.paypal.orderId
  if (!orderId) return res.status(400).json({ error: 'No PayPal order to authorize.' })
  if (c.busy) return res.status(409).json({ error: 'Already talking to PayPal. One moment.' })
  c.busy = true
  try {
    const budget = c.request.budget * 100
    const { authorization } = await paypal.authorizeOrder(orderId, budget)
    c.paypal.authorizationId = authorization.id
    c.paypal.holdExpires = authorization.expiration_time
    ledger(c, { step: 'Hold', what: 'Brand approved; PayPal holds the full budget', from: c.request.brand, to: 'PayPal hold', pence: budget, api: 'Orders v2: authorize', paypalId: authorization.id, status: authorization.status })

    // PayPal rejects zero amounts, so a £0 deposit (tiny budgets) is skipped, not sent.
    const deposits = c.plan.filter((p) => p.deposit > 0)
    const depositTotal = deposits.reduce((s, p) => s + p.deposit, 0)
    c.paypal.captured = 0
    if (depositTotal > 0) {
      const cap = await paypal.captureAuthorization(authorization.id, depositTotal, { finalCapture: false, note: 'Turnout: organiser deposits' })
      c.paypal.captured = depositTotal
      ledger(c, { step: 'Hold', what: `Deposits captured from the hold (${RULES.deposit * 100}% of organiser shares)`, from: 'PayPal hold', to: 'Commfy', pence: depositTotal, api: 'Payments v2: capture (partial)', paypalId: cap.id, status: cap.status })

      const batch = await paypal.sendPayouts(
        deposits.map((p) => ({ email: p.contact.email, pence: p.deposit, note: `Deposit from ${c.request.brand} for ${p.event.title}`, ref: `${c.id}-dep-${p.communityId}`.slice(0, 63) })),
        { subject: `Your deposit from ${c.request.brand} is here`, batchRef: `${c.id}-deposits` },
      )
      deposits.forEach((p) => ledger(c, { step: 'Hold', what: `Deposit to ${p.name}`, from: 'Commfy', to: p.contact.email, pence: p.deposit, api: 'Payouts v1: batch', paypalId: batch.batchId, status: batch.status }))
    }
    c.stage = 'event'
    res.json(c)
  } catch (err) {
    ledger(c, { step: 'Hold', what: 'PayPal call failed', from: '', to: '', pence: 0, api: '', paypalId: '', status: `FAILED: ${err.message}` })
    res.status(502).json({ error: err.message })
  } finally {
    c.busy = false
  }
})

// ==================== 4. EVENT DAY: rotating door code + check-ins ====================
const windowNow = () => Math.floor(Date.now() / 1000 / RULES.codeSeconds)
const doorCode = (cid, eid, w) => crypto.createHmac('sha256', SECRET).update(`${cid}:${eid}:${w}`).digest('hex').slice(0, 6).toUpperCase()

app.get('/api/campaigns/:id/door/:eventId', (req, res) => {
  const c = getCampaign(req, res)
  if (!c) return
  const w = windowNow()
  const code = doorCode(c.id, req.params.eventId, w)
  const url = `${req.protocol}://${req.get('host')}/checkin.html?c=${c.id}&e=${req.params.eventId}&k=${code}`
  res.json({ code, url, secondsLeft: RULES.codeSeconds - (Math.floor(Date.now() / 1000) % RULES.codeSeconds) })
})

function distanceKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function walletFor(email) {
  const key = email.toLowerCase()
  if (!wallets.has(key)) {
    // Demo seed so a judge can reach the £2 cash-out with one check-in.
    wallets.set(key, { email: key, entries: [{ pence: 100, from: 'an earlier Turnout event (demo seed)', at: new Date().toISOString(), status: 'available' }], cashouts: [] })
  }
  return wallets.get(key)
}

function walletView(w) {
  const sum = (status) => w.entries.filter((e) => e.status === status).reduce((s, e) => s + e.pence, 0)
  return { email: w.email, available: sum('available'), pending: sum('pending'), cashedOut: sum('cashed'), entries: w.entries, cashouts: w.cashouts, minCashOut: RULES.minCashOut }
}

app.get('/api/campaigns/:id/event/:eventId', (req, res) => {
  const c = getCampaign(req, res)
  if (!c) return
  const p = c.plan.find((x) => x.communityId === req.params.eventId)
  if (!p) return res.status(404).json({ error: 'Event not found' })
  res.json({ brand: c.request.brand, goal: c.request.goal, stage: c.stage, deal: c.match.deal, brandQuestion: c.match.brandQuestion, community: p.name, event: p.event, checkedIn: c.checkins[p.communityId].length, signups: p.signups })
})

app.post('/api/checkin', (req, res) => {
  const { campaignId, eventId, code, email, belonging, answer, lat, lng } = req.body || {}
  const c = campaigns.get(campaignId)
  const p = c?.plan.find((x) => x.communityId === eventId)
  if (!c || !p) return res.status(404).json({ error: 'Event not found.' })
  if (c.stage !== 'event' || c.busy) return res.status(409).json({ error: c.stage === 'proposed' ? 'Check-in opens once the brand has approved.' : 'This event has closed.' })
  // The code on screen changes every 30s; a scanned code stays valid for about 2 minutes,
  // long enough to type an email and answer on a phone.
  const w = windowNow()
  const codeOk = [w, w - 1, w - 2, w - 3].some((x) => doorCode(c.id, eventId, x) === String(code || '').toUpperCase())
  if (!codeOk) return res.status(400).json({ error: 'That door code has expired. Scan the code on the screen again.' })
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Add the email you use for PayPal so your £1 can reach you.' })

  const ref = anon(email)
  const list = c.checkins[eventId]
  if (list.some((x) => x.member === ref)) return res.status(409).json({ error: 'You are already checked in to this event.', wallet: walletView(walletFor(email)) })

  const com = communityById(eventId)
  let location = 'not shared'
  if (Number.isFinite(lat) && Number.isFinite(lng)) location = distanceKm({ lat, lng }, com) <= 1 ? 'at venue' : 'away from venue'
  // £1 per check-in only up to the members' part of this event's budget,
  // so wallets never hold more than the final capture takes.
  const credited = list.length * RULES.perCheckIn < p.members
  const rating = [1, 2, 3, 4, 5].includes(Number(belonging)) ? Number(belonging) : null
  list.push({ member: ref, at: new Date().toISOString(), via: 'own phone', codeWindow: w, location, belonging: rating, answer: c.match.brandQuestion.options.includes(answer) ? answer : null })

  const wallet = walletFor(email)
  if (credited) wallet.entries.push({ pence: RULES.perCheckIn, from: c.request.brand, event: p.event.title, campaignId: c.id, at: new Date().toISOString(), status: 'pending' })
  res.json({ ok: true, member: ref, location, credited, wallet: walletView(wallet) })
})

// A button for judges: fill the rest of each crowd with simulated members.
// The third event is deliberately left under the 60% minimum to show the safeguard.
app.post('/api/campaigns/:id/crowd', (req, res) => {
  const c = getCampaign(req, res)
  if (!c) return
  if (c.stage !== 'event') return res.status(409).json({ error: 'The crowd can only arrive on event day.' })
  const targets = [0.83, 0.72, 0.45]
  const opts = c.match.brandQuestion.options
  c.plan.forEach((p, i) => {
    const list = c.checkins[p.communityId]
    const target = Math.round(p.signups * targets[i])
    while (list.length < target) {
      const r = Math.random()
      list.push({
        member: `M-sim${String(list.length + 1).padStart(3, '0')}`,
        at: new Date().toISOString(), via: 'simulated phone', codeWindow: windowNow(), location: 'at venue',
        belonging: r < 0.1 ? 3 : r < 0.55 ? 4 : 5,
        answer: Math.random() < 0.8 ? opts[Math.min(opts.length - 1, Math.floor(Math.random() ** 1.6 * opts.length))] : null,
      })
    }
  })
  res.json(c)
})

// ==================== 5–6. RELEASE + PROOF ====================
app.post('/api/campaigns/:id/release', async (req, res) => {
  const c = getCampaign(req, res)
  if (!c) return
  if (c.stage !== 'event') return res.status(409).json({ error: 'Payouts can be released once, after the events.' })
  // The dashboard re-renders every few seconds, so a second click can arrive mid-release.
  if (c.busy) return res.status(409).json({ error: 'Payouts are already being released.' })
  c.busy = true
  try {
    const budget = c.request.budget * 100
    const results = c.plan.map((p) => {
      const n = c.checkins[p.communityId].length
      const met = n / p.signups >= RULES.minTurnout
      const members = Math.min(n * RULES.perCheckIn, p.members)
      return { p, n, met, members, commfy: met ? p.commfy : 0, rest: met ? p.rest : 0 }
    })
    const toCapture = results.reduce((s, r) => s + r.members + r.commfy + r.rest, 0)
    if (toCapture > 0) {
      const cap = await paypal.captureAuthorization(c.paypal.authorizationId, toCapture, { finalCapture: true, note: 'Turnout: released on verified check-ins' })
      ledger(c, { step: 'Payouts', what: 'Final capture: earned on verified turnout (the rest of the hold goes back to the brand)', from: 'PayPal hold', to: 'Commfy', pence: toCapture, api: 'Payments v2: capture (final)', paypalId: cap.id, status: cap.status })
    } else {
      const v = await paypal.voidAuthorization(c.paypal.authorizationId)
      ledger(c, { step: 'Payouts', what: 'Nothing earned: hold voided', from: 'PayPal hold', to: c.request.brand, pence: 0, api: 'Payments v2: void', paypalId: v.id, status: v.status })
    }
    c.paypal.captured += toCapture
    const returned = budget - c.paypal.captured
    if (returned > 0) ledger(c, { step: 'Payouts', what: 'Never captured: released back to the brand', from: 'PayPal hold', to: c.request.brand, pence: returned, api: toCapture > 0 ? 'Payments v2: capture (final_capture: true)' : 'Payments v2: void', paypalId: c.paypal.authorizationId, status: 'RELEASED' })

    const paid = results.filter((r) => r.rest > 0)
    if (paid.length) {
      const batch = await paypal.sendPayouts(
        paid.map((r) => ({ email: r.p.contact.email, pence: r.rest, note: `${c.request.brand}: the rest of your share, ${r.n} people checked in`, ref: `${c.id}-rest-${r.p.communityId}`.slice(0, 63) })),
        { subject: `${c.request.brand} paid for your turnout`, batchRef: `${c.id}-release` },
      )
      paid.forEach((r) => ledger(c, { step: 'Payouts', what: `Rest of share to ${r.p.name} (${Math.round((r.n / r.p.signups) * 100)}% turnout)`, from: 'Commfy', to: r.p.contact.email, pence: r.rest, api: 'Payouts v1: batch', paypalId: batch.batchId, status: batch.status }))
    }
    // Information only (no amount): this money is already counted in the "released back to the brand" row.
    results.filter((r) => !r.met).forEach((r) => ledger(c, { step: 'Payouts', what: `${r.p.name} under ${RULES.minTurnout * 100}% turnout: organiser keeps the deposit; ${gbp(r.p.rest + r.p.commfy)} of this event's share is not taken from the brand`, from: 'PayPal hold', to: c.request.brand, pence: 0, api: '', paypalId: '', status: 'NOT TAKEN' }))
    const membersTotal = results.reduce((s, r) => s + r.members, 0)
    ledger(c, { step: 'Payouts', what: `Member wallets: £1 × ${membersTotal / 100} verified check-ins, ready to cash out`, from: 'Commfy', to: 'Member wallets', pence: membersTotal, api: 'Payouts v1 on cash-out', paypalId: '', status: 'AVAILABLE' })
    const commfyTotal = results.reduce((s, r) => s + r.commfy, 0)
    ledger(c, { step: 'Payouts', what: `Commfy's ${RULES.commfyShare * 100}% on events that hit the minimum`, from: 'Commfy', to: 'Commfy', pence: commfyTotal, api: '', paypalId: '', status: 'KEPT' })

    for (const w of wallets.values()) w.entries.forEach((e) => { if (e.campaignId === c.id && e.status === 'pending') e.status = 'available' })

    c.proof = buildProof(c, results, returned, membersTotal, commfyTotal)
    c.stage = 'released'
    res.json(c)
  } catch (err) {
    ledger(c, { step: 'Payouts', what: 'PayPal call failed', from: '', to: '', pence: 0, api: '', paypalId: '', status: `FAILED: ${err.message}` })
    res.status(502).json({ error: err.message })
  } finally {
    c.busy = false
  }
})

function buildProof(c, results, returned, membersTotal, commfyTotal) {
  const all = results.flatMap((r) => c.checkins[r.p.communityId])
  const rated = all.filter((x) => x.belonging)
  const answers = all.filter((x) => x.answer)
  const MIN_GROUP = 5 // answers only shown in groups of 5 or more
  const counts = {}
  answers.forEach((x) => { counts[x.answer] = (counts[x.answer] || 0) + 1 })
  return {
    headline: `${all.length} people checked in at ${results.length} events. ${c.request.brand} paid ${gbp(c.paypal.captured)} of ${gbp(c.request.budget * 100)}; ${gbp(returned)} was never taken.`,
    events: results.map((r) => ({
      name: r.p.name, event: r.p.event.title, signups: r.p.signups, checkedIn: r.n,
      turnout: Math.round((r.n / r.p.signups) * 100), met: r.met,
      organiserPaid: r.p.deposit + r.rest, membersPaid: r.members,
      atVenue: c.checkins[r.p.communityId].filter((x) => x.location === 'at venue').length,
    })),
    belonging: rated.length >= MIN_GROUP ? { average: Math.round((rated.reduce((s, x) => s + x.belonging, 0) / rated.length) * 10) / 10, answers: rated.length } : null,
    brandQuestion: answers.length >= MIN_GROUP ? { text: c.match.brandQuestion.text, counts, answers: answers.length } : null,
    money: { budget: c.request.budget * 100, captured: c.paypal.captured, returned, organisers: results.reduce((s, r) => s + r.p.deposit + r.rest, 0), members: membersTotal, commfy: commfyTotal },
    privacy: 'No names or emails: each member is an anonymous reference, and answers are shown only once 5 or more people have answered.',
  }
}

app.get('/api/campaigns/:id/checkins.csv', (req, res) => {
  const c = getCampaign(req, res)
  if (!c) return
  const rows = [['event', 'member_ref', 'checked_in_at', 'via', 'code_window', 'location']]
  c.plan.forEach((p) => c.checkins[p.communityId].forEach((x) => rows.push([p.name, x.member, x.at, x.via, x.codeWindow, x.location])))
  res.type('text/csv').attachment(`turnout-checkins-${c.id}.csv`).send(rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'))
})

// ==================== MEMBER WALLET ====================
app.get('/api/wallet', (req, res) => {
  const email = String(req.query.email || '')
  if (!wallets.has(email.toLowerCase())) return res.status(404).json({ error: 'No wallet yet. Check in at an event first.' })
  res.json(walletView(walletFor(email)))
})

app.post('/api/wallet/cashout', async (req, res) => {
  const email = String(req.body?.email || '')
  if (!wallets.has(email.toLowerCase())) return res.status(404).json({ error: 'No wallet yet.' })
  const w = walletFor(email)
  const v = walletView(w)
  if (v.available < RULES.minCashOut) return res.status(400).json({ error: `Cash-out opens at ${gbp(RULES.minCashOut)}.`, wallet: v })
  try {
    const brands = [...new Set(w.entries.filter((e) => e.status === 'available' && e.campaignId).map((e) => e.from))]
    const batch = await paypal.sendPayouts(
      [{ email: w.email, pence: v.available, note: `Your Turnout rewards${brands.length ? ` from ${brands.join(', ')}` : ''}. Thanks for showing up.`, ref: `wallet-${Date.now()}` }],
      { subject: 'Your Turnout wallet has been paid out', batchRef: 'wallet' },
    )
    w.entries.forEach((e) => { if (e.status === 'available') e.status = 'cashed' })
    w.cashouts.push({ at: new Date().toISOString(), pence: v.available, batchId: batch.batchId, status: batch.status })
    // Shown on the ledger of the member's latest event.
    const c = campaigns.get([...w.entries].reverse().find((e) => e.campaignId)?.campaignId)
    if (c) ledger(c, { step: 'Payouts', what: `Member ${anon(w.email)} cashed out their wallet`, from: 'Commfy', to: anon(w.email), pence: v.available, api: 'Payouts v1: batch', paypalId: batch.batchId, status: batch.status })
    res.json(walletView(w))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`Turnout running on http://localhost:${PORT}  ·  PayPal: ${paypal.mode()}  ·  AI: ${ai.mode()}`)
})
