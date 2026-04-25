/**
 * Tests for insurance intents: list_insurance, get_insurance, update_insurance, delete_insurance
 */

import { jest } from '@jest/globals'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockListInsuranceCards = jest.fn()
const mockUpdateInsuranceCard = jest.fn()
const mockDeleteInsuranceCard = jest.fn()
const mockPrisma = {
  conversationMessage: {
    findMany: jest.fn().mockResolvedValue([]),
    createMany: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(null),
    deleteMany: jest.fn().mockResolvedValue({}),
  },
  aiUsageLog: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
  },
  pendingAction: {
    upsert: jest.fn().mockResolvedValue({}),
  },
}

jest.unstable_mockModule('../lib/prisma.js', () => ({ prisma: mockPrisma }))
jest.unstable_mockModule('../services/documentService.js', () => ({
  listDocuments: jest.fn(),
  deleteDocument: jest.fn(),
  createDocument: jest.fn(),
  getDocument: jest.fn(),
}))
jest.unstable_mockModule('../services/insuranceService.js', () => ({
  listInsuranceCards: mockListInsuranceCards,
  getInsuranceCard: jest.fn(),
  updateInsuranceCard: mockUpdateInsuranceCard,
  deleteInsuranceCard: mockDeleteInsuranceCard,
  createInsuranceCard: jest.fn(),
}))
jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: jest.fn(),
  listAppointments: jest.fn(),
}))
jest.unstable_mockModule('../services/medicationService.js', () => ({
  listMedications: jest.fn(),
  createMedicationLog: jest.fn(),
  MEDICATION_LOG_STATUSES: new Set(['TAKEN', 'MISSED', 'SKIPPED']),
}))
jest.unstable_mockModule('../services/healthMetricService.js', () => ({
  listHealthMetrics: jest.fn(),
  createHealthMetric: jest.fn(),
}))
jest.unstable_mockModule('../services/symptomLogService.js', () => ({
  createSymptomLog: jest.fn(),
  listSymptomLogs: jest.fn(),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

const { executeIntent } = await import('../services/aiService.js')

// ── Test data ─────────────────────────────────────────────────────────────────

const USER_ID = 'user-1'
const MEMBER_ID = 'member-1'
const FAMILY_MEMBERS = [{ id: MEMBER_ID, name: 'พ่อ' }]

const SAMPLE_CARDS = [
  {
    id: 'ins-1',
    companyName: 'AIA',
    policyNumber: 'POL-12345',
    expirationDate: '2027-12-31T00:00:00+07:00',
    status: 'ACTIVE',
  },
  {
    id: 'ins-2',
    companyName: 'เมืองไทยประกัน',
    policyNumber: 'MT-99999',
    expirationDate: '2025-06-01T00:00:00+07:00',
    status: 'EXPIRED',
  },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('executeIntent — insurance intents', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('list_insurance → calls listInsuranceCards, returns Thai summary', async () => {
    mockListInsuranceCards.mockResolvedValue(SAMPLE_CARDS)

    const result = await executeIntent(
      { intent: 'list_insurance', familyMemberId: MEMBER_ID },
      USER_ID,
      FAMILY_MEMBERS
    )

    expect(mockListInsuranceCards).toHaveBeenCalledWith(USER_ID, { familyMemberId: MEMBER_ID })
    expect(result).toContain('🏥')
    expect(result).toContain('AIA')
    expect(result).toContain('POL-12345')
  })

  test('list_insurance — no cards → "ไม่พบข้อมูลประกัน" message', async () => {
    mockListInsuranceCards.mockResolvedValue([])

    const result = await executeIntent(
      { intent: 'list_insurance', familyMemberId: MEMBER_ID },
      USER_ID,
      FAMILY_MEMBERS
    )

    expect(result).toContain('ไม่พบข้อมูลประกัน')
    expect(result).toContain('พ่อ')
  })

  test('get_insurance → returns company name, policy number, expiry', async () => {
    mockListInsuranceCards.mockResolvedValue(SAMPLE_CARDS)

    const result = await executeIntent(
      { intent: 'get_insurance', familyMemberId: MEMBER_ID, keyword: 'AIA' },
      USER_ID,
      FAMILY_MEMBERS
    )

    expect(result).toContain('AIA')
    expect(result).toContain('POL-12345')
    expect(result).toContain('ACTIVE')
  })

  test('update_insurance → calls updateInsuranceCard with correct fields', async () => {
    mockListInsuranceCards.mockResolvedValue(SAMPLE_CARDS)
    mockUpdateInsuranceCard.mockResolvedValue({ card: SAMPLE_CARDS[0] })

    const result = await executeIntent(
      {
        intent: 'update_insurance',
        familyMemberId: MEMBER_ID,
        keyword: 'AIA',
        expirationDate: '2028-12-31',
        policyNumber: 'POL-99999',
        companyName: null,
      },
      USER_ID,
      FAMILY_MEMBERS
    )

    expect(mockUpdateInsuranceCard).toHaveBeenCalledWith(USER_ID, 'ins-1', {
      expirationDate: '2028-12-31',
      policyNumber: 'POL-99999',
    })
    expect(result).toContain('✅')
    expect(result).toContain('AIA')
  })

  test('delete_insurance → calls deleteInsuranceCard (post-confirmation path)', async () => {
    mockListInsuranceCards.mockResolvedValue(SAMPLE_CARDS)
    mockDeleteInsuranceCard.mockResolvedValue(undefined)

    const result = await executeIntent(
      { intent: 'delete_insurance', familyMemberId: MEMBER_ID, keyword: 'AIA' },
      USER_ID,
      FAMILY_MEMBERS
    )

    expect(mockDeleteInsuranceCard).toHaveBeenCalledWith(USER_ID, 'ins-1')
    expect(result).toContain('ลบบัตรประกัน')
    expect(result).toContain('AIA')
  })

  test('update_insurance — VIEWER 403 → returns permission-denied message', async () => {
    mockListInsuranceCards.mockResolvedValue(SAMPLE_CARDS)
    mockUpdateInsuranceCard.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403 })
    )

    const result = await executeIntent(
      {
        intent: 'update_insurance',
        familyMemberId: MEMBER_ID,
        keyword: 'AIA',
        policyNumber: 'NEW-111',
      },
      USER_ID,
      FAMILY_MEMBERS
    )

    expect(result).toContain('ไม่มีสิทธิ์')
  })

  test('list_insurance — 403 → returns Thai permission-denied message', async () => {
    mockListInsuranceCards.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403 })
    )

    const result = await executeIntent(
      { intent: 'list_insurance', familyMemberId: MEMBER_ID },
      USER_ID,
      FAMILY_MEMBERS
    )

    expect(result).toContain('ไม่มีสิทธิ์')
  })
})
