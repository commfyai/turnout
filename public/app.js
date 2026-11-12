// Turnout dashboard, brand view: the money on top, the brand on the left, the communities in the wide space,
// the proof report after payouts, and every PayPal call folded away underneath.
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
const gbp = (pence) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// Brand screens show whole pounds; the PayPal ledger keeps the pennies.
const gbp0 = (pence) => `£${Math.round(pence / 100).toLocaleString('en-GB')}`
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0)
const AVATARS = ['#FFD9CC', '#FFF0D1', '#E3EEF9']

let config = null
let campaign = null
let grid = null
let brandStage = null // re-render the brand panel only when the stage changes (keeps the PayPal button alive)
let poll = null
const openSplits = new Set() // "See the split" boxes stay open across the 3-second refresh

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options, body: options.body ? JSON.stringify(options.body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

function setCampaign(c) {
  campaign = c
  const url = new URL(location.href)
  if (c) url.searchParams.set('c', c.id)
  else url.searchParams.delete('c')
  history.replaceState(null, '', url)
  render()
}

// ==================== RENDER ====================
function render() {
  const stage = campaign?.stage || 'new'
  const step = { new: 0, proposed: 1, event: 3, released: 5 }[stage]
  ;[...$('timeline').children].forEach((li, i) => {
    li.classList.toggle('is-done', i < step)
    li.classList.toggle('is-current', i === step)
  })
  if (brandStage !== `${campaign?.id}:${stage}`) {
    brandStage = `${campaign?.id}:${stage}`
    renderBrand(stage)
  }
  renderCommunities(stage)
  renderMoney(stage)
  renderProof()
  clearInterval(poll)
  // Keep polling after release until PayPal has finished every payout batch.
  const payoutsOpen = campaign?.ledger.some((r) => ['PENDING', 'PROCESSING'].includes(r.status))
  if (stage === 'event' || payoutsOpen) poll = setInterval(refresh, 3000)
}

async function refresh() {
  if (!campaign) return
  try { campaign = await api(`/api/campaigns/${campaign.id}`); render() } catch { /* keep the last view */ }
}

// ==================== BRAND ====================
function renderBrand(stage) {
  const el = $('brand')
  if (stage === 'new') {
    el.innerHTML = `
      <h2 class="to-h2">Your request</h2>
      <form id="request" class="to-form">
        <label>Brand<input name="brand" value="Fernleaf Oat Co." required maxlength="60"></label>
        <label>Goal
          <select name="goal">
            <option value="product feedback">Product feedback</option>
            <option value="awareness">Awareness</option>
            <option disabled>Content (coming soon)</option>
            <option disabled>Sales (coming soon)</option>
            <option disabled>Hiring (coming soon)</option>
          </select>
        </label>
        <label>Who do you want to reach?
          <textarea name="audience" rows="3" required maxlength="300">Active people in East London who run, cycle or climb. We're launching a new oat drink and want to know if they'd buy it.</textarea>
        </label>
        <label>Budget (${esc(config.currency)})<input name="budget" type="number" min="100" max="10000" step="50" value="1500" required></label>
        <button class="to-btn" type="submit">Ask Commfy</button>
        <p class="to-error" id="request-error"></p>
      </form>`
    $('request').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = e.target.querySelector('button')
      btn.disabled = true
      btn.textContent = 'Commfy is matching…'
      try {
        setCampaign(await api('/api/campaigns', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }))
      } catch (err) {
        $('request-error').textContent = err.message
        btn.disabled = false
        btn.textContent = 'Ask Commfy'
      }
    })
    return
  }

  const r = campaign.request
  const m = campaign.match
  const organisers = sum(campaign.plan, (p) => p.organiser)
  const members = sum(campaign.plan, (p) => p.members)
  el.innerHTML = `
    <p class="to-kicker">${esc(r.brand)} · ${esc(r.goal)} · ${gbp0(r.budget * 100)}</p>
    <p class="to-quote">“${esc(r.audience)}”</p>
    <div class="to-rec">
      <p class="to-rec-title">Commfy recommends</p>
      <p>${esc(m.summary)}</p>
      <p><strong>At each event:</strong> ${esc(m.deal)}</p>
      <p><strong>Your survey question:</strong> ${esc(m.brandQuestion.text)} <span class="to-small">(${m.brandQuestion.options.map(esc).join(' / ')})</span></p>
      ${m.source !== 'ai' ? '<p class="to-small">Simple keyword match: Commfy\'s AI was unavailable for this request.</p>' : ''}
    </div>
    <div class="to-funds">
      <p class="to-row"><span><strong>Brand funds available</strong><br><span class="to-small">organisers ${gbp0(organisers)} · members ${gbp0(members)}</span></span><strong>up to ${gbp0(organisers + members)}</strong></p>
      <p class="to-small">You're only charged for results. Whatever isn't earned comes back to you.</p>
    </div>
    <div class="to-mix" id="mix"></div>
    <div id="approve"></div>
    <p class="to-error" id="approve-error"></p>
    <button class="to-btn to-btn--ghost" id="restart">Start a new request</button>`
  $('restart').onclick = () => { brandStage = null; openSplits.clear(); setCampaign(null) }
  renderMix(stage === 'proposed')
  if (stage === 'proposed') renderApprove()
  else $('approve').innerHTML = `<p class="to-ok is-good">Approved. PayPal is holding your ${gbp0(r.budget * 100)}. You're only charged for results.</p>`
}

