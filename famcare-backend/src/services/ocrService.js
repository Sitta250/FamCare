/**
 * OCR adapter — single extraction entry point.
 * Set OCR_DISABLED=true in .env to skip OCR and store empty ocrText.
 *
 * To enable OCR with OpenAI Vision, set:
 *   OCR_PROVIDER=openai
 *   OPENAI_API_KEY=...
 */

export async function extractText(imageUrl) {
  if (process.env.OCR_DISABLED === 'true') return ''

  const provider = process.env.OCR_PROVIDER ?? 'none'

  if (provider === 'openai') {
    return extractWithOpenAI(imageUrl)
  }

  console.warn('[ocr] No OCR provider configured. Set OCR_PROVIDER or OCR_DISABLED=true.')
  return ''
}

async function extractWithOpenAI(imageUrl) {
  const { default: OpenAI } = await import('openai').catch(() => {
    throw Object.assign(new Error('openai package not installed. Run: npm install openai'), { status: 500, code: 'OCR_UNAVAILABLE' })
  })

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all text from this medical document image. Return only the raw text, no commentary.' },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    max_tokens: 2000,
  })

  return response.choices[0]?.message?.content ?? ''
}
