import { jest } from '@jest/globals'

// ── Mock handles ──────────────────────────────────────────────────────────────
const mockGeminiGenerateContent = jest.fn()
const mockDeepSeekCreate = jest.fn()

// ── Module mocks ──────────────────────────────────────────────────────────────
jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGeminiGenerateContent,
    }),
  })),
}))

jest.unstable_mockModule('openai', () => ({
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockDeepSeekCreate,
      },
    },
  })),
}))

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    conversationMessage: {
      findMany:   jest.fn().mockResolvedValue([]),
      findFirst:  jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pendingAction: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  },
}))

jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: jest.fn(),
  listAppointments:  jest.fn().mockResolvedValue([]),
}))
jest.unstable_mockModule('../services/medicationService.js', () => ({
  listMedications:         jest.fn().mockResolvedValue([]),
  createMedicationLog:     jest.fn(),
  MEDICATION_LOG_STATUSES: new Set(['TAKEN', 'MISSED', 'SKIPPED']),
}))
jest.unstable_mockModule('../services/healthMetricService.js', () => ({
  listHealthMetrics:  jest.fn().mockResolvedValue([]),
  createHealthMetric: jest.fn(),
}))
jest.unstable_mockModule('../services/symptomLogService.js', () => ({
  createSymptomLog: jest.fn(),
  listSymptomLogs:  jest.fn().mockResolvedValue([]),
}))

// ── Dynamic imports after mocks ───────────────────────────────────────────────
const { handleAiMessage, callLLMWithFailover } = await import('../services/aiService.js')

// ── Helpers ───────────────────────────────────────────────────────────────────
const noopSleep = jest.fn().mockResolvedValue(undefined)
const PROMPT = 'test prompt'
const CHAT_JSON = '{"intent":"chat","reply":"ok"}'
const FALLBACK_TEXT = 'ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'
const USER = { id: 'user-1', lineUserId: 'line-user-1' }
const MEMBERS = [{ id: 'member-1', name: 'แม่' }]

function geminiOk(text = CHAT_JSON) {
  mockGeminiGenerateContent.mockResolvedValueOnce({
    response: { text: () => text },
  })
}

function geminiFail(err = new Error('network error')) {
  mockGeminiGenerateContent.mockRejectedValueOnce(err)
}

function deepseekOk(text = CHAT_JSON) {
  mockDeepSeekCreate.mockResolvedValueOnce({
    choices: [{ message: { content: text } }],
  })
}

function deepseekFail(err = new Error('deepseek error')) {
  mockDeepSeekCreate.mockRejectedValueOnce(err)
}

beforeEach(() => {
  jest.clearAllMocks()
  noopSleep.mockResolvedValue(undefined)
  process.env.GEMINI_API_KEY = 'test-gemini-key'
  process.env.DEEPSEEK_API_KEY = 'test-deepseek-key'
})

// ── callLLMWithFailover ───────────────────────────────────────────────────────

describe('callLLMWithFailover', () => {
  test('1. Gemini succeeds first try → provider=gemini, no sleep', async () => {
    geminiOk()
    const result = await callLLMWithFailover(PROMPT, noopSleep)
    expect(result.provider).toBe('gemini')
    expect(result.raw).toContain('intent')
    expect(noopSleep).not.toHaveBeenCalled()
    expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(1)
  })

  test('2. Gemini fails first (non-4xx), succeeds second → provider=gemini, sleep called once', async () => {
    geminiFail(new Error('transient network error'))
    geminiOk('{"intent":"chat","reply":"retry ok"}')
    const result = await callLLMWithFailover(PROMPT, noopSleep)
    expect(result.provider).toBe('gemini')
    expect(result.raw).toContain('retry ok')
    expect(noopSleep).toHaveBeenCalledTimes(1)
    expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(2)
  })

  test('3. Both Gemini attempts fail (non-4xx) → DeepSeek called → provider=deepseek', async () => {
    geminiFail()
    geminiFail()
    deepseekOk('{"intent":"chat","reply":"from deepseek"}')
    const result = await callLLMWithFailover(PROMPT, noopSleep)
    expect(result.provider).toBe('deepseek')
    expect(result.raw).toContain('from deepseek')
    expect(mockDeepSeekCreate).toHaveBeenCalledTimes(1)
    expect(noopSleep).toHaveBeenCalledTimes(1)
  })

  test('4. Gemini 4xx → no retry → DeepSeek called immediately → provider=deepseek', async () => {
    const err4xx = Object.assign(new Error('unauthorized'), { status: 401 })
    geminiFail(err4xx)
    deepseekOk()
    const result = await callLLMWithFailover(PROMPT, noopSleep)
    expect(result.provider).toBe('deepseek')
    expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(1)
    expect(noopSleep).not.toHaveBeenCalled()
    expect(mockDeepSeekCreate).toHaveBeenCalledTimes(1)
  })

  test('5. Both providers fail → provider=fallback, empty raw returned', async () => {
    geminiFail()
    geminiFail()
    deepseekFail()
    const result = await callLLMWithFailover(PROMPT, noopSleep)
    expect(result.provider).toBe('fallback')
    expect(result.raw).toBe('')
  })

  test('6. DEEPSEEK_API_KEY absent → skip DeepSeek → provider=fallback', async () => {
    delete process.env.DEEPSEEK_API_KEY
    geminiFail()
    geminiFail()
    const result = await callLLMWithFailover(PROMPT, noopSleep)
    expect(result.provider).toBe('fallback')
    expect(mockDeepSeekCreate).not.toHaveBeenCalled()
  })
})

// ── handleAiMessage failover wiring ──────────────────────────────────────────

describe('handleAiMessage failover wiring', () => {
  test('7. returns FALLBACK_TEXT when provider=fallback', async () => {
    // 4xx skips retry; no DEEPSEEK_API_KEY → fallback, no sleep
    delete process.env.DEEPSEEK_API_KEY
    const err4xx = Object.assign(new Error('bad api key'), { status: 400 })
    geminiFail(err4xx)
    const reply = await handleAiMessage('test', USER, MEMBERS)
    expect(reply).toEqual({ type: 'text', text: FALLBACK_TEXT })
  })

  test('8. processes intent normally when provider=deepseek', async () => {
    // 4xx Gemini → DeepSeek succeeds, no sleep
    const err4xx = Object.assign(new Error('quota exceeded'), { status: 429 })
    geminiFail(err4xx)
    deepseekOk('{"intent":"chat","reply":"deepseek ตอบ"}')
    const reply = await handleAiMessage('test', USER, MEMBERS)
    expect(reply).toEqual({ type: 'text', text: 'deepseek ตอบ' })
  })
})
