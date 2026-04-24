import { jest } from '@jest/globals'

const mockReplyMessage = jest.fn()
const mockFindOrCreateByLineUserId = jest.fn()
const mockUpdateChatMode = jest.fn()
const mockDeleteUserAndData = jest.fn()
const mockCreateAppointment = jest.fn()
const mockCreateMedicationLog = jest.fn()
const mockMedicationFindUnique = jest.fn()

jest.unstable_mockModule('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: jest.fn().mockImplementation(() => ({
      replyMessage: mockReplyMessage,
    })),
  },
}))

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    medication: {
      findUnique: mockMedicationFindUnique,
    },
  },
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreateByLineUserId,
  updateChatMode: mockUpdateChatMode,
  deleteUserAndData: mockDeleteUserAndData,
}))

jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: mockCreateAppointment,
  listAppointments: jest.fn().mockResolvedValue([]),
}))

jest.unstable_mockModule('../services/medicationService.js', () => ({
  createMedicationLog: mockCreateMedicationLog,
  MEDICATION_LOG_STATUSES: new Set(['TAKEN', 'MISSED', 'SKIPPED']),
}))

jest.unstable_mockModule('../services/aiService.js', () => ({
  handleAiMessage: jest.fn().mockResolvedValue('mock AI reply'),
}))

jest.unstable_mockModule('../services/familyMemberService.js', () => ({
  listFamilyMembers: jest.fn().mockResolvedValue([]),
  createFamilyMember: jest.fn(),
  getFamilyMember: jest.fn(),
  updateFamilyMember: jest.fn(),
  deleteFamilyMember: jest.fn(),
}))

process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token'

const { handleLineWebhook } = await import('../webhook/handler.js')

function makeEvent(data) {
  return {
    type: 'postback',
    replyToken: 'reply-token-1',
    source: { userId: 'U_line_123' },
    postback: { data: JSON.stringify(data) },
  }
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReplyMessage.mockResolvedValue(undefined)
  mockFindOrCreateByLineUserId.mockResolvedValue({ id: 'user-1' })
  mockCreateAppointment.mockResolvedValue({})
  mockCreateMedicationLog.mockResolvedValue({
    id: 'log-1',
    medicationId: 'med-1',
    status: 'TAKEN',
    takenAt: '2026-04-14T08:00:00+07:00',
  })
  mockMedicationFindUnique.mockResolvedValue({ name: 'Aspirin' })
})

describe('handleLineWebhook — log_medication postback', () => {
  test('creates a medication log and replies with success text', async () => {
    const req = {
      body: {
        events: [
          makeEvent({
            action: 'log_medication',
            medicationId: 'med-1',
            status: 'TAKEN',
            takenAt: '2026-04-14T08:00:00+07:00',
          }),
        ],
      },
    }
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.send).toHaveBeenCalled()
    expect(mockFindOrCreateByLineUserId).toHaveBeenCalledWith('U_line_123')
    expect(mockCreateMedicationLog).toHaveBeenCalledWith('user-1', 'med-1', {
      status: 'TAKEN',
      takenAt: '2026-04-14T08:00:00+07:00',
    })
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: 'reply-token-1',
      messages: [{ type: 'text', text: '✅ บันทึกการกินยา Aspirin (TAKEN) เรียบร้อยแล้ว' }],
    })
  })

  test('replies with an error when medicationId is missing', async () => {
    const req = {
      body: {
        events: [
          makeEvent({
            action: 'log_medication',
            status: 'TAKEN',
          }),
        ],
      },
    }
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(mockFindOrCreateByLineUserId).not.toHaveBeenCalled()
    expect(mockCreateMedicationLog).not.toHaveBeenCalled()
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: 'reply-token-1',
      messages: [{ type: 'text', text: 'กรุณาระบุ medicationId' }],
    })
  })

  test('replies with an error when status is invalid', async () => {
    const req = {
      body: {
        events: [
          makeEvent({
            action: 'log_medication',
            medicationId: 'med-1',
            status: 'LATE',
          }),
        ],
      },
    }
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(mockFindOrCreateByLineUserId).not.toHaveBeenCalled()
    expect(mockCreateMedicationLog).not.toHaveBeenCalled()
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: 'reply-token-1',
      messages: [{ type: 'text', text: 'สถานะไม่ถูกต้อง ต้องเป็น TAKEN, MISSED หรือ SKIPPED' }],
    })
  })

  test('replies with service errors and does not crash', async () => {
    mockCreateMedicationLog.mockRejectedValue(
      Object.assign(new Error('Medication not found'), { status: 404, code: 'NOT_FOUND' })
    )

    const req = {
      body: {
        events: [
          makeEvent({
            action: 'log_medication',
            medicationId: 'missing-med',
            status: 'TAKEN',
          }),
        ],
      },
    }
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: 'reply-token-1',
      messages: [{ type: 'text', text: 'เกิดข้อผิดพลาด: Medication not found' }],
    })
  })

  test('defaults takenAt to the current time when omitted', async () => {
    const before = Date.now()
    const req = {
      body: {
        events: [
          makeEvent({
            action: 'log_medication',
            medicationId: 'med-1',
            status: 'TAKEN',
          }),
        ],
      },
    }
    const res = makeRes()

    await handleLineWebhook(req, res)

    const [, , payload] = mockCreateMedicationLog.mock.calls[0]
    expect(payload.status).toBe('TAKEN')
    expect(typeof payload.takenAt).toBe('string')
    expect(Number.isFinite(new Date(payload.takenAt).getTime())).toBe(true)
    expect(new Date(payload.takenAt).getTime()).toBeGreaterThanOrEqual(before)
  })

  test('handles missing source.userId gracefully', async () => {
    const req = {
      body: {
        events: [
          {
            type: 'postback',
            replyToken: 'reply-token-1',
            source: {},
            postback: { data: JSON.stringify({ action: 'log_medication', medicationId: 'med-1', status: 'TAKEN' }) },
          },
        ],
      },
    }
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(mockFindOrCreateByLineUserId).not.toHaveBeenCalled()
    expect(mockCreateMedicationLog).not.toHaveBeenCalled()
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: 'reply-token-1',
      messages: [{ type: 'text', text: 'FamCare received your message' }],
    })
  })
})
