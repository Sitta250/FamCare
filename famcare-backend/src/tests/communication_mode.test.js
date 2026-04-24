import { jest } from '@jest/globals'

const mockUserUpsert = jest.fn()
const mockUserUpdate = jest.fn()
const mockUserFindUnique = jest.fn()
const mockFamilyMemberFindUnique = jest.fn()
const mockReminderFindMany = jest.fn()
const mockReminderUpdateMany = jest.fn()
const mockMedicationScheduleFindMany = jest.fn()
const mockMedicationScheduleUpdate = jest.fn()
const mockMedicationLogFindFirst = jest.fn()
const mockSymptomLogCreate = jest.fn()
const mockReplyMessage = jest.fn()
const mockUploadBuffer = jest.fn()
const mockCreateAppointment = jest.fn()
const mockSendLinePushToUser = jest.fn()
const mockGenerateContent = jest.fn()
const mockHandleAiMessage = jest.fn().mockResolvedValue('mock AI reply')

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    user: {
      upsert: mockUserUpsert,
      update: mockUserUpdate,
      findUnique: mockUserFindUnique,
    },
    familyMember: {
      findUnique: mockFamilyMemberFindUnique,
    },
    reminder: {
      findMany: mockReminderFindMany,
      updateMany: mockReminderUpdateMany,
    },
    medicationSchedule: {
      findMany: mockMedicationScheduleFindMany,
      update: mockMedicationScheduleUpdate,
    },
    medicationLog: {
      findFirst: mockMedicationLogFindFirst,
    },
    symptomLog: {
      create: mockSymptomLogCreate,
    },
  },
}))

jest.unstable_mockModule('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: jest.fn().mockImplementation(() => ({
      replyMessage: mockReplyMessage,
    })),
  },
}))

jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}))

jest.unstable_mockModule('../services/cloudinaryService.js', () => ({
  uploadBuffer: mockUploadBuffer,
}))

jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: mockCreateAppointment,
  listAppointments: jest.fn().mockResolvedValue([]),
}))

jest.unstable_mockModule('../services/aiService.js', () => ({
  handleAiMessage: mockHandleAiMessage,
}))

jest.unstable_mockModule('../services/familyMemberService.js', () => ({
  listFamilyMembers: jest.fn().mockResolvedValue([]),
  createFamilyMember: jest.fn(),
  getFamilyMember: jest.fn(),
  updateFamilyMember: jest.fn(),
  deleteFamilyMember: jest.fn(),
}))

