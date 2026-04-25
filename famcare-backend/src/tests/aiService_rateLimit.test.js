/**
 * Tests for Feature 6: Rate Limiting
 *   - checkAndIncrementRateLimit()
 *   - handleAiMessage() rate-limit integration
 */

import { jest } from '@jest/globals'

// ── Mock prisma ───────────────────────────────────────────────────────────────

const mockFindUnique = jest.fn()
const mockUpsert = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    aiUsageLog: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
    conversationMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
    pendingAction: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  },
}))

// ── Mock datetime ─────────────────────────────────────────────────────────────

const mockBangkokCalendarDate = jest.fn().mockReturnValue('2026-04-25')

jest.unstable_mockModule('../utils/datetime.js', () => ({
  bangkokCalendarDate: mockBangkokCalendarDate,
  toBangkokISO: (d) => new Date(d).toISOString(),
  bangkokClockHm: jest.fn().mockReturnValue('10:00'),
  utcInstantFromBangkokYmdHm: jest.fn(),
}))

// ── Mock LLM / services so handleAiMessage doesn't make real network calls ───

jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: () => '{"intent":"chat","reply":"hello"}',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
      }),
    }),
  })),
}))

jest.unstable_mockModule('openai', () => ({
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: '{"intent":"chat","reply":"hello"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      },
    },
  })),
}))

jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: jest.fn(),
  listAppointments: jest.fn().mockResolvedValue([]),
}))

jest.unstable_mockModule('../services/medicationService.js', () => ({
  listMedications: jest.fn().mockResolvedValue([]),
  createMedicationLog: jest.fn(),
  MEDICATION_LOG_STATUSES: new Set(['TAKEN', 'MISSED', 'SKIPPED']),
}))

jest.unstable_mockModule('../services/healthMetricService.js', () => ({
  listHealthMetrics: jest.fn().mockResolvedValue([]),
  createHealthMetric: jest.fn(),
}))

jest.unstable_mockModule('../services/symptomLogService.js', () => ({
  createSymptomLog: jest.fn(),
  listSymptomLogs: jest.fn().mockResolvedValue([]),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

const { checkAndIncrementRateLimit, handleAiMessage } = await import('../services/aiService.js')
const { prisma } = await import('../lib/prisma.js')  // eslint-disable-line no-unused-vars

const TODAY = '2026-04-25'
const LINE_USER_ID = 'U_test_user'
const USER = { id: 'user_id', lineUserId: LINE_USER_ID }

beforeEach(() => {
  jest.clearAllMocks()
  mockBangkokCalendarDate.mockReturnValue(TODAY)
  mockUpsert.mockResolvedValue({})
})

// ── checkAndIncrementRateLimit tests ─────────────────────────────────────────

describe('checkAndIncrementRateLimit', () => {
  test('1. new user (findUnique returns null) → upsert with create count:1 → returns true', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await checkAndIncrementRateLimit(LINE_USER_ID)

    expect(result).toBe(true)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { lineUserId: LINE_USER_ID, date: TODAY, count: 1 },
        update: { count: { increment: 1 } },
      })
    )
  })

  test('2. count=49 → upsert called with increment → returns true', async () => {
    mockFindUnique.mockResolvedValue({ count: 49 })

    const result = await checkAndIncrementRateLimit(LINE_USER_ID)

    expect(result).toBe(true)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
  })

  test('3. count=50 → upsert NOT called → returns false', async () => {
    mockFindUnique.mockResolvedValue({ count: 50 })

    const result = await checkAndIncrementRateLimit(LINE_USER_ID)

    expect(result).toBe(false)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  test('4. count=100 (data integrity failure) → returns false', async () => {
    mockFindUnique.mockResolvedValue({ count: 100 })

    const result = await checkAndIncrementRateLimit(LINE_USER_ID)

    expect(result).toBe(false)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  test('5. uses bangkokCalendarDate() for date key', async () => {
    mockBangkokCalendarDate.mockReturnValue('2026-12-31')
    mockFindUnique.mockResolvedValue(null)

    await checkAndIncrementRateLimit(LINE_USER_ID)

    expect(mockBangkokCalendarDate).toHaveBeenCalled()
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lineUserId_date: { lineUserId: LINE_USER_ID, date: '2026-12-31' } },
      })
    )
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ date: '2026-12-31' }),
      })
    )
  })
})

// ── handleAiMessage rate-limit integration tests ──────────────────────────────

describe('handleAiMessage — rate limit integration', () => {
  const FAMILY_MEMBERS = []

  test('6. rate limit reached → returns RATE_LIMIT_TEXT, LLM not called', async () => {
    mockFindUnique.mockResolvedValue({ count: 50 })

    const result = await handleAiMessage('ทดสอบ', USER, FAMILY_MEMBERS)

    expect(result).toEqual({
      type: 'text',
      text: 'ขออภัย วันนี้ใช้ FamCare AI ครบ 50 ครั้งแล้ว กรุณาลองใหม่พรุ่งนี้ครับ',
    })
  })

  test('7. rate limit not reached → continues to LLM call', async () => {
    mockFindUnique.mockResolvedValue({ count: 5 })

    const result = await handleAiMessage('สวัสดี', USER, FAMILY_MEMBERS)

    // Should get some response (LLM returns chat intent with reply "hello")
    expect(result.type).toBe('text')
    expect(result.text).not.toBe('ขออภัย วันนี้ใช้ FamCare AI ครบ 50 ครั้งแล้ว กรุณาลองใหม่พรุ่งนี้ครับ')
  })

  test('8. rate limit DB throws → degrades gracefully, allows LLM call', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB connection lost'))

    const result = await handleAiMessage('สวัสดี', USER, FAMILY_MEMBERS)

    // Should not be the rate limit text — call was allowed through
    expect(result.type).toBe('text')
    expect(result.text).not.toBe('ขออภัย วันนี้ใช้ FamCare AI ครบ 50 ครั้งแล้ว กรุณาลองใหม่พรุ่งนี้ครับ')
  })
})
