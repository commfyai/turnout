// Turnout dashboard: one screen, brand → communities → PayPal, along a timeline.
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
const gbp = (pence) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

let config = null
let campaign = null
let grid = null
let brandStage = null // re-render the brand panel only when the stage changes (keeps the PayPal button alive)
let poll = null

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
  renderMoney()
  renderProof()
  clearInterval(poll)
  if (stage === 'event') poll = setInterval(refresh, 3000)
}

async function refresh() {
  if (!campaign) return
  try { campaign = await api(`/api/campaigns/${campaign.id}`); render() } catch { /* keep the last view */ }
}

function renderBrand(stage) {
  const el = $('brand')
  if (stage === 'new') {
    el.innerHTML = `
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
        <button class="to-btn" type="submit">Ask Commfy's AI</button>
        <p class="to-error" id="request-error"></p>
      </form>`
    $('request').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = e.target.querySelector('button')
      btn.disabled = true
      btn.textContent = 'Commfy\'s AI is matching…'
      try {
        setCampaign(await api('/api/campaigns', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }))
      } catch (err) {
        $('request-error').textContent = err.message
        btn.disabled = false
        btn.textContent = 'Ask Commfy\'s AI'
      }
    })
    return
  }

  const r = campaign.request
  const m = campaign.match
  el.innerHTML = `
    <p class="to-kicker">${esc(r.brand)} · ${esc(r.goal)} · ${gbp(r.budget * 100)}</p>
    <p class="to-quote">“${esc(r.audience)}”</p>
    <div class="to-ai">
      <p class="to-label">${m.source === 'ai' ? `Commfy's AI (${esc(m.model)})` : 'Rule-based match'}</p>
      <p>${esc(m.summary)}</p>
      <p><strong>At each event:</strong> ${esc(m.deal)}</p>
      <p><strong>Question at check-in:</strong> ${esc(m.brandQuestion.text)} <span class="to-small">(${m.brandQuestion.options.map(esc).join(' / ')})</span></p>
      ${m.note ? `<p class="to-small">${esc(m.note)}</p>` : ''}
    </div>
    <div id="approve"></div>
    <p class="to-error" id="approve-error"></p>
    <button class="to-btn to-btn--ghost" id="restart">Start a new request</button>`
  $('restart').onclick = () => { brandStage = null; setCampaign(null) }
  if (stage === 'proposed') renderApprove()
  else $('approve').innerHTML = `<p class="to-ok">Approved. PayPal holds ${gbp(r.budget * 100)}; nothing more is paid until people check in.</p>`
}

function renderApprove() {
  const box = $('approve')
  const fail = (err) => { $('approve-error').textContent = err.message || String(err) }
  box.innerHTML = `<p class="to-small">Approving puts a PayPal hold on the whole budget. Organisers get a ${config.rules.deposit * 100}% deposit now; the rest only if ${config.rules.minTurnout * 100}% of sign-ups check in.</p>`
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

function renderCommunities(stage) {
  const el = $('communities')
  if (stage === 'new') {
    el.innerHTML = `<p class="to-empty">Commfy's AI picks 2–3 of ${esc(config.communityCount)} made-up London communities once the brand sends its request.</p>`
    return
  }
  const min = config.rules.minTurnout
  const cards = campaign.plan.map((p) => {
    const n = campaign.checkins[p.communityId].length
    const pct = Math.min(100, Math.round((n / p.signups) * 100))
    const result = campaign.proof?.events.find((e) => e.name === p.name)
    return `
      <article class="to-card">
        <h3>${esc(p.name)}</h3>
        <p class="to-small">${esc(p.area)} · ${esc(p.event.title)} · ${p.signups} signed up</p>
        <p class="to-reason">${esc(p.reason)}</p>
        ${stage === 'proposed' ? `
          <dl class="to-split">
            <div><dt>Organiser</dt><dd>${gbp(p.organiser)}</dd></div>
            <div><dt>Members</dt><dd>${gbp(p.members)}</dd></div>
            <div><dt>Commfy</dt><dd>${gbp(p.commfy)}</dd></div>
          </dl>
          <p class="to-small">Organiser: ${gbp(p.deposit)} deposit on approval, ${gbp(p.rest)} on proof. Members: £1 per check-in.</p>` : `
          <div class="to-bar" role="img" aria-label="${n} of ${p.signups} checked in">
            <span style="width:${pct}%" class="${pct >= min * 100 ? 'is-met' : ''}"></span>
            <i style="left:${min * 100}%"></i>
          </div>
          <p class="to-small"><strong>${n}</strong> of ${p.signups} checked in (${pct}%)${result ? (result.met ? ' · minimum met, paid' : ` · under ${min * 100}%, rest returned to brand`) : ''}</p>
          ${stage === 'event' ? `<button class="to-btn to-btn--small" data-door="${esc(p.communityId)}" data-name="${esc(p.name)}">Show door code</button>` : ''}`}
      </article>`
  }).join('')
  el.innerHTML = cards + (stage === 'event' ? `
    <div class="to-actions">
      <button class="to-btn to-btn--ghost" id="crowd">Fill the rest of the crowd</button>
      <button class="to-btn" id="release">Close events and release payouts</button>
      <p class="to-small">The crowd button adds simulated check-ins; the third event is left under ${min * 100}% to show the safeguard.</p>
      <p class="to-error" id="event-error"></p>
    </div>` : '')
  el.querySelectorAll('[data-door]').forEach((b) => { b.onclick = () => openDoor(b.dataset.door, b.dataset.name) })
  if (stage === 'event') {
    $('crowd').onclick = async () => { try { setCampaign(await api(`/api/campaigns/${campaign.id}/crowd`, { method: 'POST' })) } catch (err) { $('event-error').textContent = err.message } }
    $('release').onclick = async (e) => {
      e.target.disabled = true
      e.target.textContent = 'Paying out through PayPal…'
      try { setCampaign(await api(`/api/campaigns/${campaign.id}/release`, { method: 'POST' })) } catch (err) { $('event-error').textContent = err.message; e.target.disabled = false }
    }
  }
}

