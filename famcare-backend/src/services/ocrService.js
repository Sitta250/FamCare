/**
 * OCR adapter — single extraction entry point.
 * Set OCR_DISABLED=true in .env to skip OCR and store empty ocrText.
 *
 * Supported providers:
 *   OCR_PROVIDER=openai
 *   OPENAI_API_KEY=...
 *
 *   OCR_PROVIDER=google
 *   GOOGLE_APPLICATION_CREDENTIALS=...
 *   or GOOGLE_VISION_API_KEY=...
 *
 *   OCR_PROVIDER=tesseract
 */

export async function extractText(imageUrl) {
  if (process.env.OCR_DISABLED === 'true') return ''

  const provider = process.env.OCR_PROVIDER ?? 'none'

  if (provider === 'openai') return extractWithOpenAI(imageUrl)
  if (provider === 'google') return extractWithGoogleVision(imageUrl)
  if (provider === 'tesseract') return extractWithTesseract(imageUrl)

  if (provider === 'none') {
    console.warn('[ocr] No OCR provider configured. Set OCR_PROVIDER or OCR_DISABLED=true.')
    return ''
  }

  console.warn(`[ocr] Unsupported OCR provider "${provider}". Returning empty text.`)
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

async function extractWithGoogleVision(imageUrl) {
  const visionModule = await import('@google-cloud/vision').catch(() => {
    throw Object.assign(
      new Error('@google-cloud/vision package not installed. Run: npm install --save-optional @google-cloud/vision'),
      { status: 500, code: 'OCR_UNAVAILABLE' }
    )
  })

  const ImageAnnotatorClient =
    visionModule.ImageAnnotatorClient ??
    visionModule.default?.ImageAnnotatorClient

  const options = process.env.GOOGLE_VISION_API_KEY
    ? { apiKey: process.env.GOOGLE_VISION_API_KEY }
    : undefined

  const client = new ImageAnnotatorClient(options)

  try {
    const [result] = await client.textDetection(imageUrl)
    return result?.textAnnotations?.[0]?.description ?? ''
  } finally {
    await client.close?.()
  }
}

async function extractWithTesseract(imageUrl) {
  const tesseractModule = await import('tesseract.js').catch(() => {
    throw Object.assign(
      new Error('tesseract.js package not installed. Run: npm install --save-optional tesseract.js'),
      { status: 500, code: 'OCR_UNAVAILABLE' }
    )
  })

  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw Object.assign(new Error(`Failed to fetch image for OCR: ${response.status}`), {
      status: 502,
      code: 'OCR_FETCH_FAILED',
    })
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer())

  if (typeof tesseractModule.recognize === 'function') {
    const result = await tesseractModule.recognize(imageBuffer, 'tha+eng')
    return result?.data?.text ?? ''
  }

  if (typeof tesseractModule.createWorker === 'function') {
    const worker = await tesseractModule.createWorker('tha+eng')

    try {
      const result = await worker.recognize(imageBuffer)
      return result?.data?.text ?? ''
    } finally {
      await worker.terminate?.()
    }
  }

  throw Object.assign(new Error('Unsupported tesseract.js API'), {
    status: 500,
    code: 'OCR_UNAVAILABLE',
  })
}
