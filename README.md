# Turnout

**Brands pay only for people who showed up.**

Turnout is Commfy's entry for PayPal's "Build What's Next with PayPal and AI" hackathon. A brand states its goal and budget, Commfy's AI picks the communities and the deal, PayPal holds the money, and it pays out only once people actually check in at the event.

All communities, members and numbers in this repo are made up. It runs on the PayPal **sandbox** only, so no real money moves.

## Run it

You need Node 20 or newer.

```bash
git clone https://github.com/commfyai/turnout.git
cd turnout
npm install
npm start
```

Open http://localhost:3000. It works straight away with **no keys**: PayPal runs in a clearly labelled *simulated* mode and the matching falls back to simple rules. Add keys (below) to switch on the real PayPal sandbox and the AI.

## Try the whole loop (under 5 minutes)

1. **Request:** keep the sample brand or write your own, then press *Ask Commfy's AI*.
2. **Approve + hold:** read the AI's picks and the money split, then approve. PayPal holds the whole budget and pays each organiser a deposit of 30% of their share.
3. **Event day:** press *Show door code* and scan it with your phone (or open the link) to check in. Your £1 appears in your wallet with the brand's name on it. On your own machine the QR code points at the address you opened, so for a phone open the dashboard by your computer's network address (or use the deployed link); location needs HTTPS and shows "not shared" otherwise.
4. Press *Fill the rest of the crowd* to add simulated members. The third event is left under the 60% minimum on purpose.
5. **Payouts:** press *Close events and release payouts*. PayPal captures only what was earned, pays the organisers, and the rest of the hold goes back to the brand.
6. **Proof:** read the proof report, download the check-in record, and cash out your wallet on your phone.

## Keys

Copy `.env.example` to `.env` and fill in what you have.

| Variable | Where it comes from |
| --- | --- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → Sandbox → Create App |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY` | An Azure OpenAI resource with a chat deployment (default name `gpt-chat-latest`) |

**Sandbox test account:** with PayPal keys set, the approve step opens PayPal's own window. Log in there with a sandbox *personal* account from developer.paypal.com → Testing Tools → Sandbox Accounts (PayPal creates one for you).

## How it uses PayPal

All in [`lib/paypal.js`](lib/paypal.js):

| Step | PayPal API |
| --- | --- |
| Brand approves the budget | Orders v2: create with intent `AUTHORIZE`, then authorize (the hold) |
| Organiser deposits | Payments v2: partial capture of the authorization, then a Payouts batch |
| Release on proof | Payments v2: final capture of only what was earned; the rest is released to the brand |
| Organisers' remaining shares | Payouts v1 batch |
| Member wallet cash-out | Payouts v1 to the member's PayPal email |

In production the brand money would go through PayPal's marketplace setup so the payment is split at source and Commfy never holds it. The demo keeps one account for simplicity.

## How it uses AI

[`lib/ai.js`](lib/ai.js) sends the brand's request and the made-up community list to Azure OpenAI with a strict JSON schema. The model picks 2–3 communities, weights them, writes why, the deal at the event and one check-in question for the brand. The server turns those weights into money, so the numbers always add up to the budget.

## Deploy on Render

`render.yaml` is a Render blueprint: render.com → New → Blueprint → this repo, then paste the keys when asked.

## Licence

[AGPL-3.0](LICENSE).
