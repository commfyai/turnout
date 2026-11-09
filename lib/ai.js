// Commfy's matching agent: picks 2–3 communities for the brand's goal, the deal at the event,
// and why. Uses Azure OpenAI when AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY are set; otherwise a
// simple rule-based match, clearly labelled as such. The money split is NOT left to the AI:
// the server computes it from the AI's weights so the numbers always add up.

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '')
const KEY = process.env.AZURE_OPENAI_KEY
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-chat-latest'
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview'

export const isLive = () => Boolean(ENDPOINT && KEY)
export const mode = () => (isLive() ? `Azure OpenAI (${DEPLOYMENT})` : 'rule-based match (no AI key set)')

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'deal', 'brandQuestion', 'picks'],
  properties: {
    summary: { type: 'string', description: 'One or two sentences to the brand: why these communities.' },
    deal: { type: 'string', description: 'What happens at each event for the brand, in one sentence. Must suit the community, never pushy.' },
    brandQuestion: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'options'],
      properties: {
        text: { type: 'string', description: 'One short optional question members answer at check-in, useful for the brand goal.' },
        options: { type: 'array', items: { type: 'string' }, description: '3 or 4 short answer options.' },
      },
    },
    picks: {
      type: 'array',
      description: '2 or 3 communities, best first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'weight', 'reason'],
        properties: {
          id: { type: 'string' },
          weight: { type: 'integer', description: '1-10: how strongly this community fits; sets its share of the budget.' },
          reason: { type: 'string', description: 'One sentence: why this community fits the brand goal.' },
        },
      },
    },
  },
}

export async function matchCommunities(request, communities) {
  const eligible = communities.filter((c) => c.acceptsBrandFunding)
  if (isLive()) {
    try {
      return { source: 'ai', model: DEPLOYMENT, ...(await askAzure(request, eligible)) }
    } catch (err) {
      console.error('AI match failed, using rules:', err.message)
      return { source: 'rules', note: `AI call failed (${err.message}); rule-based match used`, ...ruleMatch(request, eligible) }
    }
  }
  return { source: 'rules', note: 'No AI key set; rule-based match used', ...ruleMatch(request, eligible) }
}

async function askAzure(request, eligible, retry = true) {
  const catalogue = eligible.map(({ id, name, area, interests, regulars, event }) => ({ id, name, area, interests, regulars, nextEvent: event.title }))
  const res = await fetch(`${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': KEY },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content:
            "You are Commfy's matching agent. A brand funds real-life community events and pays only for people who actually check in. " +
            'Pick the 2 or 3 communities whose members best match the brand audience and goal, from the catalogue only. ' +
            'Prefer the area the brand names. The deal must respect the community: the brand supports the event, it does not take it over. ' +
            'Write plainly, no hype.',
        },
        { role: 'user', content: JSON.stringify({ brand: request.brand, goal: request.goal, audience: request.audience, budget: `${request.budget} ${request.currency}`, catalogue }) },
      ],
      max_completion_tokens: 1500,
      response_format: { type: 'json_schema', json_schema: { name: 'match', strict: true, schema: SCHEMA } },
    }),
  })
  const data = await res.json()
  if (res.status === 429 && retry) {
    // Busy: wait as asked (max 8s) and try once more.
    const wait = Math.min(8, Number(res.headers.get('retry-after')) || 3)
    await new Promise((r) => setTimeout(r, wait * 1000))
    return askAzure(request, eligible, false)
  }
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
  const out = JSON.parse(data.choices[0].message.content)
  const ids = new Set(eligible.map((c) => c.id))
  const picks = out.picks.filter((p) => ids.has(p.id)).slice(0, 3)
  if (picks.length < 2) throw new Error('AI picked fewer than 2 valid communities')
  picks.forEach((p) => { p.weight = Math.min(10, Math.max(1, p.weight)) })
  return { ...out, picks }
}

// ---------- fallback ----------
// Crude stems so "run"/"running" and "cycle"/"cycling" meet.
const stem = (w) => w.replace(/(ning|ing|ers|er|es|s|e)$/, '')
const words = (s) => (s.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2).map(stem)

function ruleMatch(request, eligible) {
  const text = new Set(words(`${request.audience} ${request.brand}`))
  const scored = eligible.map((c) => {
    const interestHits = c.interests.filter((i) => words(i).some((w) => text.has(w)))
    // "Hackney" or "East London" named in the request; plain "London" matches everything so it doesn't count.
    const [place, region = ''] = c.area.split(',').map((s) => s.trim().toLowerCase())
    const asked = request.audience.toLowerCase()
    const areaHit = asked.includes(place) || (region && asked.includes(region))
    return { c, interestHits, areaHit, score: interestHits.length * 3 + (areaHit ? 2 : 0) + c.regulars / 100 }
  })
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 3)
  const picks = top.map(({ c, interestHits, areaHit, score }) => ({
    id: c.id,
    weight: Math.max(1, Math.min(10, Math.round(score) || 1)),
    reason: `${interestHits.length ? `Shares your audience's interest in ${interestHits.join(', ')}` : 'Large, active group'}; meets in ${c.area}${areaHit ? ', the area you named' : ''}.`,
  }))
  const goalDeal = {
    'product feedback': `Members try ${request.brand} at the event and answer one question at check-in.`,
    awareness: `${request.brand} is named as the event's supporter at check-in and on the payout.`,
  }
  return {
    summary: `Matched on shared interests and area (keyword rules, not AI).`,
    deal: goalDeal[request.goal] || goalDeal.awareness,
    brandQuestion:
      request.goal === 'product feedback'
        ? { text: `Would you buy ${request.brand} after tonight?`, options: ['Yes', 'Maybe', 'No'] }
        : { text: `Had you heard of ${request.brand} before tonight?`, options: ['Yes', 'No'] },
    picks,
  }
}