// ==================== THE MIX: what the brand pays organisers for ====================
const GOALS = [
  { key: 'people', label: 'People there', hint: 'checked in at the door' },
  { key: 'survey', label: 'Survey answers', hint: 'answered both questions' },
  { key: 'newFaces', label: 'New faces', hint: 'first time with that community' },
]

// Moving one slider shares the change across the other two, so the three always add up to 60%.
function rebalance(mix, key, value) {
  const others = GOALS.map((g) => g.key).filter((k) => k !== key)
  const left = 60 - value
  const total = others.reduce((s, k) => s + mix[k], 0)
  const first = total ? Math.round((left * mix[others[0]]) / total) : Math.ceil(left / 2)
  return { ...mix, [key]: value, [others[0]]: first, [others[1]]: left - first }
}

function renderMix(editable) {
  const el = $('mix')
  const ai = campaign.match.mix
  const mix = campaign.mix
  const plan = campaign.plan
  const pounds = (key) => gbp0(key === 'base' ? sum(plan, (p) => p.deposit) : sum(plan, (p) => p.pots[key]))
  const bar = (pct) => `<span class="to-mix-bar"><span style="width:${Math.min(100, (pct / 60) * 100)}%"></span></span>`
  const row = (label, hint, pct, money, control) => `
    <div class="to-mix-row">
      <span><strong>${label}</strong><br><span class="to-small">${hint}</span></span>
      ${control}
      <span class="to-mix-pct"><span class="to-mix-num">${pct}%</span><br><span class="to-small">${money}</span></span>
    </div>`
  el.innerHTML = `
    <p class="to-mix-title">How the organisers are paid</p>
    <p class="to-small">${esc(ai.reason)} ${editable ? 'Drag to change it before you approve.' : 'Fixed once you approved.'}</p>
    ${row('Base pay', editable ? 'when you approve' : 'when you approved', config.rules.base * 100, pounds('base'), bar(config.rules.base * 100))}
    ${GOALS.map((g) => row(g.label, g.hint, mix[g.key], pounds(g.key), editable ? `<input type="range" min="0" max="60" step="1" value="${mix[g.key]}" data-goal="${g.key}" aria-label="${g.label}">` : bar(mix[g.key]))).join('')}
    ${row('Posts &amp; photos bonus', 'your call after the event', config.rules.kicker * 100, pounds('kicker'), bar(config.rules.kicker * 100))}
    ${editable && GOALS.some((g) => mix[g.key] !== ai[g.key]) ? '<button class="to-btn to-btn--ghost to-btn--small" id="mix-reset">Back to Commfy\'s mix</button>' : ''}`
  if (!editable) return
  let draft = { ...mix }
  let timer = null
  const save = () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      try { campaign = await api(`/api/campaigns/${campaign.id}/mix`, { method: 'POST', body: draft }); renderCommunities(campaign.stage); renderMix(true) } catch (err) { $('approve-error').textContent = err.message }
    }, 250)
  }
  el.querySelectorAll('input[data-goal]').forEach((input) => {
    input.oninput = () => {
      draft = rebalance(draft, input.dataset.goal, Number(input.value))
      el.querySelectorAll('input[data-goal]').forEach((x) => {
        x.value = draft[x.dataset.goal]
        x.closest('.to-mix-row').querySelector('.to-mix-num').textContent = `${draft[x.dataset.goal]}%`
      })
    }
    input.onchange = save
  })
  if ($('mix-reset')) $('mix-reset').onclick = () => { draft = { people: ai.people, survey: ai.survey, newFaces: ai.newFaces }; save() }
}

