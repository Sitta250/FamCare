import { jest } from '@jest/globals'

// ── Mock handles ──────────────────────────────────────────────────────────────

const mockGenerateContent = jest.fn()
const mockCreateAppointment = jest.fn()
const mockListAppointments = jest.fn()
const mockListMedications = jest.fn()
const mockCreateMedicationLog = jest.fn()
const mockListHealthMetrics = jest.fn()
const mockCreateHealthMetric = jest.fn()
const mockCreateSymptomLog = jest.fn()
const mockListSymptomLogs = jest.fn()

// ── Module mocks (before any dynamic imports) ─────────────────────────────────

process.env.GEMINI_API_KEY = 'test-key'

jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
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
  },
}))

jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: mockCreateAppointment,
  listAppointments: mockListAppointments,
}))

jest.unstable_mockModule('../services/medicationService.js', () => ({
  listMedications: mockListMedications,
  createMedicationLog: mockCreateMedicationLog,
  MEDICATION_LOG_STATUSES: new Set(['TAKEN', 'MISSED', 'SKIPPED']),
}))

jest.unstable_mockModule('../services/healthMetricService.js', () => ({
  listHealthMetrics: mockListHealthMetrics,
  createHealthMetric: mockCreateHealthMetric,
}))

jest.unstable_mockModule('../services/symptomLogService.js', () => ({
  createSymptomLog: mockCreateSymptomLog,
  listSymptomLogs: mockListSymptomLogs,
}))

jest.unstable_mockModule('../services/familyMemberService.js', () => ({
  listFamilyMembers: jest.fn(),
}))

