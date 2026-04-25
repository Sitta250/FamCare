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

// Mock all dependent services so executeIntent does not fail
jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: jest.fn(),
  listAppointments:  jest.fn().mockResolvedValue([]),
}))
jest.unstable_mockModule('../services/medicationService.js', () => ({
  listMedications:       jest.fn().mockResolvedValue([]),
  createMedicationLog:   jest.fn(),
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

// ── Test helpers ──────────────────────────────────────────────────────────────
function geminiReply(json) {
  mockGeminiGenerateContent.mockResolvedValueOnce({
    response: { text: () => JSON.stringify(json) },
  })
}

const USER = { id: 'user-1', lineUserId: 'line-user-1' }
const MEMBERS = [{ id: 'member-1', name: 'แม่' }]

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GEMINI_API_KEY = 'test-key'
  // Default: no history, no last scope
  mockConvFindMany.mockResolvedValue([])
  mockConvFindFirst.mockResolvedValue(null)
  mockConvCreateMany.mockResolvedValue({ count: 2 })
  mockConvDeleteMany.mockResolvedValue({ count: 0 })
})

// ── loadHistory ───────────────────────────────────────────────────────────────

describe('loadHistory', () => {
  test('1. returns empty array when no rows exist', async () => {
    mockConvFindMany.mockResolvedValueOnce([])
    geminiReply({ intent: 'chat', reply: 'สวัสดี' })
    // We test loadHistory indirectly: if history is empty, prompt must NOT contain "Conversation so far:"
    // We verify via the generateContent call's argument
    await handleAiMessage('สวัสดี', USER, MEMBERS)
    const prompt = mockGeminiGenerateContent.mock.calls[0][0]
    expect(prompt).not.toContain('Conversation so far:')
  })

  test('2. returns rows in ascending order (oldest first)', async () => {
    const rows = [
      { role: 'USER', content: 'ข้อความแรก' },
      { role: 'BOT',  content: 'ตอบแรก' },
      { role: 'USER', content: 'ข้อความสอง' },
      { role: 'BOT',  content: 'ตอบสอง' },
    ]
    mockConvFindMany.mockResolvedValueOnce(rows) // loadHistory call
    geminiReply({ intent: 'chat', reply: 'ตอบ' })
    await handleAiMessage('ถาม', USER, MEMBERS)
    const prompt = mockGeminiGenerateContent.mock.calls[0][0]
    const firstIdx  = prompt.indexOf('ข้อความแรก')
    const secondIdx = prompt.indexOf('ข้อความสอง')
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(firstIdx).toBeLessThan(secondIdx)
  })

  test('3. scoped: does not return rows for a different familyMemberId', async () => {
    // loadHistory is called with lastScope (from findFirst which returns member-2 here)
    mockConvFindFirst.mockResolvedValueOnce({ familyMemberId: 'member-2' })
    mockConvFindMany.mockResolvedValueOnce([
      { role: 'USER', content: 'member-2 history' },
    ])
    geminiReply({ intent: 'chat', reply: 'ตอบ' })
    await handleAiMessage('ถาม', USER, MEMBERS)
    // findMany was called with member-2 scope
    expect(mockConvFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ familyMemberId: 'member-2' }),
      })
    )
  })
})

// ── saveExchange ──────────────────────────────────────────────────────────────

describe('saveExchange', () => {
  test('4. creates 2 rows with correct role values', async () => {
    geminiReply({ intent: 'chat', reply: 'สวัสดีครับ' })
    await handleAiMessage('สวัสดี', USER, MEMBERS)
    // Allow fire-and-forget to settle
    await new Promise(r => setImmediate(r))
    expect(mockConvCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ role: 'USER', content: 'สวัสดี' }),
          expect.objectContaining({ role: 'BOT',  content: 'สวัสดีครับ' }),
        ]),
      })
    )
  })

  test('5. deletes rows beyond 20-row cap', async () => {
    // Simulate 20 existing rows returned by cap-check findMany
    const existing20 = Array.from({ length: 20 }, (_, i) => ({ id: `id-${i}` }))
    // findMany calls: 1st = loadHistory (returns []), 2nd = cap-check (returns 20 ids)
    mockConvFindMany
      .mockResolvedValueOnce([])           // loadHistory
      .mockResolvedValueOnce(existing20)   // cap-check in saveExchange
    mockConvDeleteMany.mockResolvedValue({ count: 5 })
    geminiReply({ intent: 'chat', reply: 'ตอบ' })
    await handleAiMessage('ถาม', USER, MEMBERS)
    await new Promise(r => setImmediate(r))
    expect(mockConvDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { notIn: existing20.map(r => r.id) },
        }),
      })
    )
  })
})

// ── buildIntentPrompt history injection ──────────────────────────────────────

