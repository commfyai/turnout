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

Turnout lets a brand fund real-life community events and pay only for verified results. The organiser is paid like a salesperson: a base, then results pay on the goals the brand cares about.

1. **Request.** The brand types its goal (product feedback or awareness), who it wants to reach, and a budget.
2. **AI match.** Commfy's AI reads the request against a list of communities and picks 2–3 that fit, explains why, proposes what happens at each event, and writes one short question members can answer at check-in. It also recommends the mix: how the organisers' results pay is split between people there, survey answers and new faces. A brand that wants feedback gets a mix weighted to survey answers. The brand can drag the sliders before approving.
3. **Approve and hold.** The brand approves in PayPal's window. PayPal holds the whole budget with an Orders API authorization. Each organiser gets 30% of their share as base pay straight away, because venue and food are paid before the event.
4. **Event day.** Members check in by scanning a door code that changes every 30 seconds, on their own phones. Location is recorded as a second check. Members who answer two quick questions (how welcome they felt, and the brand's question) get £1 of the brand's money in their wallet, with the brand's name on it. No app or account: just the door code and a PayPal email.
5. **Payouts.** When the events close, each organiser is paid on results through PayPal Payouts: 60% of their share split by the mix, each part paid in proportion to what happened and capped, plus a 10% posts-and-photos bonus the brand awards at its discretion. PayPal captures only what was earned; the rest is never taken from the brand. Commfy keeps 30% of what the brand actually paid. Members cash out their wallet to their PayPal email from £2.
6. **Proof.** The brand gets a report: how many people came to each event, how welcome they felt, the answers to its question, and where every pound went. Members appear only as anonymous references, and answers are shown only once 5 or more people have answered. The full check-in record can be downloaded to audit.

Every PayPal call appears in a live payout ledger, so a judge can follow the money from the brand's budget to each organiser and member.

### How we built it

- **PayPal:** Orders v2 with intent `AUTHORIZE` to hold the budget; Payments v2 partial capture for the base pay and a final capture on results, which releases the unused part of the hold back to the brand; Payouts v1 batches for organisers and member cash-outs. All in the PayPal sandbox.
- **AI:** Azure OpenAI (`gpt-chat-latest`) with a strict JSON schema. It picks and weights the communities, writes the reasons, the deal and the check-in question, and recommends the payout mix for the brand's goal. The AI only suggests: the server checks the mix adds up, keeps the base and caps fixed, and turns everything into amounts in pence, so the money always adds up to the budget.
- **App:** Node and Express with plain HTML and JavaScript. The payout ledger is built with AG Grid. Hosted on Render.
- **Built with Claude Code.**

### Challenges we ran into

- Keeping the money exact: every amount is held in pence, and the base pay, final capture and amount returned to the brand always add up to the budget.
- Making proof hard to fake: the door code is signed by the server and changes every 30 seconds, each PayPal email can check in once per event, and every results pot is capped, so the brand can never pay more than it approved.
- Fitting the whole loop on one screen so it can be followed in a three-minute video.

### Accomplishments that we're proud of

The full loop runs end to end in a few minutes: request, AI match, PayPal hold, door check-ins, payouts and a proof report the brand can audit.

### What we learned

A PayPal authorization fits this model well: one hold covers the whole budget, a partial capture pays the base, and the final capture takes only what the results earned.

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
| 0:20–0:45 | Type the brand, goal, audience and £1,500 budget. Press *Ask Commfy*. | "A brand tells Commfy what it wants: here, a new oat drink wants feedback from active people in East London, with a budget of fifteen hundred pounds." |
| 0:45–1:20 | The AI's picks and its recommended mix. Drag the *Survey answers* slider and show the amounts change. Press *Approve*, log in to PayPal's sandbox window. | "Commfy's AI picks three communities and says why. It also recommends how the organisers get paid: this brand wants feedback, so most of the pay rewards survey answers. The brand can adjust it, then approves in PayPal. PayPal holds the whole budget, and each organiser gets 30% base pay straight away." Point at the money bar along the top. |
| 1:20–1:55 | Press *Show door code*. Scan it with the phone, check in, answer the two questions. Show the wallet. | "At the door, members scan a code that changes every 30 seconds, on their own phone. Answering two quick questions puts one pound from the brand into their wallet, with the brand's name on it. No app, no account." Show the count go up on the big screen. |
| 1:55–2:30 | Press *Fill the rest of the crowd*, tick the posts & photos bonus on the first community, then *Close events and pay out*. Open *Show how PayPal moves the money* to show every PayPal call. | "After the events, each organiser is paid on results: people there, survey answers and new faces, each up to its cap. The brand awards a bonus to the community that shared the night. PayPal captures only what was earned; the rest never leaves the brand." |
| 2:30–2:45 | Scroll to the proof report. Then on the phone, press *Cash out*. | "The brand gets a proof report: who came, who answered, new faces, how welcome they felt and their answers, with no personal data. Members cash out to PayPal." |
| 2:45–2:55 | The tagline on screen. | "Turnout. Brands pay only for people who showed up. Commfy: find your people IRL." |

Before recording: start a fresh request so the ledger is empty, and use a sandbox personal account email on the phone so the cash-out lands in the sandbox.