function renderApprove() {
  const box = $('approve')
  const fail = (err) => { $('approve-error').textContent = err.message || String(err) }
  box.innerHTML = `<p class="to-small">Approving puts a PayPal hold on your whole budget. Organisers get their ${config.rules.base * 100}% base pay now; the rest is paid on results, following the mix.</p>`
  if (config.paypalClientId && window.paypal) {
    const holder = document.createElement('div')
    box.appendChild(holder)
    window.paypal.Buttons({
      style: { label: 'pay', height: 44 },
      createOrder: async () => (await api(`/api/campaigns/${campaign.id}/order`, { method: 'POST' })).orderId,
      onApprove: async (data) => setCampaign(await api(`/api/campaigns/${campaign.id}/authorize`, { method: 'POST', body: { orderId: data.orderID } })),
      onError: fail,
    }).render(holder)
  } else if (config.paypalClientId) {
    fail(new Error("PayPal's button didn't load. Check the PayPal client ID, then reload."))
  } else {
    const btn = document.createElement('button')
    btn.className = 'to-btn'
    btn.textContent = 'Approve and hold with PayPal (simulated)'
    btn.onclick = async () => {
      btn.disabled = true
      try {
        await api(`/api/campaigns/${campaign.id}/order`, { method: 'POST' })
        setCampaign(await api(`/api/campaigns/${campaign.id}/authorize`, { method: 'POST' }))
      } catch (err) { fail(err); btn.disabled = false }
    }
    box.appendChild(btn)
  }
}

