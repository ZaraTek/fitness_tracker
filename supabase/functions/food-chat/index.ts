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
- "items": one entry per distinct food or meal to log, with nutrition for the whole portion. Use an empty array if you need to ask a clarifying question first, or if the user is just chatting.
- If the user corrects a portion or ingredient, return the corrected items in full (they replace your earlier suggestion).
- Units: calories kcal; protein/carbs/fat/fiber/sugar grams; sodium mg. Use numbers, never ranges.
- Do not give medical advice. You may comment briefly on how the meal fits their remaining calories when context is provided.`

const TOOL = {
  name: 'respond',
  description: 'Reply to the user and propose food items to log.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string' },
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
          },
          required: ['name', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium'],
        },
      },
    },
    required: ['reply', 'items'],
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

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 1000,
        system: SYSTEM + (context ? `\n\nUser's day so far: ${context}` : ''),
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'respond' },
        messages: apiMessages,
      }),
    })
    const data = await res.json()
    if (!res.ok) return json({ error: data?.error?.message ?? 'Anthropic API error' }, 502)

    const block = data.content?.find((c: { type: string }) => c.type === 'tool_use')
    if (!block) return json({ error: 'No response from model' }, 502)
    return json({ reply: block.input.reply ?? '', items: block.input.items ?? [] })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
