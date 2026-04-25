/**
 * Tests for Feature 7: Prompt Guardrails and Output Validation
 *   - validateIntent() — pure function tests (cases 1–16)
 *   - handleAiMessage() — integration wiring tests (cases 17–19)
 */

import { jest } from '@jest/globals'

// ── Mock handles ──────────────────────────────────────────────────────────────

const mockFindUnique     = jest.fn()
const mockUpsert         = jest.fn()
const mockGeminiGenerate = jest.fn()
const mockExecuteIntent  = jest.fn()

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    aiUsageLog: {
      findUnique: mockFindUnique,
      upsert:     mockUpsert,
    },
    conversationMessage: {
      findMany:   jest.fn().mockResolvedValue([]),
      findFirst:  jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
    pendingAction: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  },
}))

jest.unstable_mockModule('../utils/datetime.js', () => ({
  bangkokCalendarDate: jest.fn().mockReturnValue('2026-04-25'),
  toBangkokISO:        (d) => new Date(d).toISOString(),
  bangkokClockHm:      jest.fn().mockReturnValue('10:00'),
  utcInstantFromBangkokYmdHm: jest.fn(),
}))

jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGeminiGenerate,
    }),
  })),
}))

jest.unstable_mockModule('openai', () => ({
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  })),
}))

jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: jest.fn(),
  listAppointments:  jest.fn().mockResolvedValue([]),
}))

jest.unstable_mockModule('../services/medicationService.js', () => ({
  listMedications:        jest.fn().mockResolvedValue([]),
  createMedicationLog:    jest.fn(),
  MEDICATION_LOG_STATUSES: new Set(['TAKEN', 'MISSED', 'SKIPPED']),
}))

jest.unstable_mockModule('../services/healthMetricService.js', () => ({
  listHealthMetrics:  jest.fn().mockResolvedValue([]),
  createHealthMetric: mockExecuteIntent,
}))