jest.unstable_mockModule('../services/linePushService.js', () => ({
  sendLinePushToUser: mockSendLinePushToUser,
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { errorHandler } = await import('../middleware/errorHandler.js')
const { default: meRouter } = await import('../routes/me.js')
const { updateChatMode } = await import('../services/userService.js')
const { parseIntent } = await import('../services/thaiNlpService.js')
const { utcInstantFromBangkokYmdHm } = await import('../utils/datetime.js')
const { getRecipients } = await import('../services/medicationReminderDispatchService.js')
const { dispatchDueReminders } = await import('../services/reminderDispatchService.js')
const { fanoutToFamily } = await import('../services/caregiverNotifyService.js')
const { handleLineWebhook } = await import('../webhook/handler.js')

const app = express()
app.use(express.json())
app.use('/api/v1/me', meRouter)
app.use(errorHandler)

const request = supertest(app)

const USER_ID = 'user-1'
const LINE_ID = 'U_test_123'
const MEMBER_ID = 'member-1'
const CAREGIVER_ID = 'caregiver-1'
const CAREGIVER_LINE_ID = 'U_caregiver_1'
const AUTH = { 'x-line-userid': LINE_ID }

function fakeUser(overrides = {}) {
  return {
    id: USER_ID,
    lineUserId: LINE_ID,
    displayName: 'Test User',
    photoUrl: 'https://example.com/photo.jpg',
    phone: '0812345678',
    chatMode: 'PRIVATE',
    createdAt: new Date('2026-04-15T03:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUserUpsert.mockResolvedValue(fakeUser())
  mockUserUpdate.mockResolvedValue(fakeUser({ chatMode: 'GROUP' }))
  mockUserFindUnique.mockResolvedValue({
    id: USER_ID,
    lineUserId: LINE_ID,
    familyMembers: [{ id: MEMBER_ID }],
  })
  mockUserFindUnique.mockImplementation(async ({ where: { id } }) => {
    if (id === USER_ID) {
      return {
        id: USER_ID,
        lineUserId: LINE_ID,
        familyMembers: [{ id: MEMBER_ID }],
      }
    }
    if (id === CAREGIVER_ID) {
      return {
        id: CAREGIVER_ID,
        lineUserId: CAREGIVER_LINE_ID,
      }
    }
    return null
  })
  mockFamilyMemberFindUnique.mockResolvedValue({
    id: MEMBER_ID,
    ownerId: USER_ID,
    missedDoseAlertsEnabled: true,
    owner: { id: USER_ID, lineUserId: LINE_ID, chatMode: 'GROUP' },
    accessList: [
      {
        grantedToUserId: CAREGIVER_ID,
        notificationPrefs: JSON.stringify({
          appointmentReminders: true,
          medicationReminders: true,
          missedDoseAlerts: true,
        }),
        grantedTo: { id: CAREGIVER_ID, lineUserId: CAREGIVER_LINE_ID },
      },
    ],
  })
  mockReminderFindMany.mockResolvedValue([])
  mockReminderUpdateMany.mockResolvedValue({ count: 1 })
  mockMedicationScheduleFindMany.mockResolvedValue([])
  mockMedicationScheduleUpdate.mockResolvedValue({})
  mockMedicationLogFindFirst.mockResolvedValue(null)
  mockSymptomLogCreate.mockResolvedValue({
    id: 'symptom-1',
    voiceNoteUrl: 'https://example.com/audio.m4a',
  })
  mockReplyMessage.mockResolvedValue(undefined)
  mockGenerateContent.mockResolvedValue({
    response: {
      text: () => 'สวัสดีจาก Gemini',
    },
  })
  mockUploadBuffer.mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/demo/video/upload/v1/famcare/voice/audio.m4a',
  })
  mockCreateAppointment.mockResolvedValue({
    id: 'appt-1',
    title: 'นัดหมอ',
    appointmentAt: '2026-04-16T10:00:00.000+07:00',
  })
  mockSendLinePushToUser.mockResolvedValue(undefined)
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
  })
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token'
  process.env.CLOUDINARY_URL = 'cloudinary://demo'
  process.env.GEMINI_API_KEY = 'test-gemini-key'
})

afterEach(() => {
  delete global.fetch
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN
  delete process.env.CLOUDINARY_URL
})

describe('updateChatMode', () => {
  test('uses prisma.user.update for valid chatMode', async () => {
    const result = await updateChatMode(USER_ID, 'GROUP')

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { chatMode: 'GROUP' },
    })
    expect(result.chatMode).toBe('GROUP')
  })

  test('throws BAD_REQUEST for invalid chatMode', async () => {
    await expect(updateChatMode(USER_ID, 'INVALID')).rejects.toMatchObject({
      message: 'chatMode must be one of PRIVATE, GROUP',
      status: 400,
      code: 'BAD_REQUEST',
    })

    expect(mockUserUpdate).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/me', () => {
  test('includes chatMode in the response', async () => {
    const res = await request
      .get('/api/v1/me')
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({
      id: USER_ID,
      lineUserId: LINE_ID,
      displayName: 'Test User',
      photoUrl: 'https://example.com/photo.jpg',
      phone: '0812345678',
      chatMode: 'PRIVATE',
      createdAt: '2026-04-15T10:00:00.000+07:00',
    })
  })
})

