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
const { logTelemetry, handleAiMessage, callLLMWithFailover } = await import('../services/aiService.js')

// ── Helpers ───────────────────────────────────────────────────────────────────
const CHAT_JSON = '{"intent":"chat","reply":"ok"}'
const USER = { id: 'user-1', lineUserId: 'line-user-1' }
const MEMBERS = [{ id: 'member-1', name: 'แม่' }]

function geminiOk(text = CHAT_JSON, usageMetadata = undefined) {
  mockGeminiGenerateContent.mockResolvedValueOnce({
    response: { text: () => text, usageMetadata },
  })
}

function geminiFail(err = new Error('network error')) {
  mockGeminiGenerateContent.mockRejectedValueOnce(err)
}

function deepseekOk(text = CHAT_JSON, usage = undefined) {
  mockDeepSeekCreate.mockResolvedValueOnce({
    choices: [{ message: { content: text } }],
    usage,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  process.env.GEMINI_API_KEY = 'test-gemini-key'
  process.env.DEEPSEEK_API_KEY = 'test-deepseek-key'
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ── logTelemetry unit tests ───────────────────────────────────────────────────

describe('logTelemetry', () => {
  test('1. all fields present → output contains all 8 keys', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    logTelemetry({
      provider: 'gemini',
      intent: 'log_medication',
      durationMs: 430,
      inputTokens: 312,
      outputTokens: 47,
      success: true,
      lineUserId: 'U123',
      familyMemberId: 'mem1',
    })
    expect(spy).toHaveBeenCalledTimes(1)
    const line = spy.mock.calls[0][0]
    expect(line).toMatch(/^\[aiService:telemetry\] /)
    const json = JSON.parse(line.replace('[aiService:telemetry] ', ''))
    expect(Object.keys(json)).toEqual(
      expect.arrayContaining(['provider', 'intent', 'durationMs', 'inputTokens', 'outputTokens', 'success', 'lineUserId', 'familyMemberId'])
    )
    expect(Object.keys(json)).toHaveLength(8)
  })

  test('2. inputTokens: undefined → serialized as null', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    logTelemetry({
      provider: 'gemini', intent: 'chat', durationMs: 100,
      inputTokens: undefined, outputTokens: 10,
      success: true, lineUserId: 'U1', familyMemberId: 'mem1',
    })
    const line = spy.mock.calls[0][0]
    const json = JSON.parse(line.replace('[aiService:telemetry] ', ''))
    expect(json.inputTokens).toBeNull()
  })

  test('3. familyMemberId: undefined → serialized as null', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    logTelemetry({
      provider: 'gemini', intent: 'chat', durationMs: 100,
      inputTokens: 10, outputTokens: 5,
      success: true, lineUserId: 'U1', familyMemberId: undefined,
    })
    const line = spy.mock.calls[0][0]
    const json = JSON.parse(line.replace('[aiService:telemetry] ', ''))
    expect(json.familyMemberId).toBeNull()
  })

  test('4. output is valid parseable JSON after prefix', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    logTelemetry({
      provider: 'gemini', intent: null, durationMs: 50,
      inputTokens: null, outputTokens: null,
      success: false, lineUserId: 'U1', familyMemberId: null,
    })
    const line = spy.mock.calls[0][0]
    expect(line.startsWith('[aiService:telemetry] ')).toBe(true)
    const jsonStr = line.slice('[aiService:telemetry] '.length)
    expect(() => JSON.parse(jsonStr)).not.toThrow()
  })
})

// ── Token extraction from callLLMWithFailover ─────────────────────────────────

describe('callLLMWithFailover token counts', () => {
  test('5. Gemini with usageMetadata → inputTokens and outputTokens returned', async () => {
    mockGeminiGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => CHAT_JSON,
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
      },
    })
    const result = await callLLMWithFailover('test')
    expect(result.inputTokens).toBe(100)
    expect(result.outputTokens).toBe(20)
    expect(result.provider).toBe('gemini')
  })

  test('6. Gemini with no usageMetadata → inputTokens = null', async () => {
    mockGeminiGenerateContent.mockResolvedValueOnce({
      response: { text: () => CHAT_JSON },
    })
    const result = await callLLMWithFailover('test')
    expect(result.inputTokens).toBeNull()
    expect(result.outputTokens).toBeNull()
  })

  test('7. DeepSeek with usage → inputTokens = prompt_tokens', async () => {
    geminiFail()
    geminiFail()
    mockDeepSeekCreate.mockResolvedValueOnce({
      choices: [{ message: { content: CHAT_JSON } }],
      usage: { prompt_tokens: 80, completion_tokens: 15 },
    })
    const result = await callLLMWithFailover('test')
    expect(result.provider).toBe('deepseek')
    expect(result.inputTokens).toBe(80)
    expect(result.outputTokens).toBe(15)
  })
})

// ── handleAiMessage telemetry emission ───────────────────────────────────────

describe('handleAiMessage telemetry', () => {
  function capturedTelemetryLine() {
    const calls = console.log.mock.calls
    const telemetryCall = calls.find(c => typeof c[0] === 'string' && c[0].startsWith('[aiService:telemetry]'))
    if (!telemetryCall) return null
    return JSON.parse(telemetryCall[0].slice('[aiService:telemetry] '.length))
  }

  test('8. successful Gemini call → success: true, provider: gemini, durationMs > 0', async () => {
    mockGeminiGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => CHAT_JSON,
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 },
      },
    })
    await handleAiMessage('สวัสดี', USER, MEMBERS)
    const t = capturedTelemetryLine()
    expect(t).not.toBeNull()
    expect(t.success).toBe(true)
    expect(t.provider).toBe('gemini')
    expect(t.durationMs).toBeGreaterThan(0)
  })

  test('9. JSON parse failure → success: false, intent: null', async () => {
    mockGeminiGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'not valid json at all' },
    })
    await handleAiMessage('test', USER, MEMBERS)
    const t = capturedTelemetryLine()
    expect(t).not.toBeNull()
    expect(t.success).toBe(false)
    expect(t.intent).toBeNull()
  })

  test('10. Gemini throws → success: false, provider retains fallback value', async () => {
    delete process.env.DEEPSEEK_API_KEY
    const err = new Error('network down')
    geminiFail(err)
    geminiFail(err)
    await handleAiMessage('test', USER, MEMBERS)
    const t = capturedTelemetryLine()
    expect(t).not.toBeNull()
    expect(t.success).toBe(false)
    expect(t.provider).toBe('fallback')
  })

  test('11. lineUserId in telemetry matches user.lineUserId, not user.id', async () => {
    const user = { id: 'internal-uuid', lineUserId: 'Uline123' }
    mockGeminiGenerateContent.mockResolvedValueOnce({
      response: { text: () => CHAT_JSON },
    })
    await handleAiMessage('test', user, MEMBERS)
    const t = capturedTelemetryLine()
    expect(t).not.toBeNull()
    expect(t.lineUserId).toBe('Uline123')
    expect(t.lineUserId).not.toBe('internal-uuid')
  })
})
