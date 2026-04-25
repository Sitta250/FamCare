/**
 * Tests for Feature 3: Destructive intent confirmation flow in aiService.js
 */

import { jest } from '@jest/globals'

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPrisma = {
  pendingAction: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  conversationMessage: {
    findMany: jest.fn().mockResolvedValue([]),
    createMany: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(null),
    deleteMany: jest.fn().mockResolvedValue({}),
  },
}

jest.unstable_mockModule('../lib/prisma.js', () => ({ prisma: mockPrisma }))

// Mock Gemini — we control the raw intent JSON returned
let mockGeminiResponse = '{}'
jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockImplementation(async () => ({
        response: { text: () => mockGeminiResponse },
      })),
    }),
  })),
}))

// Mock all services so executeIntent doesn't hit DB
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
jest.unstable_mockModule('../utils/datetime.js', () => ({
  toBangkokISO: jest.fn(d => d.toISOString()),
  bangkokCalendarDate: jest.fn(() => '2026-04-25'),
  utcInstantFromBangkokYmdHm: jest.fn((ymd, hm) => new Date(`${ymd}T${hm}:00+07:00`)),
}))

jest.unstable_mockModule('../services/documentService.js', () => ({
  listDocuments: jest.fn().mockResolvedValue([]),
  getDocument: jest.fn(),
  deleteDocument: jest.fn(),
  createDocument: jest.fn(),
}))

jest.unstable_mockModule('../services/insuranceService.js', () => ({
  listInsuranceCards: jest.fn().mockResolvedValue([]),
  getInsuranceCard: jest.fn(),
  updateInsuranceCard: jest.fn(),
  deleteInsuranceCard: jest.fn(),
  createInsuranceCard: jest.fn(),
}))

// ── Test setup ─────────────────────────────────────────────────────────────────

let handleAiMessage

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'test-key'
  const mod = await import('../services/aiService.js')
  handleAiMessage = mod.handleAiMessage
})

const testUser = { id: 'user-1', lineUserId: 'line-user-1' }
const familyMembers = [{ id: 'member-1', name: 'แม่' }]

beforeEach(() => {
  jest.clearAllMocks()
  mockPrisma.pendingAction.upsert.mockResolvedValue({})
  mockPrisma.conversationMessage.findMany.mockResolvedValue([])
  mockPrisma.conversationMessage.findFirst.mockResolvedValue(null)
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('handleAiMessage — destructive confirmation', () => {
  test('1. delete_appointment intent → upsert called, returns flexMessage', async () => {
    mockGeminiResponse = JSON.stringify({
      intent: 'delete_appointment',
      familyMemberId: 'member-1',
      title: 'นัดหมอ',
    })

    const result = await handleAiMessage('ลบนัด', testUser, familyMembers)

    expect(mockPrisma.pendingAction.upsert).toHaveBeenCalledTimes(1)
    expect(mockPrisma.pendingAction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lineUserId: testUser.lineUserId },
        create: expect.objectContaining({ lineUserId: testUser.lineUserId }),
        update: expect.objectContaining({ intentJson: expect.any(String) }),
      })
    )
    expect(result.type).toBe('flexMessage')
    expect(result.altText).toContain('ยืนยัน')
    expect(result.contents).toBeDefined()
  })

  test('2. add_appointment intent → upsert NOT called, returns text', async () => {
    mockGeminiResponse = JSON.stringify({
      intent: 'add_appointment',
      familyMemberId: 'member-1',
      title: 'นัดหมอ',
      appointmentAt: '2026-05-01T10:00:00+07:00',
    })

    const { createAppointment } = await import('../services/appointmentService.js')
    createAppointment.mockResolvedValue({
      id: 'appt-1',
      title: 'นัดหมอ',
      appointmentAt: new Date('2026-05-01T03:00:00Z'),
    })

    const result = await handleAiMessage('นัดหมอ', testUser, familyMembers)

    expect(mockPrisma.pendingAction.upsert).not.toHaveBeenCalled()
    expect(result.type).toBe('text')
  })

  test('3. Flex contents include confirm_destructive button', async () => {
    mockGeminiResponse = JSON.stringify({
      intent: 'delete_appointment',
      familyMemberId: 'member-1',
      title: 'นัดหมอ',
    })

    const result = await handleAiMessage('ลบนัด', testUser, familyMembers)

    expect(result.type).toBe('flexMessage')
    const footerContents = result.contents.footer.contents
    const confirmButton = footerContents.find(
      b => b.action?.data && JSON.parse(b.action.data).action === 'confirm_destructive'
    )
    expect(confirmButton).toBeDefined()
    expect(confirmButton.action.label).toBe('ยืนยัน')
  })

  test('4. Flex contents include cancel_destructive button', async () => {
    mockGeminiResponse = JSON.stringify({
      intent: 'delete_medication',
      familyMemberId: 'member-1',
      medicationName: 'ยาเบาหวาน',
    })

    const result = await handleAiMessage('ลบยา', testUser, familyMembers)

    expect(result.type).toBe('flexMessage')
    const footerContents = result.contents.footer.contents
    const cancelButton = footerContents.find(
      b => b.action?.data && JSON.parse(b.action.data).action === 'cancel_destructive'
    )
    expect(cancelButton).toBeDefined()
    expect(cancelButton.action.label).toBe('ยกเลิก')
  })

  test('5. Second destructive intent from same user → upsert called again (overwrites)', async () => {
    mockGeminiResponse = JSON.stringify({
      intent: 'delete_appointment',
      familyMemberId: 'member-1',
      title: 'นัดแรก',
    })
    await handleAiMessage('ลบนัดแรก', testUser, familyMembers)

    mockGeminiResponse = JSON.stringify({
      intent: 'delete_appointment',
      familyMemberId: 'member-1',
      title: 'นัดที่สอง',
    })
    await handleAiMessage('ลบนัดที่สอง', testUser, familyMembers)

    expect(mockPrisma.pendingAction.upsert).toHaveBeenCalledTimes(2)
    const secondCall = mockPrisma.pendingAction.upsert.mock.calls[1][0]
    expect(JSON.parse(secondCall.update.intentJson).title).toBe('นัดที่สอง')
  })
})
