import { jest } from '@jest/globals'

describe('ocrService.extractText', () => {
  const originalEnv = { ...process.env }
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
    delete process.env.OCR_DISABLED
    delete process.env.OCR_PROVIDER
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    delete process.env.GOOGLE_VISION_API_KEY
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('returns empty string when OCR is disabled', async () => {
    process.env.OCR_DISABLED = 'true'
    process.env.OCR_PROVIDER = 'google'

    const { extractText } = await import('../services/ocrService.js')
    await expect(extractText('https://example.com/doc.jpg')).resolves.toBe('')
  })

  test('returns empty string when provider is none', async () => {
    process.env.OCR_PROVIDER = 'none'
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const { extractText } = await import('../services/ocrService.js')

    await expect(extractText('https://example.com/doc.jpg')).resolves.toBe('')
    expect(warnSpy).toHaveBeenCalledWith('[ocr] No OCR provider configured. Set OCR_PROVIDER or OCR_DISABLED=true.')

    warnSpy.mockRestore()
  })

  test('uses google vision provider when configured', async () => {
    process.env.OCR_PROVIDER = 'google'
    process.env.GOOGLE_APPLICATION_CREDENTIALS = './fake-key.json'

    const close = jest.fn()
    const textDetection = jest.fn().mockResolvedValue([
      { textAnnotations: [{ description: 'ข้อความภาษาไทย\nParacetamol' }] },
    ])

    jest.unstable_mockModule('@google-cloud/vision', () => ({
      ImageAnnotatorClient: jest.fn(() => ({ textDetection, close })),
    }))

    const { extractText } = await import('../services/ocrService.js')

    await expect(extractText('https://example.com/doc.jpg')).resolves.toBe('ข้อความภาษาไทย\nParacetamol')
    expect(textDetection).toHaveBeenCalledWith('https://example.com/doc.jpg')
    expect(close).toHaveBeenCalled()
  })

  test('uses tesseract provider when configured', async () => {
    process.env.OCR_PROVIDER = 'tesseract'

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    })

    jest.unstable_mockModule('tesseract.js', () => ({
      recognize: jest.fn().mockResolvedValue({ data: { text: 'ใบสั่งยา Aspirin' } }),
    }))

    const { extractText } = await import('../services/ocrService.js')

    await expect(extractText('https://example.com/doc.jpg')).resolves.toBe('ใบสั่งยา Aspirin')
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/doc.jpg')
  })

  test('throws OCR_UNAVAILABLE when google package is missing', async () => {
    process.env.OCR_PROVIDER = 'google'

    jest.unstable_mockModule('@google-cloud/vision', () => {
      throw new Error('Cannot find module')
    })

    const { extractText } = await import('../services/ocrService.js')

    await expect(extractText('https://example.com/doc.jpg')).rejects.toMatchObject({
      code: 'OCR_UNAVAILABLE',
      status: 500,
    })
  })
})