// ==================== COMMUNITIES ====================
function renderCommunities(stage) {
  const el = $('communities')
  if (stage === 'new') {
    el.innerHTML = `<div class="to-placeholder"><p class="to-empty">Commfy recommends 2–3 of ${esc(config.communityCount)} made-up London communities once you send your request.</p></div>`
    return
  }
  const cards = campaign.plan.map((p, i) => {
    const list = campaign.checkins[p.communityId]
    const result = campaign.proof?.events.find((e) => e.name === p.name)
    const newTarget = Math.max(1, Math.round(p.signups * config.rules.newFacesTarget))
    const counts = { people: [list.length, p.signups], survey: [list.filter((x) => x.answered).length, p.signups], newFaces: [list.filter((x) => x.firstTime).length, newTarget] }
    const bonusOn = campaign.kickers.includes(p.communityId)
    const meter = (g) => {
      const [n, target] = counts[g.key]
      const pct = Math.min(100, Math.round((n / target) * 100))
      return `
        <div class="to-meter">
          <p class="to-meter-label"><span><strong>${g.label}</strong> ${g.key === 'newFaces' ? `${n}, target ${target}` : `${n} of ${target}`}</span><span class="to-small">${result ? `earned ${gbp0(result.earned[g.key])} of ${gbp0(p.pots[g.key])}` : `up to ${gbp0(p.pots[g.key])}`}</span></p>
          <div class="to-bar" role="img" aria-label="${g.label}: ${n} of ${target}"><span style="width:${pct}%" class="${pct >= 100 ? 'is-met' : ''}"></span></div>
        </div>`
    }
    const split = `
      <details class="to-split-box" data-split="${esc(p.communityId)}" ${openSplits.has(p.communityId) ? 'open' : ''}>
        <summary>See the split</summary>
        <ul>
          <li><span>Base pay, ${stage === 'proposed' ? 'on approval' : 'paid'}</span><strong>${gbp0(p.deposit)}</strong></li>
          ${GOALS.map((g) => `<li><span>${g.label}, up to</span><strong>${gbp0(p.pots[g.key])}</strong></li>`).join('')}
          <li><span>Posts &amp; photos bonus, up to</span><strong>${gbp0(p.pots.kicker)}</strong></li>
          <li><span>Members, £1 per survey, up to</span><strong>${gbp0(p.members)}</strong></li>
        </ul>
      </details>`
    return `
      <article class="to-card">
        <div class="to-card-head">
          <span class="to-avatar" aria-hidden="true" style="background:${AVATARS[i % AVATARS.length]}">${esc(p.name.charAt(0))}</span>
          <div>
            <h3>${esc(p.name)}</h3>
            <p class="to-small">${esc(p.area)} · ${esc(p.event.title)} · ${p.signups} regulars</p>
          </div>
        </div>
        <p class="to-reason">${esc(p.reason)}</p>
        <div class="to-funds to-funds--card">
          <p class="to-row"><span>Brand funds available</span><strong>up to ${gbp0(p.organiser + p.members)}</strong></p>
          <p class="to-small">organiser up to ${gbp0(p.organiser)} (base pay ${gbp0(p.deposit)} ${stage === 'proposed' ? 'on approval' : 'paid'}) · members up to ${gbp0(p.members)}</p>
        </div>
        ${stage === 'proposed' ? split : `
          ${GOALS.map(meter).join('')}
          ${stage === 'event'
            ? `<label class="to-check"><input type="checkbox" data-kicker="${esc(p.communityId)}" ${bonusOn ? 'checked' : ''}> Posts &amp; photos bonus (${gbp0(p.pots.kicker)})</label>
               <div class="to-card-actions">
                 <button class="to-btn to-btn--ghost to-btn--small" data-door="${esc(p.communityId)}" data-name="${esc(p.name)}">Show door code</button>
               </div>
               ${split}`
            : `<p class="to-small"><strong>Posts &amp; photos bonus</strong> ${result?.kicker ? `awarded, ${gbp0(p.pots.kicker)}` : 'not awarded'}</p>
               <p class="to-row to-paid"><span>Organiser paid</span><strong>${gbp0(result?.organiserPaid || 0)} <span class="to-small">of ${gbp0(p.organiser)}</span></strong></p>
               <p class="to-row to-paid"><span>Members paid</span><strong>${gbp0(result?.membersPaid || 0)}</strong></p>`}`}
      </article>`
  }).join('')
  el.innerHTML = `<div class="to-cards">${cards}</div>` + (stage === 'event' ? `
    <div class="to-demo">
      <p class="to-small"><strong>Demo controls.</strong> These stand in for a real event night: fill each event with simulated members, then close the events.</p>
      <button class="to-btn to-btn--ghost to-btn--auto" id="crowd">Fill the rest of the crowd</button>
      <button class="to-btn to-btn--auto" id="release">Close events and pay out</button>
      <p class="to-error" id="event-error"></p>
    </div>` : '')
  el.querySelectorAll('[data-door]').forEach((b) => { b.onclick = () => openDoor(b.dataset.door, b.dataset.name) })
  el.querySelectorAll('[data-split]').forEach((d) => {
    d.ontoggle = () => { if (d.open) openSplits.add(d.dataset.split); else openSplits.delete(d.dataset.split) }
  })
  el.querySelectorAll('[data-kicker]').forEach((box) => {
    box.onchange = async () => {
      try { setCampaign(await api(`/api/campaigns/${campaign.id}/kicker`, { method: 'POST', body: { communityId: box.dataset.kicker, on: box.checked } })) } catch (err) { $('event-error').textContent = err.message }
    }
  })
  if (stage === 'event') {
    $('crowd').onclick = async () => { try { setCampaign(await api(`/api/campaigns/${campaign.id}/crowd`, { method: 'POST' })) } catch (err) { $('event-error').textContent = err.message } }
    $('release').onclick = async (e) => {
      e.target.disabled = true
      e.target.textContent = 'Paying out through PayPal…'
      try { setCampaign(await api(`/api/campaigns/${campaign.id}/release`, { method: 'POST' })) } catch (err) { $('event-error').textContent = err.message; e.target.disabled = false }
    }
  }
}

