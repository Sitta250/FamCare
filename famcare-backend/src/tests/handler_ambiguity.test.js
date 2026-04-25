import { jest } from '@jest/globals'

// ── Mock handles ──────────────────────────────────────────────────────────────
const mockReplyMessage    = jest.fn()
const mockFindOrCreate    = jest.fn()
const mockListFamilyMembers = jest.fn()
const mockExecuteIntent   = jest.fn()
const mockHandleAiMessage = jest.fn()

// ── Module mocks ──────────────────────────────────────────────────────────────
jest.unstable_mockModule('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: jest.fn().mockImplementation(() => ({
      replyMessage: mockReplyMessage,
    })),
  },
}))

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    medication: { findUnique: jest.fn() },
    symptomLog: { create: jest.fn() },
    user:       { upsert: jest.fn(), findUnique: jest.fn() },
  },
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreate,
}))

jest.unstable_mockModule('../services/familyMemberService.js', () => ({
  listFamilyMembers:   mockListFamilyMembers,
  createFamilyMember:  jest.fn(),
  getFamilyMember:     jest.fn(),
  updateFamilyMember:  jest.fn(),
  deleteFamilyMember:  jest.fn(),
}))

jest.unstable_mockModule('../services/aiService.js', () => ({
  handleAiMessage: mockHandleAiMessage,
  executeIntent:   mockExecuteIntent,
}))

jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: jest.fn(),
  listAppointments:  jest.fn().mockResolvedValue([]),
}))

jest.unstable_mockModule('../services/medicationService.js', () => ({
  createMedicationLog:    jest.fn(),
  MEDICATION_LOG_STATUSES: new Set(['TAKEN', 'MISSED', 'SKIPPED']),
}))

jest.unstable_mockModule('../services/cloudinaryService.js', () => ({
  uploadBuffer: jest.fn(),
}))

// ── Dynamic imports after mocks ───────────────────────────────────────────────
const { default: express }   = await import('express')
const { default: supertest } = await import('supertest')
const { handleLineWebhook }  = await import('../webhook/handler.js')

// ── App factory ───────────────────────────────────────────────────────────────
function buildApp() {
  const app = express()
  app.post('/webhook', express.json(), handleLineWebhook)
  return app
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const USER    = { id: 'user-1', lineUserId: 'line-user-1' }
const MEMBER1 = { id: 'member-1', name: 'แม่' }
const MEMBER2 = { id: 'member-2', name: 'พ่อ' }

function makePostbackEvent(data) {
  return {
    events: [{
      type: 'postback',
      replyToken: 'test-reply-token',
      source: { userId: 'line-user-1' },
      postback: { data: JSON.stringify(data) },
    }],
  }
}

function encodedPendingIntent(intent) {
  const pending = { ...intent }
  return encodeURIComponent(JSON.stringify(pending))
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token'
  mockReplyMessage.mockResolvedValue(undefined)
  mockFindOrCreate.mockResolvedValue(USER)
  mockListFamilyMembers.mockResolvedValue([MEMBER1, MEMBER2])
  mockHandleAiMessage.mockResolvedValue({ type: 'text', text: 'ตอบ' })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('resolve_member postback', () => {
  test('8. resolve_member postback → executeIntent called with injected familyMemberId', async () => {
    const pendingIntentObj = { intent: 'list_appointments', familyMemberId: null }
    mockExecuteIntent.mockResolvedValue('📅 นัดหมอของแม่: ไม่มี')

    const postbackData = {
      action: 'resolve_member',
      familyMemberId: 'member-1',
      pendingIntent: encodedPendingIntent(pendingIntentObj),
    }

    await supertest(buildApp())
      .post('/webhook')
      .send(makePostbackEvent(postbackData))

    expect(mockExecuteIntent).toHaveBeenCalledWith(
      expect.objectContaining({ familyMemberId: 'member-1', intent: 'list_appointments' }),
      USER.id,
      [MEMBER1, MEMBER2],
    )
  })

  test('9. resolve_member with malformed pendingIntent → replies with Thai error, no crash', async () => {
    const postbackData = {
      action: 'resolve_member',
      familyMemberId: 'member-1',
      pendingIntent: 'NOT_VALID_%ENCODING%%%',
    }

    const res = await supertest(buildApp())
      .post('/webhook')
      .send(makePostbackEvent(postbackData))

    expect(res.status).toBe(200)
    expect(mockExecuteIntent).not.toHaveBeenCalled()
    expect(mockReplyMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ text: 'ไม่สามารถประมวลผลคำสั่งได้' }),
        ]),
      })
    )
  })

  test('10. resolve_member with valid intent → reply() called with executeIntent result', async () => {
    const pendingIntentObj = { intent: 'list_appointments', familyMemberId: null }
    const executedReply = '📅 นัดหมอของแม่: ไม่มี'
    mockExecuteIntent.mockResolvedValue(executedReply)

    const postbackData = {
      action: 'resolve_member',
      familyMemberId: 'member-1',
      pendingIntent: encodedPendingIntent(pendingIntentObj),
    }

    await supertest(buildApp())
      .post('/webhook')
      .send(makePostbackEvent(postbackData))

    expect(mockReplyMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ text: executedReply }),
        ]),
      })
    )
  })
})
