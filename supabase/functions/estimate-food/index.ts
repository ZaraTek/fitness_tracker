// Supabase Edge Function: estimate calories/macros from a food photo.
// The Anthropic key lives here as a secret, never in the browser.
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy estimate-food
// JWT verification is on by default, so only signed-in users can call it.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROMPT = `You are a nutrition estimator. Look at the meal in the photo and estimate its nutrition for the whole portion shown.
Reply with ONLY a JSON object, no prose, in exactly this shape:
{"name": string, "calories": number, "protein": number, "carbs": number, "fat": number, "fiber": number, "sugar": number, "sodium": number, "saturated_fat": number, "cholesterol": number, "potassium": number, "calcium": number, "iron": number, "magnesium": number, "vitamin_c": number, "vitamin_d": number, "confidence": "low"|"medium"|"high", "notes": string}
Units: calories in kcal; protein/carbs/fat/fiber/sugar/saturated_fat in grams; sodium/cholesterol/potassium/calcium/iron/magnesium/vitamin_c in mg; vitamin_d in mcg. "notes" is one short sentence on portion assumptions.
If a user note is provided, treat it as authoritative about portion size or ingredients.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  try {
    const { image, mediaType = 'image/jpeg', note = '' } = await req.json()
    if (!image) return json({ error: 'image (base64) is required' }, 400)

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
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
              { type: 'text', text: PROMPT + (note ? `\n\nUser note: ${note}` : '') },
            ],
          },
        ],
      }),
    })
    const data = await res.json()
    if (!res.ok) return json({ error: data?.error?.message ?? 'Anthropic API error' }, 502)

    const text: string = data.content?.find((c: { type: string }) => c.type === 'text')?.text ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return json({ error: 'Could not parse estimate' }, 502)
    return json(JSON.parse(match[0]))
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