// ==================== MONEY STRIP + PAYPAL LEDGER ====================
function renderMoney(stage) {
  const el = $('money')
  const rows = campaign?.ledger || []
  const stat = (label, value, note = '') => `<div class="to-stat"><p class="to-stat-label">${label}</p><p class="to-stat-value">${value}</p>${note ? `<p class="to-small">${note}</p>` : ''}</div>`
  if (stage === 'new') {
    el.innerHTML = `
      ${stat('How your money is protected', '1. Held', 'PayPal holds your budget; nothing is charged yet')}
      ${stat('&nbsp;', '2. Paid on results', 'organisers earn for people there, answers and new faces')}
      ${stat('&nbsp;', '3. The rest back', 'anything not earned is never taken')}`
  } else {
    const budget = campaign.request.budget * 100
    const captured = campaign.paypal.captured || 0
    if (stage === 'proposed') {
      el.innerHTML = `${stat('Your budget', gbp0(budget))}${stat('Held by PayPal', '£0', 'nothing moves until you approve')}${stat('Paid out so far', '£0')}${stat('Back to you', '–', 'anything not earned comes back after the events')}`
    } else if (stage === 'event') {
      el.innerHTML = `${stat('Your budget', gbp0(budget))}${stat('Held by PayPal, not charged', gbp0(budget - captured))}${stat('Paid out so far', gbp0(captured), `base pay to ${campaign.plan.length} organisers`)}${stat('Back to you', '£0 so far', 'anything not earned comes back after the events')}`
    } else {
      const people = sum(campaign.proof.events, (e) => e.checkedIn)
      el.innerHTML = `${stat('Your budget', gbp0(budget))}${stat('You were charged', gbp0(captured), 'for results only')}${stat('Per person who came', people ? gbp(Math.round(captured / people)) : '–', `${people} people checked in`)}${stat('Back to you', gbp0(budget - captured), 'never charged')}`
    }
  }

  if (grid) { grid.setGridOption('rowData', [...rows].reverse()); grid.resetRowHeights() }
  const live = config.paypalMode === 'sandbox'
  const failed = rows.some((r) => String(r.status).startsWith('FAILED'))
  if (failed) $('ledger-box').open = true // a PayPal error is never hidden in the fold
  $('ledger-count').textContent = failed
    ? 'A PayPal step failed: the reason is in the table below'
    : rows.length
      ? `${rows.length} PayPal ${rows.length === 1 ? 'step' : 'steps'} so far${live ? ', every one a real sandbox call' : ' (simulated: no PayPal keys set)'}`
      : 'Nothing has moved yet'
  $('ledger-ids').textContent = campaign?.paypal?.orderId
    ? `Order ${campaign.paypal.orderId} · Authorization ${campaign.paypal.authorizationId || '–'}${campaign.paypal.holdExpires ? ` · hold valid until ${new Date(campaign.paypal.holdExpires).toLocaleDateString('en-GB')}` : ''}`
    : ''
}

