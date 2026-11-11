# Devpost submission draft

Draft text for the Devpost form and the demo video. Ramit owns the final wording; everything here can be changed.

---

## Project name

Turnout

## Tagline

Brands pay only for people who showed up.

## Description

### Inspiration

Brands want to reach real communities, and community organisers need money to keep their events going: venue hire, food, kit. Today a brand that sponsors a community event has little proof that anyone came. Organisers often pay the costs up front and hope the sponsor money arrives.

### What it does

Turnout lets a brand fund real-life community events and pay only for verified turnout.

1. **Request.** The brand types its goal (product feedback or awareness), who it wants to reach, and a budget.
2. **AI match.** Commfy's AI reads the request against a list of communities and picks 2–3 that fit, explains why, proposes what happens at each event, and writes one short question members can answer at check-in.
3. **Approve and hold.** The brand approves in PayPal's window. PayPal holds the whole budget with an Orders API authorization. Each organiser gets 30% of their share as a deposit straight away, because venue and food are paid before the event.
4. **Event day.** Members check in by scanning a door code that changes every 30 seconds, on their own phones. Location is recorded as a second check. Each verified check-in puts £1 of the brand's money into the member's wallet, with the brand's name on it.
5. **Payouts.** When the events close, PayPal captures only what was earned. An organiser whose event reached 60% of sign-ups gets the rest of their share through PayPal Payouts. Below 60%, the organiser keeps the deposit and the rest is never taken from the brand. Members cash out their wallet to their PayPal email from £2.
6. **Proof.** The brand gets a report: how many people came to each event, how welcome they felt, the answers to its question, and where every pound went. Members appear only as anonymous references, and answers are shown only once 5 or more people have answered. The full check-in record can be downloaded to audit.

Every PayPal call appears in a live payout ledger, so a judge can follow the money from the brand's budget to each organiser and member.

### How we built it

- **PayPal:** Orders v2 with intent `AUTHORIZE` to hold the budget; Payments v2 partial capture for the deposits and a final capture on proof, which releases the unused part of the hold back to the brand; Payouts v1 batches for organisers and member cash-outs. All in the PayPal sandbox.
- **AI:** Azure OpenAI (`gpt-chat-latest`) with a strict JSON schema. It picks and weights the communities, writes the reasons, the deal and the check-in question. The server turns the weights into amounts in pence, so the split always adds up to the budget.
- **App:** Node and Express with plain HTML and JavaScript. The payout ledger is built with AG Grid. Hosted on Render.
- **Built with Claude Code.**

### Challenges we ran into

- Keeping the money exact: every amount is held in pence, and the deposit, final capture and amount returned to the brand always add up to the budget.
- Making proof hard to fake: the door code is signed by the server and changes every 30 seconds, each PayPal email can check in once per event, and money is released only above a minimum turnout.
- Fitting the whole loop on one screen so it can be followed in a three-minute video.

### Accomplishments that we're proud of

The full loop runs end to end in a few minutes: request, AI match, PayPal hold, door check-ins, payouts and a proof report the brand can audit.

### What we learned

A PayPal authorization fits this model well: one hold covers the whole budget, a partial capture pays the deposits, and the final capture takes only what turnout earned.

### What's next for Turnout

- Move to PayPal's marketplace setup so payments are split at source and Commfy never holds brand money.
- Place holds closer to event dates, since an authorization lasts a limited time.
- Let a brand's own AI assistant make the request through a connector (MCP).
- Take legal advice on member wallets before any real money moves.

### Built with

PayPal Orders API, PayPal Payments API, PayPal Payouts API, Azure OpenAI, Node.js, Express, AG Grid, Render, Claude Code

### Links

- Code: https://github.com/commfyai/turnout (AGPL-3.0)
- Live demo: https://turnout-9vy5.onrender.com (PayPal sandbox; the free server sleeps when idle, so the first visit can take about a minute)
- Video: (add the YouTube link)

All communities, people and numbers in the demo are made up. It runs on the PayPal sandbox only.

---

## Demo video script (about 2:50)

Record the screen at the live Render link, with a phone beside you for the check-in. No music.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00–0:20 | The Turnout page, empty form | "Brands pay for reach they can't check, and community organisers pay for events out of their own pocket. Turnout lets a brand fund real community events and pay only for the people who showed up." |
| 0:20–0:45 | Type the brand, goal, audience and £1,500 budget. Press *Ask Commfy's AI*. | "A brand tells Commfy what it wants: here, a new oat drink wants feedback from active people in East London, with a budget of fifteen hundred pounds." |
| 0:45–1:15 | The AI's picks, reasons and split in the Communities panel. Press *Approve*, log in to PayPal's sandbox window. | "Commfy's AI picks three communities, says why, and proposes what happens at each event. The brand approves in PayPal. PayPal now holds the whole budget, and each organiser gets a 30% deposit straight away." Point at the ledger rows. |
| 1:15–1:55 | Press *Show door code*. Scan it with the phone, check in, answer the two questions. Show the wallet. | "At the door, members scan a code that changes every 30 seconds, on their own phone. Each check-in puts one pound from the brand into their wallet, with the brand's name on it." Show the count go up on the big screen. |
| 1:55–2:30 | Press *Fill the rest of the crowd*, then *Close events and release payouts*. Show the ledger. | "After the events, PayPal captures only what turnout earned. Two events passed the 60% minimum, so their organisers are paid the rest. The third fell short: its organiser keeps the deposit, and the rest of the money never leaves the brand." |
| 2:30–2:45 | Scroll to the proof report. Then on the phone, press *Cash out*. | "The brand gets a proof report: who came, how welcome they felt, and their answers, with no personal data. Members cash out to PayPal." |
| 2:45–2:55 | The tagline on screen. | "Turnout. Brands pay only for people who showed up. Commfy: find your people IRL." |

Before recording: start a fresh request so the ledger is empty, and use a sandbox personal account email on the phone so the cash-out lands in the sandbox.