function renderMoney() {
  const el = $('money')
  const rows = campaign?.ledger || []
  if (grid) { grid.setGridOption('rowData', [...rows].reverse()); grid.resetRowHeights() }
  if (!campaign || campaign.stage === 'proposed') {
    el.innerHTML = `<p class="to-empty">${campaign ? 'Waiting for the brand to approve. No money has moved.' : 'The PayPal hold and every payout appear here.'}</p>`
    return
  }
  const budget = campaign.request.budget * 100
  const captured = campaign.paypal.captured || 0
  const held = campaign.stage === 'released' ? 0 : budget - captured
  el.innerHTML = `
    <dl class="to-stats">
      <div><dt>Budget</dt><dd>${gbp(budget)}</dd></div>
      <div><dt>Still on hold</dt><dd>${gbp(held)}</dd></div>
      <div><dt>Captured</dt><dd>${gbp(captured)}</dd></div>
      <div><dt>Back to brand</dt><dd>${gbp(campaign.stage === 'released' ? budget - captured : 0)}</dd></div>
    </dl>
    <p class="to-small">Order ${esc(campaign.paypal.orderId)} · Authorization ${esc(campaign.paypal.authorizationId)}${campaign.paypal.holdExpires ? ` · hold valid until ${new Date(campaign.paypal.holdExpires).toLocaleDateString('en-GB')}` : ''}</p>
    <p class="to-small">${config.paypalMode === 'sandbox' ? 'Every PayPal ID in the ledger comes from a real PayPal sandbox API call.' : 'Simulated PayPal: the same calls and response shapes, because no PayPal keys are set yet. Add sandbox keys and the same buttons call PayPal for real.'}</p>`
}

function renderProof() {
  const el = $('proof')
  const pr = campaign?.proof
  el.hidden = !pr
  if (!pr) return
  const bq = pr.brandQuestion
  el.innerHTML = `
    <h2 id="proof-title">Proof report for ${esc(campaign.request.brand)}</h2>
    <p class="to-headline">${esc(pr.headline)}</p>
    <table class="to-table">
      <thead><tr><th>Community</th><th>Signed up</th><th>Checked in</th><th>Turnout</th><th>At venue</th><th>Organiser paid</th><th>Members paid</th></tr></thead>
      <tbody>${pr.events.map((e) => `
        <tr><td>${esc(e.name)}<br><span class="to-small">${esc(e.event)}</span></td><td>${e.signups}</td><td>${e.checkedIn}</td>
        <td>${e.turnout}% ${e.met ? '<span class="to-pill is-met">paid</span>' : '<span class="to-pill">under minimum</span>'}</td>
        <td>${e.atVenue}</td><td>${gbp(e.organiserPaid)}</td><td>${gbp(e.membersPaid)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="to-proof-grid">
      <div><p class="to-label">Belonging</p><p class="to-big">${pr.belonging ? `${pr.belonging.average} / 5` : '–'}</p><p class="to-small">${pr.belonging ? `"How welcome did you feel?" ${pr.belonging.answers} answers` : 'Fewer than 5 answers, not shown'}</p></div>
      <div><p class="to-label">${bq ? esc(bq.text) : 'Brand question'}</p>${bq ? Object.entries(bq.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<p class="to-small"><strong>${esc(k)}</strong> ${Math.round((v / bq.answers) * 100)}% (${v})</p>`).join('') : '<p class="to-small">Fewer than 5 answers, not shown</p>'}</div>
      <div><p class="to-label">Where the money went</p>
        <p class="to-small">Organisers ${gbp(pr.money.organisers)} · Members ${gbp(pr.money.members)} · Commfy ${gbp(pr.money.commfy)}</p>
        <p class="to-small">Never taken from the brand: <strong>${gbp(pr.money.returned)}</strong></p></div>
    </div>
    <p class="to-small">${esc(pr.privacy)} <a href="/api/campaigns/${campaign.id}/checkins.csv">Download the check-in record (CSV)</a> to audit every check-in.</p>`
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
  $('badges').innerHTML = `
    <span class="to-badge ${config.paypalMode === 'sandbox' ? 'is-live' : ''}">PayPal: ${config.paypalMode === 'sandbox' ? 'sandbox' : 'simulated'}</span>
    <span class="to-badge ${config.aiMode.startsWith('Azure') ? 'is-live' : ''}">AI: ${esc(config.aiMode)}</span>`
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
  document.fonts?.ready.then(() => grid?.resetRowHeights())
  const id = new URL(location.href).searchParams.get('c')
  if (id) {
    try { campaign = await api(`/api/campaigns/${id}`) } catch { campaign = null }
  }
  setCampaign(campaign)
}

start().catch((err) => { document.body.insertAdjacentHTML('afterbegin', `<p class="to-error">${esc(err.message)}</p>`) })