describe('PATCH /api/v1/me', () => {
  test('sets GROUP and returns updated user profile', async () => {
    const res = await request
      .patch('/api/v1/me')
      .set(AUTH)
      .send({ chatMode: 'GROUP' })

    expect(res.status).toBe(200)
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { chatMode: 'GROUP' },
    })
    expect(res.body.data).toEqual({
      id: USER_ID,
      lineUserId: LINE_ID,
      displayName: 'Test User',
      photoUrl: 'https://example.com/photo.jpg',
      phone: '0812345678',
      chatMode: 'GROUP',
      createdAt: '2026-04-15T10:00:00.000+07:00',
    })
  })

  test('rejects invalid chatMode with BAD_REQUEST', async () => {
    const res = await request
      .patch('/api/v1/me')
      .set(AUTH)
      .send({ chatMode: 'INVALID' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: 'chatMode must be one of PRIVATE, GROUP',
      code: 'BAD_REQUEST',
    })
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })
})

describe('parseIntent', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-04-15T03:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('parses tomorrow morning appointment text into a Bangkok datetime', () => {
    const result = parseIntent('นัดหมอพรุ่งนี้ 10 โมง')

    expect(result).toEqual({
      intent: 'appointment',
      data: {
        title: 'นัดหมอ',
        appointmentAt: utcInstantFromBangkokYmdHm('2026-04-16', '10:00'),
      },
    })
  })

  test('parses explicit Thai month + afternoon time', () => {
    const result = parseIntent('นัดหมอ 15 มกราคม บ่าย 2 โมง')

    expect(result).toEqual({
      intent: 'appointment',
      data: {
        title: 'นัดหมอ',
        appointmentAt: utcInstantFromBangkokYmdHm('2027-01-15', '14:00'),
      },
    })
  })

  test('parses group mode command', () => {
    expect(parseIntent('โหมดกลุ่ม')).toEqual({
      intent: 'chatMode',
      data: { mode: 'GROUP' },
    })
  })

  test('parses private mode command', () => {
    expect(parseIntent('โหมดส่วนตัว')).toEqual({
      intent: 'chatMode',
      data: { mode: 'PRIVATE' },
    })
  })

  test('returns unknown for unrelated text', () => {
    expect(parseIntent('สวัสดี')).toEqual({
      intent: 'unknown',
      data: {},
    })
  })

  test('returns appointment intent with null datetime when no date and time are present', () => {
    expect(parseIntent('นัด')).toEqual({
      intent: 'appointment',
      data: {
        title: 'นัด',
        appointmentAt: null,
      },
    })
  })

  test('advances explicit date without year when the current-year date is already past', () => {
    const result = parseIntent('นัดหมาย 1 มกราคม เที่ยง')

    expect(result).toEqual({
      intent: 'appointment',
      data: {
        title: 'นัดหมาย',
        appointmentAt: utcInstantFromBangkokYmdHm('2027-01-01', '12:00'),
      },
    })
  })
})

