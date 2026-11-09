// PayPal: the real sandbox REST API when PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET are set,
// otherwise a clearly labelled "simulated PayPal" that returns the same shapes.
//
// Calls used:
//   Orders v2   POST /v2/checkout/orders                       (intent AUTHORIZE: the brand's budget)
//               POST /v2/checkout/orders/{id}/authorize        (the hold, after the brand approves)
//   Payments v2 POST /v2/payments/authorizations/{id}/capture  (partial captures: deposit, then release)
//               POST /v2/payments/authorizations/{id}/void     (nothing left to capture)
//   Payouts v1  POST /v1/payments/payouts                      (organisers + member wallet cash-outs)
//               GET  /v1/payments/payouts/{batch_id}           (batch status)

import crypto from 'node:crypto'

const BASE = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com'
export const CURRENCY = process.env.CURRENCY || 'GBP'
export const isLive = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)
export const mode = () => (isLive() ? 'sandbox' : 'simulated')

const money = (pence) => ({ currency_code: CURRENCY, value: (pence / 100).toFixed(2) })

// ---------- real sandbox ----------
let token = null
async function getToken() {
  if (token && token.expires > Date.now()) return token.value
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`PayPal sign-in failed: ${data.error_description || res.status}`)
  token = { value: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 }
  return token.value
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': crypto.randomUUID(),
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const detail = data.details?.[0]?.issue || data.name || res.status
    throw new Error(`PayPal ${method} ${path} failed: ${detail}${data.message ? ` (${data.message})` : ''}`)
  }
  return data
}

// ---------- simulated ----------
const simId = (len = 17) => crypto.randomBytes(16).toString('hex').toUpperCase().slice(0, len)
const now = () => new Date().toISOString()

// ---------- public API ----------
export async function createOrder({ pence, description, referenceId }) {
  const body = {
    intent: 'AUTHORIZE',
    purchase_units: [{ reference_id: referenceId, description, amount: money(pence) }],
  }
  if (isLive()) return call('POST', '/v2/checkout/orders', body)
  return { id: simId(), intent: 'AUTHORIZE', status: 'CREATED', purchase_units: body.purchase_units, create_time: now() }
}

export async function authorizeOrder(orderId, pence) {
  const order = isLive()
    ? await call('POST', `/v2/checkout/orders/${orderId}/authorize`, {})
    : {
        id: orderId,
        status: 'COMPLETED',
        purchase_units: [{
          payments: { authorizations: [{ id: simId(), status: 'CREATED', amount: money(pence), expiration_time: new Date(Date.now() + 29 * 864e5).toISOString() }] },
        }],
      }
  const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0]
  if (!auth) throw new Error('PayPal returned no authorization')
  return { orderStatus: order.status, authorization: auth }
}

export async function captureAuthorization(authorizationId, pence, { finalCapture, note }) {
  const body = { amount: money(pence), final_capture: finalCapture, note_to_payer: note }
  if (isLive()) return call('POST', `/v2/payments/authorizations/${authorizationId}/capture`, body)
  return { id: simId(), status: 'COMPLETED', amount: body.amount, final_capture: finalCapture, create_time: now() }
}

export async function voidAuthorization(authorizationId) {
  if (isLive()) {
    await call('POST', `/v2/payments/authorizations/${authorizationId}/void`)
    return { id: authorizationId, status: 'VOIDED' }
  }
  return { id: authorizationId, status: 'VOIDED' }
}

// items: [{ email, pence, note, ref }]
export async function sendPayouts(items, { subject, batchRef }) {
  const body = {
    sender_batch_header: {
      sender_batch_id: `${batchRef}-${Date.now()}`,
      email_subject: subject,
      email_message: 'Paid through Turnout, a PayPal + AI hackathon demo by Commfy. Sandbox only, no real money.',
    },
    items: items.map((it) => ({
      recipient_type: 'EMAIL',
      receiver: it.email,
      amount: { value: (it.pence / 100).toFixed(2), currency: CURRENCY },
      note: it.note,
      sender_item_id: it.ref,
    })),
  }
  if (isLive()) {
    const data = await call('POST', '/v1/payments/payouts', body)
    return { batchId: data.batch_header.payout_batch_id, status: data.batch_header.batch_status }
  }
  return { batchId: simId(13), status: 'SUCCESS' }
}

export async function payoutStatus(batchId) {
  if (!isLive()) return 'SUCCESS'
  const data = await call('GET', `/v1/payments/payouts/${batchId}`)
  return data.batch_header.batch_status
}