jest.unstable_mockModule('../utils/datetime.js', () => ({
  toBangkokISO: jest.fn((v) => (v instanceof Date ? v.toISOString() : String(v))),
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

// ── Dynamic import after mocks ────────────────────────────────────────────────

const { handleAiMessage } = await import('../services/aiService.js')

// ── Test constants ────────────────────────────────────────────────────────────

const USER = { id: 'user1', lineUserId: 'line-user-1' }
const FAMILY_MEMBERS = [{ id: 'mem1', name: 'แม่' }]
const FALLBACK_TEXT = 'ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'

function geminiReturns(json) {
  const text = typeof json === 'string' ? json : JSON.stringify(json)
  mockGenerateContent.mockResolvedValueOnce({
    response: { text: () => text },
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
})

describe('aiService intent pipeline', () => {
  it('add_appointment — creates appointment and confirms', async () => {
    geminiReturns({
      intent: 'add_appointment',
      familyMemberId: 'mem1',
      title: 'นัดหมอ',
      appointmentAt: '2026-05-01T09:00:00+07:00',
      doctor: null,
      hospital: 'โรงพยาบาลกรุงเทพ',
      reason: null,
    })
    mockCreateAppointment.mockResolvedValueOnce({
      id: 'appt1',
      title: 'นัดหมอ',
      appointmentAt: '2026-05-01T09:00:00+07:00',
    })

    const result = await handleAiMessage('นัดหมอพรุ่งนี้', USER, FAMILY_MEMBERS)

    expect(result.text).toContain('✅')
    expect(result.text).toContain('นัดหมอ')
    expect(mockCreateAppointment).toHaveBeenCalledTimes(1)
    expect(mockCreateAppointment).toHaveBeenCalledWith(
      'user1',
      expect.objectContaining({
        familyMemberId: 'mem1',
        title: 'นัดหมอ',
      }),
    )
  })

  it('log_medication TAKEN — logs dose and confirms', async () => {
    geminiReturns({
      intent: 'log_medication',
      familyMemberId: 'mem1',
      medicationName: 'พารา',
      status: 'TAKEN',
      takenAt: null,
    })
    mockListMedications.mockResolvedValueOnce([
      { id: 'med1', name: 'พาราเซตามอล', dosage: '500mg' },
    ])
    mockCreateMedicationLog.mockResolvedValueOnce({ id: 'log1', status: 'TAKEN' })

    const result = await handleAiMessage('แม่กินพาราแล้ว', USER, FAMILY_MEMBERS)

    expect(result.text).toContain('พาราเซตามอล')
    expect(result.text).toContain('✅')
    expect(mockCreateMedicationLog).toHaveBeenCalledTimes(1)
    expect(mockCreateMedicationLog).toHaveBeenCalledWith(
      'user1',
      'med1',
      expect.objectContaining({ status: 'TAKEN' }),
    )
  })

  it('log_medication — medication not found', async () => {
    geminiReturns({
      intent: 'log_medication',
      familyMemberId: 'mem1',
      medicationName: 'ยาไม่มี',
      status: 'TAKEN',
      takenAt: null,
    })
    mockListMedications.mockResolvedValueOnce([
      { id: 'med1', name: 'พาราเซตามอล' },
    ])

    const result = await handleAiMessage('แม่กินยาไม่มีแล้ว', USER, FAMILY_MEMBERS)

    expect(result.text).toContain('❌')
    expect(result.text).toContain('ยาไม่มี')
    expect(mockCreateMedicationLog).not.toHaveBeenCalled()
  })

  it('log_health_metric BLOOD_PRESSURE — stores value2 for diastolic', async () => {
    geminiReturns({
      intent: 'log_health_metric',
      familyMemberId: 'mem1',
      type: 'BLOOD_PRESSURE',
      value: 120,
      systolic: 120,
      diastolic: 80,
      unit: 'mmHg',
      note: null,
    })
    mockCreateHealthMetric.mockResolvedValueOnce({ id: 'hm1' })

    const result = await handleAiMessage('ความดันแม่ 120/80', USER, FAMILY_MEMBERS)

    expect(result.text).toContain('ความดัน')
    expect(result.text).toContain('120/80')
    expect(mockCreateHealthMetric).toHaveBeenCalledTimes(1)
    expect(mockCreateHealthMetric).toHaveBeenCalledWith(
      'user1',
      expect.objectContaining({ value2: 80 }),
    )
  })

  it('log_symptom — records symptom and confirms', async () => {
    geminiReturns({
      intent: 'log_symptom',
      familyMemberId: 'mem1',
      description: 'ปวดหัวมาก',
      severity: 7,
    })
    mockCreateSymptomLog.mockResolvedValueOnce({ id: 'sl1' })

    const result = await handleAiMessage('แม่ปวดหัวมาก', USER, FAMILY_MEMBERS)

    expect(result.text).toContain('ปวดหัวมาก')
    expect(mockCreateSymptomLog).toHaveBeenCalledTimes(1)
  })

  it('chat intent — returns reply without calling any service', async () => {
    geminiReturns({
      intent: 'chat',
      reply: 'สวัสดีครับ ช่วยอะไรได้บ้าง',
    })

    const result = await handleAiMessage('สวัสดี', USER, FAMILY_MEMBERS)

    expect(result.text).toBe('สวัสดีครับ ช่วยอะไรได้บ้าง')
    expect(mockCreateAppointment).not.toHaveBeenCalled()
    expect(mockCreateMedicationLog).not.toHaveBeenCalled()
    expect(mockCreateHealthMetric).not.toHaveBeenCalled()
    expect(mockCreateSymptomLog).not.toHaveBeenCalled()
  })

  it('Gemini returns invalid JSON — returns fallback text', async () => {
    geminiReturns('ขอโทษนะครับ')

    const result = await handleAiMessage('อะไรก็ได้', USER, FAMILY_MEMBERS)

    expect(result.text).toBe(FALLBACK_TEXT)
  })

  it('auto-selects first family member when familyMemberId is null', async () => {
    geminiReturns({
      intent: 'list_medications',
      familyMemberId: null,
    })
    mockListMedications.mockResolvedValueOnce([])

    await handleAiMessage('ยาของแม่มีอะไรบ้าง', USER, FAMILY_MEMBERS)

    expect(mockListMedications).toHaveBeenCalledWith('user1', 'mem1', { active: 'true' })
  })
})
