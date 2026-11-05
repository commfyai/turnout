# Turnout

**Brands pay only for people who showed up.**

Turnout is Commfy's entry for PayPal's "Build What's Next with PayPal and AI" hackathon. A brand states its goal and budget, Commfy's AI picks the communities and the deal, PayPal holds the money, and it pays out only once people actually check in at the event.

All communities, members and numbers in this repo are made up. It runs on the PayPal **sandbox** only, so no real money moves.

> Work in progress. The full loop is being built now.

## Run it locally

You need Node 20 or newer.

```bash
git clone https://github.com/commfyai/turnout.git
cd turnout
npm install
cp .env.example .env   # then fill in the keys (see below)
npm start
```

Open http://localhost:3000.

## Keys

| Variable | Where it comes from |
| --- | --- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → Sandbox → Create App |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY` | An Azure OpenAI resource with a chat model deployment |

## Licence

[AGPL-3.0](LICENSE).
