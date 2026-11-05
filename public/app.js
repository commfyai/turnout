const statusEl = document.getElementById('status')

async function loadStatus() {
  try {
    const res = await fetch('/api/health')
    const health = await res.json()
    const parts = [
      health.paypal ? 'PayPal sandbox connected' : 'PayPal sandbox not set up yet',
      health.ai ? 'AI connected' : 'AI not set up yet',
    ]
    statusEl.textContent = parts.join(' · ')
  } catch {
    statusEl.textContent = 'Server not reachable'
  }
}

loadStatus()