describe('chatMode fan-out gating', () => {
  test('getRecipients returns only owner when chatMode is PRIVATE', async () => {
    mockFamilyMemberFindUnique.mockResolvedValue({
      id: MEMBER_ID,
      ownerId: USER_ID,
      missedDoseAlertsEnabled: true,
      owner: { id: USER_ID, lineUserId: LINE_ID, chatMode: 'PRIVATE' },
      accessList: [
        {
          grantedToUserId: CAREGIVER_ID,
          notificationPrefs: JSON.stringify({
            appointmentReminders: true,
            medicationReminders: true,
            missedDoseAlerts: true,
          }),
          grantedTo: { id: CAREGIVER_ID, lineUserId: CAREGIVER_LINE_ID },
        },
      ],
    })

    const result = await getRecipients(MEMBER_ID, 'missedDoseAlerts')

    expect(result).toEqual({
      recipients: [LINE_ID],
      missedAlertsEnabled: true,
    })
  })

  test('getRecipients includes caregiver in GROUP mode when opted in', async () => {
    const result = await getRecipients(MEMBER_ID, 'missedDoseAlerts')

    expect(result).toEqual({
      recipients: [LINE_ID, CAREGIVER_LINE_ID],
      missedAlertsEnabled: true,
    })
  })

  test('dispatchDueReminders sends owner only when chatMode is PRIVATE', async () => {
    mockReminderFindMany.mockResolvedValue([
      {
        id: 'reminder-1',
        type: 'SEVEN_DAYS',
        appointment: {
          id: 'appt-1',
          title: 'Checkup',
          appointmentAt: new Date('2026-04-16T03:00:00Z'),
          hospital: 'City Hospital',
          familyMember: {
            id: MEMBER_ID,
            name: 'Grandma',
            owner: { id: USER_ID, lineUserId: LINE_ID, chatMode: 'PRIVATE' },
            accessList: [
              {
                notificationPrefs: JSON.stringify({ appointmentReminders: true }),
                grantedTo: { id: CAREGIVER_ID, lineUserId: CAREGIVER_LINE_ID },
              },
            ],
          },
        },
      },
    ])

    await dispatchDueReminders()

    expect(mockSendLinePushToUser).toHaveBeenCalledTimes(1)
    expect(mockSendLinePushToUser).toHaveBeenCalledWith(LINE_ID, expect.stringContaining('Checkup'))
    expect(mockSendLinePushToUser).not.toHaveBeenCalledWith(CAREGIVER_LINE_ID, expect.any(String))
  })

  test('dispatchDueReminders sends caregiver in GROUP mode when opted in', async () => {
    mockReminderFindMany.mockResolvedValue([
      {
        id: 'reminder-1',
        type: 'SEVEN_DAYS',
        appointment: {
          id: 'appt-1',
          title: 'Checkup',
          appointmentAt: new Date('2026-04-16T03:00:00Z'),
          hospital: 'City Hospital',
          familyMember: {
            id: MEMBER_ID,
            name: 'Grandma',
            owner: { id: USER_ID, lineUserId: LINE_ID, chatMode: 'GROUP' },
            accessList: [
              {
                notificationPrefs: JSON.stringify({ appointmentReminders: true }),
                grantedTo: { id: CAREGIVER_ID, lineUserId: CAREGIVER_LINE_ID },
              },
            ],
          },
        },
      },
    ])

    await dispatchDueReminders()

    expect(mockSendLinePushToUser).toHaveBeenCalledWith(LINE_ID, expect.stringContaining('Checkup'))
    expect(mockSendLinePushToUser).toHaveBeenCalledWith(CAREGIVER_LINE_ID, expect.stringContaining('Checkup'))
  })

  test('fanoutToFamily sends nothing when chatMode is PRIVATE', async () => {
    mockFamilyMemberFindUnique.mockResolvedValue({
      ownerId: USER_ID,
      owner: { id: USER_ID, lineUserId: LINE_ID, chatMode: 'PRIVATE' },
      accessList: [
        {
          grantedToUserId: CAREGIVER_ID,
          notificationPrefs: JSON.stringify({ appointmentReminders: true }),
          grantedTo: { lineUserId: CAREGIVER_LINE_ID },
        },
      ],
    })

    await fanoutToFamily(MEMBER_ID, USER_ID, 'Test message', 'appointmentReminders')

    expect(mockSendLinePushToUser).not.toHaveBeenCalled()
  })
})

