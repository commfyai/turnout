import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// Which outside services are set up. Never returns the keys themselves.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    paypal: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    ai: Boolean(process.env.AZURE_OPENAI_KEY && process.env.AZURE_OPENAI_ENDPOINT),
  })
})

app.listen(PORT, () => {
  console.log(`Turnout running on http://localhost:${PORT}`)
})
