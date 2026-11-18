// Supabase Edge Function: conversational food logging.
// Takes the chat so far (text + optional photos) and returns a reply plus
// structured food items the user can add to their log with one tap.
// Uses the same ANTHROPIC_API_KEY secret as estimate-food. JWT verification stays on.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM = `You are a friendly nutrition assistant inside a calorie tracker. The user describes what they ate and/or sends photos of food. Estimate nutrition for the portions described or shown.
- Always answer by calling the respond tool.
- "reply": short, conversational (1-3 sentences). Mention key portion assumptions.
- "items": one entry per distinct food or meal, with nutrition for the whole portion. Items are added to the user's food log automatically.
- "action": "log" when the user tells you about food they ate (add the items); "replace" when they correct food you already logged in this chat (your items fully replace the last logged set); "none" when you only ask a clarifying question or chat (items must be empty).
- Prefer logging with reasonable assumptions over asking questions. Ask only if you genuinely cannot estimate.
- If the user gives their own numbers (calories, protein, etc.), use them exactly and estimate only the missing values.
- Units: calories kcal; protein/carbs/fat/fiber/sugar/saturated_fat grams; sodium/cholesterol/potassium/calcium/iron/magnesium/vitamin_c mg; vitamin_d mcg. Use numbers, never ranges. Estimate every nutrient from typical values for the foods; use 0 only when a food genuinely contains none.
- Do not give medical advice. You may comment briefly on how the meal fits their remaining calories when context is provided.`

const TOOL = {
  name: 'respond',
  description: 'Reply to the user and propose food items to log.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      action: { type: 'string', enum: ['log', 'replace', 'none'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            calories: { type: 'number' },
            protein: { type: 'number' },
            carbs: { type: 'number' },
            fat: { type: 'number' },
            fiber: { type: 'number' },
            sugar: { type: 'number' },
            sodium: { type: 'number' },
            saturated_fat: { type: 'number' },
            cholesterol: { type: 'number' },
            potassium: { type: 'number' },
            calcium: { type: 'number' },
            iron: { type: 'number' },
            magnesium: { type: 'number' },
            vitamin_c: { type: 'number' },
            vitamin_d: { type: 'number' },
          },
          required: [
            'name', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium',
            'saturated_fat', 'cholesterol', 'potassium', 'calcium', 'iron', 'magnesium', 'vitamin_c', 'vitamin_d',
          ],
        },
      },
    },
    required: ['reply', 'action', 'items'],
  },
}

type Msg = { role: 'user' | 'assistant'; text?: string; image?: string; mediaType?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  try {
    const { messages, context } = (await req.json()) as { messages: Msg[]; context?: string }
    if (!Array.isArray(messages) || !messages.length) return json({ error: 'messages required' }, 400)

    // Keep requests bounded: last 16 turns, and only the 3 most recent photos.
    const recent = messages.slice(-16)
    let photosLeft = 3
    const keepImage = new Set<number>()
    for (let i = recent.length - 1; i >= 0 && photosLeft > 0; i--) {
      if (recent[i].image) {
        keepImage.add(i)
        photosLeft--
      }
    }

    const apiMessages = recent
      .map((m, i) => {
        const content: unknown[] = []
        if (m.role === 'user' && m.image && keepImage.has(i)) {
          content.push({ type: 'image', source: { type: 'base64', media_type: m.mediaType ?? 'image/jpeg', data: m.image } })
        }
        content.push({ type: 'text', text: m.text?.trim() || (m.image ? '(photo)' : '…') })
        return { role: m.role, content }
      })
      // The API requires the conversation to start with a user turn.
      .filter((_, i, arr) => arr.findIndex((x) => x.role === 'user') <= i)

    const call = async () => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5-5',
          max_tokens: 8000,
          system: SYSTEM + (context ? `\n\nUser's day so far: ${context}` : ''),
          tools: [TOOL],
          messages: apiMessages,
        }),
      })
      return { res, data: await res.json() }
    }
    const hasTool = (d: { content?: { type: string }[] }) => d.content?.some((c) => c.type === 'tool_use')

    // This model can't be forced to use the tool, and occasionally answers in plain text
    // (claiming it logged food without returning items). Retry once when that happens.
    let { res, data } = await call()
    if (res.ok && data.stop_reason !== 'max_tokens' && !hasTool(data)) ({ res, data } = await call())
    if (!res.ok) return json({ error: data?.error?.message ?? 'Anthropic API error' }, 502)

    // A cut-off response has a truncated tool input, so never treat it as a real answer.
    if (data.stop_reason === 'max_tokens') {
      return json({ error: 'The response was too long and got cut off. Try again or split the meal up.' }, 502)
    }

    // This model doesn't allow forcing a tool, so fall back to plain text if it skipped the tool.
    const block = data.content?.find((c: { type: string }) => c.type === 'tool_use')
    const text = data.content
      ?.filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('\n')
      .trim()
    if (block) {
      const items = Array.isArray(block.input.items) ? block.input.items : []
      const action = items.length ? (block.input.action === 'replace' ? 'replace' : 'log') : 'none'
      return json({ reply: block.input.reply || text || '', action, items })
    }
    if (!text) return json({ error: 'No response from model' }, 502)
    return json({ reply: text, action: 'none', items: [] })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