describe('buildIntentPrompt history injection', () => {
  test('7. empty history → no "Conversation so far:" in prompt', async () => {
    mockConvFindMany.mockResolvedValueOnce([])
    geminiReply({ intent: 'chat', reply: 'ตอบ' })
    await handleAiMessage('ถาม', USER, MEMBERS)
    const prompt = mockGeminiGenerateContent.mock.calls[0][0]
    expect(prompt).not.toContain('Conversation so far:')
  })

  test('8. 2 history rows → prompt contains "Conversation so far:", "User:", "Bot:"', async () => {
    mockConvFindMany.mockResolvedValueOnce([
      { role: 'USER', content: 'นัดหมอ' },
      { role: 'BOT',  content: 'บันทึกแล้ว' },
    ])
    geminiReply({ intent: 'chat', reply: 'ตอบ' })
    await handleAiMessage('ถาม', USER, MEMBERS)
    const prompt = mockGeminiGenerateContent.mock.calls[0][0]
    expect(prompt).toContain('Conversation so far:')
    expect(prompt).toContain('User: นัดหมอ')
    expect(prompt).toContain('Bot: บันทึกแล้ว')
  })

  test('history block appears before the intent instructions', async () => {
    mockConvFindMany.mockResolvedValueOnce([
      { role: 'USER', content: 'ข้อความ' },
      { role: 'BOT',  content: 'ตอบ' },
    ])
    geminiReply({ intent: 'chat', reply: 'ตอบ' })
    await handleAiMessage('ถาม', USER, MEMBERS)
    const prompt = mockGeminiGenerateContent.mock.calls[0][0]
    expect(prompt.indexOf('Conversation so far:')).toBeLessThan(
      prompt.indexOf('You are FamCare intent extractor')
    )
  })
})

// ── resolveMemoryScope ────────────────────────────────────────────────────────

describe('resolveMemoryScope', () => {
  test('9. returns passed familyMemberId immediately (no DB call for scope)', async () => {
    // When intent resolves member-1, the saveExchange scope should be member-1
    geminiReply({ intent: 'chat', reply: 'ตอบ', familyMemberId: 'member-1' })
    await handleAiMessage('ถาม', USER, MEMBERS)
    await new Promise(r => setImmediate(r))
    // saveExchange createMany should use member-1
    expect(mockConvCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ familyMemberId: 'member-1' }),
        ]),
      })
    )
  })

  test('10. null + DB has prior row → uses that familyMemberId', async () => {
    mockConvFindFirst.mockResolvedValueOnce({ familyMemberId: 'member-xyz' })
    mockConvFindMany.mockResolvedValueOnce([])
    geminiReply({ intent: 'chat', reply: 'ตอบ' })
    await handleAiMessage('ถาม', USER, MEMBERS)
    await new Promise(r => setImmediate(r))
    expect(mockConvCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ familyMemberId: 'member-xyz' }),
        ]),
      })
    )
  })

  test('11. null + no prior rows → scope is null', async () => {
    mockConvFindFirst.mockResolvedValueOnce(null)
    mockConvFindMany.mockResolvedValueOnce([])
    geminiReply({ intent: 'chat', reply: 'ตอบ' })
    await handleAiMessage('ถาม', USER, MEMBERS)
    await new Promise(r => setImmediate(r))
    expect(mockConvCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ familyMemberId: null }),
        ]),
      })
    )
  })
})

// ── handleAiMessage integration ───────────────────────────────────────────────

describe('handleAiMessage memory wiring', () => {
  test('12. loadHistory called and history injected into prompt', async () => {
    mockConvFindMany.mockResolvedValueOnce([
      { role: 'USER', content: 'ก่อนหน้า' },
      { role: 'BOT',  content: 'ตอบก่อน' },
    ])
    geminiReply({ intent: 'chat', reply: 'ตอบ' })
    await handleAiMessage('ถาม', USER, MEMBERS)
    expect(mockConvFindMany).toHaveBeenCalled()
    const prompt = mockGeminiGenerateContent.mock.calls[0][0]
    expect(prompt).toContain('ก่อนหน้า')
  })

  test('13. saveExchange called with user message and bot reply', async () => {
    geminiReply({ intent: 'chat', reply: 'บอทตอบ' })
    await handleAiMessage('ผู้ใช้ถาม', USER, MEMBERS)
    await new Promise(r => setImmediate(r))
    expect(mockConvCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ role: 'USER', content: 'ผู้ใช้ถาม' }),
          expect.objectContaining({ role: 'BOT',  content: 'บอทตอบ' }),
        ]),
      })
    )
  })

  test('14. saveExchange failure does not affect reply', async () => {
    mockConvCreateMany.mockRejectedValueOnce(new Error('DB down'))
    geminiReply({ intent: 'chat', reply: 'ตอบปกติ' })
    const reply = await handleAiMessage('ถาม', USER, MEMBERS)
    await new Promise(r => setImmediate(r))
    expect(reply.text).toBe('ตอบปกติ')
  })
})