describe('handleLineWebhook audio messages', () => {
  function makeAudioReq(messageId = 'audio-123') {
    return {
      body: {
        events: [
          {
            type: 'message',
            replyToken: 'reply-token-1',
            source: { userId: LINE_ID },
            message: { type: 'audio', id: messageId },
          },
        ],
      },
    }
  }

  function makeRes() {
    return {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    }
  }

  test('upserts user on first audio message contact', async () => {
    const req = makeAudioReq('audio-upsert')
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(mockUserUpsert).toHaveBeenCalledWith({
      where: { lineUserId: LINE_ID },
      update: {},
      create: {
        lineUserId: LINE_ID,
        displayName: 'LINE User',
        photoUrl: null,
      },
    })
  })

  test('uploads LINE audio to Cloudinary and stores secure_url on voiceNoteUrl', async () => {
    const req = makeAudioReq('audio-456')
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api-data.line.me/v2/bot/message/audio-456/content',
      {
        headers: { Authorization: 'Bearer test-token' },
      }
    )
    expect(mockUploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), {
      folder: 'famcare/voice',
      resourceType: 'video',
      originalname: 'audio-456.m4a',
    })
    expect(mockSymptomLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyMemberId: 'member-1',
        addedByUserId: USER_ID,
        voiceNoteUrl: 'https://res.cloudinary.com/demo/video/upload/v1/famcare/voice/audio.m4a',
      }),
    })
    expect(mockSymptomLogCreate.mock.calls[0][0].data).not.toHaveProperty('attachmentUrl')
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: 'reply-token-1',
      messages: [{ type: 'text', text: '🎤 รับบันทึกเสียงแล้ว กรุณาตรวจสอบในแอปพลิเคชัน FamCare' }],
    })
  })

  test('falls back to raw LINE content URL when token/cloudinary config is missing', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN
    delete process.env.CLOUDINARY_URL
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const req = makeAudioReq('audio-789')
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockUploadBuffer).not.toHaveBeenCalled()
    expect(mockSymptomLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        voiceNoteUrl: 'https://api-data.line.me/v2/bot/message/audio-789/content',
      }),
    })
    expect(warnSpy).toHaveBeenCalledWith('[webhook] voice upload skipped: missing token/cloudinary config')

    warnSpy.mockRestore()
  })
})

describe('handleLineWebhook text messages', () => {
  function makeTextReq(text) {
    return {
      body: {
        events: [
          {
            type: 'message',
            replyToken: 'reply-token-1',
            source: { userId: LINE_ID },
            message: { type: 'text', text },
          },
        ],
      },
    }
  }

  function makeRes() {
    return {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    }
  }

  test('replies with AI-generated text', async () => {
    mockHandleAiMessage.mockResolvedValueOnce('สวัสดีจาก AI')
    const req = makeTextReq('สวัสดี')
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(mockCreateAppointment).not.toHaveBeenCalled()
    expect(mockUserUpdate).not.toHaveBeenCalled()
    expect(mockHandleAiMessage).toHaveBeenCalledWith(
      'สวัสดี',
      expect.objectContaining({ id: USER_ID }),
      expect.any(Array),
    )
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: 'reply-token-1',
      messages: [{ type: 'text', text: 'สวัสดีจาก AI' }],
    })
  })

  test('upserts user on first text message contact', async () => {
    const req = makeTextReq('hello')
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(mockUserUpsert).toHaveBeenCalledWith({
      where: { lineUserId: LINE_ID },
      update: {},
      create: {
        lineUserId: LINE_ID,
        displayName: 'LINE User',
        photoUrl: null,
      },
    })
  })

  test('replies safely when source.userId is missing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const req = makeTextReq('hello')
    req.body.events[0].source = {}
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(mockUserUpsert).not.toHaveBeenCalled()
    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: 'reply-token-1',
      messages: [{ type: 'text', text: 'FamCare received your message' }],
    })
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('sends Thai fallback text when AI service fails', async () => {
    mockHandleAiMessage.mockRejectedValueOnce(new Error('AI unavailable'))
    const req = makeTextReq('hello')
    const res = makeRes()

    await handleLineWebhook(req, res)

    expect(mockReplyMessage).toHaveBeenCalledWith({
      replyToken: 'reply-token-1',
      messages: [{ type: 'text', text: 'ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' }],
    })
  })
})