// ==================== PROOF REPORT ====================
function renderProof() {
  const el = $('proof')
  const pr = campaign?.proof
  el.hidden = !pr
  if (!pr) return
  const people = sum(pr.events, (e) => e.checkedIn)
  const answered = sum(pr.events, (e) => e.answered)
  const newFaces = sum(pr.events, (e) => e.newFaces)
  const bq = pr.brandQuestion
  const stat = (value, label, note, accent) => `<div class="to-bigstat ${accent ? 'is-accent' : ''}"><p class="to-bigstat-value">${value}</p><p class="to-bigstat-label">${label}</p><p class="to-small">${note}</p></div>`
  el.innerHTML = `
    <div class="to-proof-head">
      <h2 id="proof-title">Proof report for ${esc(campaign.request.brand)}</h2>
      <a href="/api/campaigns/${campaign.id}/checkins.csv">Download the check-in record (CSV)</a>
    </div>
    <div class="to-bigstats">
      ${stat(people, 'people there', `checked in at ${pr.events.length} events`)}
      ${stat(answered, 'survey answers', 'answered both questions')}
      ${stat(newFaces, 'new faces', 'first time with that community')}
      ${stat(people ? gbp(Math.round(pr.money.captured / people)) : '–', 'per person who came', `${gbp0(pr.money.captured)} paid ÷ ${people} people`, true)}
      ${stat(gbp0(pr.money.returned), 'never charged', `of your ${gbp0(pr.money.budget)} budget`, true)}
    </div>
    <div class="to-box">
      <h3>What you paid for, by community</h3>
      <p class="to-small">Paid on the mix you approved: ${GOALS.map((g) => `${g.label.toLowerCase()} ${pr.mix[g.key]}%`).join(', ')}, plus ${config.rules.base * 100}% base pay and the ${config.rules.kicker * 100}% bonus.</p>
      <div class="to-scroll">
        <table class="to-table">
          <thead><tr><th>Community</th><th>People there</th><th>Survey answers</th><th>New faces</th><th>Posts &amp; photos bonus</th><th class="to-right">Organiser paid</th></tr></thead>
          <tbody>${pr.events.map((e) => `
            <tr><td><strong>${esc(e.name)}</strong><br><span class="to-small">${esc(e.event)}</span></td>
            <td>${e.checkedIn} of ${e.signups}</td><td>${e.answered}</td><td>${e.newFaces}</td>
            <td>${e.kicker ? '<span class="to-pill is-met">Awarded</span>' : '<span class="to-pill">No</span>'}</td>
            <td class="to-right"><strong>${gbp0(e.organiserPaid)}</strong><br><span class="to-small">of ${gbp0(e.organiserMax)}</span></td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="to-proof-grid">
      <div class="to-box"><h3>How welcome people felt</h3><p class="to-big">${pr.belonging ? `${pr.belonging.average} / 5` : '–'}</p><p class="to-small">${pr.belonging ? `${pr.belonging.answers} answers` : 'Fewer than 5 answers, not shown'}</p></div>
      <div class="to-box"><h3>${bq ? esc(bq.text) : 'Your question'}</h3>${bq ? Object.entries(bq.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
        const pct = Math.round((v / bq.answers) * 100)
        return `<div class="to-answer"><p class="to-meter-label"><strong>${esc(k)}</strong><span>${pct}%</span></p><div class="to-bar"><span class="is-met" style="width:${pct}%"></span></div></div>`
      }).join('') : '<p class="to-small">Fewer than 5 answers, not shown</p>'}</div>
      <div class="to-box"><h3>Where your money went</h3>
        <p class="to-row"><span>Organisers</span><strong>${gbp0(pr.money.organisers)}</strong></p>
        <p class="to-row"><span>Members (£1 per survey)</span><strong>${gbp0(pr.money.members)}</strong></p>
        <p class="to-row"><span>Commfy's fee (${config.rules.commfyShare * 100}% of what you paid)</span><strong>${gbp0(pr.money.commfy)}</strong></p>
        <p class="to-row to-row--total"><span>Never charged</span><strong>${gbp0(pr.money.returned)}</strong></p>
      </div>
    </div>
    <p class="to-small">${esc(pr.privacy)}</p>`
}

// ==================== DOOR CODE ====================
let doorTimer = null
async function openDoor(eventId, name) {
  $('door-title').textContent = name
  $('door').showModal()
  const tick = async () => {
    const d = await api(`/api/campaigns/${campaign.id}/door/${eventId}`)
    $('qr').innerHTML = ''
    if (window.QRCode) new window.QRCode($('qr'), { text: d.url, width: 200, height: 200 })
    $('door-code').textContent = d.code
    $('door-link').href = d.url
    let left = d.secondsLeft
    $('door-timer').textContent = `New code in ${left}s`
    clearInterval(doorTimer)
    doorTimer = setInterval(() => {
      left -= 1
      if (left <= 0) tick()
      else $('door-timer').textContent = `New code in ${left}s`
    }, 1000)
  }
  tick()
}
$('door-close').onclick = () => $('door').close()
$('door').addEventListener('close', () => clearInterval(doorTimer))

// ==================== START ====================
async function start() {
  config = await api('/api/config')
  config.communityCount = (await api('/api/communities')).length
  $('badges').textContent = config.paypalMode === 'sandbox' ? 'Demo: PayPal sandbox, no real money' : 'Demo: simulated PayPal, no real money'
  if (config.paypalClientId) {
    await new Promise((resolve) => {
      const s = document.createElement('script')
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypalClientId)}&currency=${config.currency}&intent=authorize`
      s.onload = resolve
      s.onerror = resolve
      document.head.appendChild(s)
    })
  }
  if (window.agGrid) {
    grid = window.agGrid.createGrid($('ledger'), {
      rowData: [],
      domLayout: 'autoHeight',
      overlayNoRowsTemplate: 'No money has moved yet.',
      defaultColDef: { resizable: true, sortable: true, filter: true },
      columnDefs: [
        { field: 'at', headerName: 'Time', width: 92, valueFormatter: (p) => new Date(p.value).toLocaleTimeString('en-GB') },
        { field: 'step', width: 96 },
        { field: 'what', headerName: 'What happened', flex: 3, minWidth: 280, wrapText: true, autoHeight: true, cellStyle: { lineHeight: '1.4', paddingTop: '8px', paddingBottom: '8px' } },
        { field: 'to', headerName: 'To', flex: 1, minWidth: 150, tooltipField: 'to' },
        { field: 'pence', headerName: 'Amount', width: 108, type: 'rightAligned', valueFormatter: (p) => (p.value ? gbp(p.value) : '') },
        { field: 'api', headerName: 'PayPal API', flex: 1, minWidth: 170, wrapText: true, autoHeight: true, cellStyle: { lineHeight: '1.4', paddingTop: '8px', paddingBottom: '8px' } },
        { field: 'paypalId', headerName: 'PayPal ID', width: 160, tooltipValueGetter: (p) => `${p.data.paypalId} (${p.data.mode})` },
        { field: 'status', width: 118, wrapText: true, autoHeight: true, cellClass: (p) => (String(p.value).startsWith('FAILED') ? 'to-cell-bad' : '') },
      ],
    })
  }
  // The ledger starts folded; re-measure the rows once it opens.
  $('ledger-box').addEventListener('toggle', () => { if ($('ledger-box').open) grid?.resetRowHeights() })
  document.fonts?.ready.then(() => grid?.resetRowHeights())
  const id = new URL(location.href).searchParams.get('c')
  if (id) {
    try { campaign = await api(`/api/campaigns/${id}`) } catch { campaign = null }
  }
  setCampaign(campaign)
}

start().catch((err) => { document.body.insertAdjacentHTML('afterbegin', `<p class="to-error">${esc(err.message)}</p>`) })