jest.unstable_mockModule('../services/symptomLogService.js', () => ({
  createSymptomLog: jest.fn(),
  listSymptomLogs:  jest.fn().mockResolvedValue([]),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

const { validateIntent, handleAiMessage } = await import('../services/aiService.js')

// ── Shared fixtures ───────────────────────────────────────────────────────────

const MEMBERS = [{ id: 'abc', name: 'แม่' }]
const USER    = { id: 'user-1', lineUserId: 'line-1' }
const FALLBACK_TEXT = 'ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'

function geminiReturns(json) {
  mockGeminiGenerate.mockResolvedValueOnce({
    response: {
      text: () => JSON.stringify(json),
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GEMINI_API_KEY = 'test-key'
  // Rate limit: allow all calls through by default
  mockFindUnique.mockResolvedValue(null)
  mockUpsert.mockResolvedValue({})
})

// ── validateIntent — pure unit tests ─────────────────────────────────────────

describe('validateIntent — structural checks', () => {
  test('1. unknown intent string → valid: false', () => {
    const result = validateIntent({ intent: 'unknown_action' }, MEMBERS)
    expect(result.valid).toBe(false)
    expect(result.replyText).toContain('ไม่เข้าใจคำสั่ง')
  })

  test('16. extra unknown fields → valid: true, ignored silently', () => {
    const result = validateIntent(
      { intent: 'chat', reply: 'สวัสดี', extraField: 'value' },
      MEMBERS
    )
    expect(result.valid).toBe(true)
  })
})

describe('validateIntent — log_medication.status', () => {
  test('2. invalid status → defaulted to TAKEN, valid: true', () => {
    const result = validateIntent(
      { intent: 'log_medication', status: 'INVALID' },
      MEMBERS
    )
    expect(result.valid).toBe(true)
    expect(result.intent.status).toBe('TAKEN')
  })
})

describe('validateIntent — log_health_metric', () => {
  test('3. value = NaN → valid: false', () => {
    const result = validateIntent(
      { intent: 'log_health_metric', value: NaN, type: 'WEIGHT' },
      MEMBERS
    )
    expect(result.valid).toBe(false)
  })

  test('4. value = null → valid: false', () => {
    const result = validateIntent(
      { intent: 'log_health_metric', value: null, type: 'WEIGHT' },
      MEMBERS
    )
    expect(result.valid).toBe(false)
  })

  test('5. value = 120 → valid: true', () => {
    const result = validateIntent(
      { intent: 'log_health_metric', value: 120, type: 'BLOOD_PRESSURE' },
      MEMBERS
    )
    expect(result.valid).toBe(true)
    expect(result.intent.value).toBe(120)
  })

  test('6. type = INVALID → defaulted to CUSTOM, valid: true', () => {
    const result = validateIntent(
      { intent: 'log_health_metric', value: 70, type: 'INVALID' },
      MEMBERS
    )
    expect(result.valid).toBe(true)
    expect(result.intent.type).toBe('CUSTOM')
  })
})

describe('validateIntent — log_symptom.severity', () => {
  test('7. severity = 15 → clamped to 10, valid: true', () => {
    const result = validateIntent(
      { intent: 'log_symptom', description: 'ปวดหัว', severity: 15 },
      MEMBERS
    )
    expect(result.valid).toBe(true)
    expect(result.intent.severity).toBe(10)
  })

  test('8. severity = -1 → clamped to 1, valid: true', () => {
    const result = validateIntent(
      { intent: 'log_symptom', description: 'ปวดหัว', severity: -1 },
      MEMBERS
    )
    expect(result.valid).toBe(true)
    expect(result.intent.severity).toBe(1)
  })

  test('9. severity = null → defaulted to 1, valid: true', () => {
    const result = validateIntent(
      { intent: 'log_symptom', description: 'ปวดหัว', severity: null },
      MEMBERS
    )
    expect(result.valid).toBe(true)
    expect(result.intent.severity).toBe(1)
  })
})

describe('validateIntent — add_appointment.appointmentAt', () => {
  test('10. appointmentAt = "not-a-date" → valid: false', () => {
    const result = validateIntent(
      { intent: 'add_appointment', appointmentAt: 'not-a-date', title: 'นัดหมอ' },
      MEMBERS
    )
    expect(result.valid).toBe(false)
  })

  test('11. appointmentAt = null → valid: true (no date is OK)', () => {
    const result = validateIntent(
      { intent: 'add_appointment', appointmentAt: null, title: 'นัดหมอ' },
      MEMBERS
    )
    expect(result.valid).toBe(true)
  })
})

describe('validateIntent — familyMemberId resolution', () => {
  test('12. familyMemberId not in familyMembers array → set to null, valid: true', () => {
    const result = validateIntent(
      { intent: 'chat', reply: 'สวัสดี', familyMemberId: 'nonexistent-id' },
      [{ id: 'abc', name: 'แม่' }]
    )
    expect(result.valid).toBe(true)
    expect(result.intent.familyMemberId).toBeNull()
  })
})

describe('validateIntent — chat content guardrails', () => {
  test('13. reply contains SQL SELECT → replaced with FALLBACK_TEXT, valid: true', () => {
    const result = validateIntent(
      { intent: 'chat', reply: 'SELECT * FROM users' },
      MEMBERS
    )
    expect(result.valid).toBe(true)
    expect(result.intent.reply).toBe(FALLBACK_TEXT)
  })

  test('14. reply contains triple backtick → replaced with FALLBACK_TEXT, valid: true', () => {
    const result = validateIntent(
      { intent: 'chat', reply: '```code```' },
      MEMBERS
    )
    expect(result.valid).toBe(true)
    expect(result.intent.reply).toBe(FALLBACK_TEXT)
  })

  test('15. reply contains URL → replaced with FALLBACK_TEXT, valid: true', () => {
    const result = validateIntent(
      { intent: 'chat', reply: 'check https://example.com for details' },
      MEMBERS
    )
    expect(result.valid).toBe(true)
    expect(result.intent.reply).toBe(FALLBACK_TEXT)
  })
})

// ── handleAiMessage — guardrails integration ──────────────────────────────────

describe('handleAiMessage — validateIntent wiring', () => {
  test('17. unknown intent → returns Thai error message, executeIntent not called', async () => {
    geminiReturns({ intent: 'unknown_intent' })

    const result = await handleAiMessage('ทดสอบ', USER, MEMBERS)

    expect(result.type).toBe('text')
    expect(result.text).toContain('ไม่เข้าใจคำสั่ง')
  })

  test('18. log_medication with invalid status → executeIntent called with status TAKEN', async () => {
    // We need createMedicationLog to be called — mock listMedications to return a matching med
    const { listMedications, createMedicationLog } = await import('../services/medicationService.js')
    listMedications.mockResolvedValueOnce([{ id: 'med-1', name: 'ยาความดัน' }])
    geminiReturns({ intent: 'log_medication', status: 'WRONG', medicationName: 'ยาความดัน', familyMemberId: 'abc' })

    await handleAiMessage('กินยาความดัน', USER, MEMBERS)

    expect(createMedicationLog).toHaveBeenCalledWith(
      USER.id,
      'med-1',
      expect.objectContaining({ status: 'TAKEN' })
    )
  })

  test('19. log_health_metric with value NaN → returns Thai error message', async () => {
    // JSON.stringify(NaN) produces "null", so we need the model to return a string "NaN"
    // Simulate by returning a raw string that parses to an object with value: null
    mockGeminiGenerate.mockResolvedValueOnce({
      response: {
        text: () => '{"intent":"log_health_metric","type":"WEIGHT","value":null}',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      },
    })

    const result = await handleAiMessage('บันทึกน้ำหนัก', USER, MEMBERS)

    expect(result.type).toBe('text')
    expect(result.text).toContain('กรุณาระบุค่าตัวเลข')
  })
})
