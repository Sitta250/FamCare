import { jest } from '@jest/globals'

// ── Mock handles ──────────────────────────────────────────────────────────────
const mockConvFindMany   = jest.fn()
const mockConvFindFirst  = jest.fn()
const mockConvCreateMany = jest.fn()
const mockConvDeleteMany = jest.fn()
const mockGeminiGenerateContent = jest.fn()

// ── Module mocks ──────────────────────────────────────────────────────────────
jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    conversationMessage: {
      findMany:   mockConvFindMany,
      findFirst:  mockConvFindFirst,
      createMany: mockConvCreateMany,
      deleteMany: mockConvDeleteMany,
    },
  },
}))

jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGeminiGenerateContent,
    }),
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
  createHealthMetric: jest.fn(),
}))
jest.unstable_mockModule('../services/symptomLogService.js', () => ({
  createSymptomLog: jest.fn(),
  listSymptomLogs:  jest.fn().mockResolvedValue([]),
}))

// ── Dynamic imports after mocks ───────────────────────────────────────────────
const { handleAiMessage } = await import('../services/aiService.js')

// ── Helpers ───────────────────────────────────────────────────────────────────
function geminiReply(json) {
  mockGeminiGenerateContent.mockResolvedValueOnce({
    response: { text: () => JSON.stringify(json) },
  })
}

const USER    = { id: 'user-1', lineUserId: 'line-user-1' }
const MEMBER1 = { id: 'member-1', name: 'แม่' }
const MEMBER2 = { id: 'member-2', name: 'พ่อ' }

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GEMINI_API_KEY = 'test-key'
  mockConvFindMany.mockResolvedValue([])
  mockConvFindFirst.mockResolvedValue(null)
  mockConvCreateMany.mockResolvedValue({ count: 2 })
  mockConvDeleteMany.mockResolvedValue({ count: 0 })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ambiguity detection', () => {
  test('1. 2 family members + familyMemberId null → returns quickReply', async () => {
    geminiReply({ intent: 'list_appointments', familyMemberId: null })
    const result = await handleAiMessage('นัดหมอมีอะไรบ้าง', USER, [MEMBER1, MEMBER2])
    expect(result.type).toBe('quickReply')
    expect(result.text).toBe('ข้อมูลนี้เกี่ยวกับใครครับ?')
  })

  test('2. 1 family member + familyMemberId null → executes intent (auto-select)', async () => {
    geminiReply({ intent: 'list_appointments', familyMemberId: null })
    const result = await handleAiMessage('นัดหมอมีอะไรบ้าง', USER, [MEMBER1])
    expect(result.type).toBe('text')
  })

  test('3. 2 family members + familyMemberId set → executes intent normally', async () => {
    geminiReply({ intent: 'list_appointments', familyMemberId: 'member-1' })
    const result = await handleAiMessage('นัดหมอของแม่', USER, [MEMBER1, MEMBER2])
    expect(result.type).toBe('text')
  })

  test('4. quickReply items count matches familyMembers length', async () => {
    geminiReply({ intent: 'list_appointments', familyMemberId: null })
    const result = await handleAiMessage('นัดหมอ', USER, [MEMBER1, MEMBER2])
    expect(result.type).toBe('quickReply')
    expect(result.items).toHaveLength(2)
  })

  test('5. each item postbackData parses to { action, familyMemberId, pendingIntent }', async () => {
    geminiReply({ intent: 'list_appointments', familyMemberId: null })
    const result = await handleAiMessage('นัดหมอ', USER, [MEMBER1, MEMBER2])
    for (const item of result.items) {
      const parsed = JSON.parse(item.postbackData)
      expect(parsed.action).toBe('resolve_member')
      expect(typeof parsed.familyMemberId).toBe('string')
      expect(typeof parsed.pendingIntent).toBe('string')
    }
  })

  test('6. pendingIntent in postback does not contain note or reason', async () => {
    geminiReply({
      intent: 'add_appointment',
      familyMemberId: null,
      title: 'นัดหมอ',
      note: 'private note',
      reason: 'ปวดหัว',
    })
    const result = await handleAiMessage('นัดหมอพรุ่งนี้', USER, [MEMBER1, MEMBER2])
    expect(result.type).toBe('quickReply')
    const parsed = JSON.parse(result.items[0].postbackData)
    const pending = JSON.parse(decodeURIComponent(parsed.pendingIntent))
    expect(pending.note).toBeUndefined()
    expect(pending.reason).toBeUndefined()
  })

  test('7. chat intent + familyMemberId null + 2 members → no quickReply (text response)', async () => {
    geminiReply({ intent: 'chat', familyMemberId: null, reply: 'สวัสดีครับ' })
    const result = await handleAiMessage('สวัสดี', USER, [MEMBER1, MEMBER2])
    expect(result.type).toBe('text')
  })

  test('quickReply items truncated to 13 max', async () => {
    const manyMembers = Array.from({ length: 15 }, (_, i) => ({ id: `m-${i}`, name: `สมาชิก${i}` }))
    geminiReply({ intent: 'list_appointments', familyMemberId: null })
    const result = await handleAiMessage('นัดหมอ', USER, manyMembers)
    expect(result.type).toBe('quickReply')
    expect(result.items.length).toBeLessThanOrEqual(13)
  })
})
