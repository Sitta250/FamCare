/**
 * Tests for Feature 3: confirm_destructive and cancel_destructive postback handlers
 */

import { jest } from '@jest/globals'
import request from 'supertest'

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockReplyMessage = jest.fn().mockResolvedValue({})

jest.unstable_mockModule('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: jest.fn().mockImplementation(() => ({
      replyMessage: mockReplyMessage,
    })),
  },
  middleware: jest.fn().mockReturnValue((req, _res, next) => next()),
  validateSignature: jest.fn().mockReturnValue(true),
}))

const mockUser = { id: 'user-1', lineUserId: 'line-user-1' }
const mockFamilyMembers = [{ id: 'member-1', name: 'แม่' }]

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: jest.fn().mockResolvedValue(mockUser),
}))

jest.unstable_mockModule('../services/familyMemberService.js', () => ({
  listFamilyMembers: jest.fn().mockResolvedValue(mockFamilyMembers),
}))

jest.unstable_mockModule('../services/cloudinaryService.js', () => ({
  uploadBuffer: jest.fn(),
}))

const mockExecuteIntent = jest.fn().mockResolvedValue('ดำเนินการเรียบร้อย')
const mockHandleAiMessage = jest.fn().mockResolvedValue({ type: 'text', text: 'ok' })

jest.unstable_mockModule('../services/aiService.js', () => ({
  handleAiMessage: mockHandleAiMessage,
  executeIntent: mockExecuteIntent,
}))

const mockPrisma = {
  pendingAction: {
    findUnique: jest.fn(),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({}),
  },
  medication: {
    findUnique: jest.fn(),
  },
}

jest.unstable_mockModule('../lib/prisma.js', () => ({ prisma: mockPrisma }))

jest.unstable_mockModule('../services/medicationService.js', () => ({
  createMedicationLog: jest.fn(),
  MEDICATION_LOG_STATUSES: new Set(['TAKEN', 'MISSED', 'SKIPPED']),
}))

jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: jest.fn(),
}))

// ── Test setup ─────────────────────────────────────────────────────────────────

let app

beforeAll(async () => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token'
  const { default: express } = await import('express')
  const { handleLineWebhook } = await import('../webhook/handler.js')
  app = express()
  app.use(express.json())
  app.post('/webhook', handleLineWebhook)
})

beforeEach(() => {
  jest.clearAllMocks()
  mockReplyMessage.mockResolvedValue({})
  mockPrisma.pendingAction.delete.mockResolvedValue({})
  mockPrisma.pendingAction.deleteMany.mockResolvedValue({})
})

function makePostbackEvent(actionData) {
  return {
    events: [{
      type: 'postback',
      replyToken: 'reply-token-1',
      source: { userId: mockUser.lineUserId },
      postback: { data: JSON.stringify(actionData) },
    }],
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('handlePostback — confirm_destructive', () => {
  test('6. valid pending action → executeIntent called, correct reply sent', async () => {
    const storedIntent = { intent: 'delete_appointment', familyMemberId: 'member-1', title: 'นัดหมอ' }
    mockPrisma.pendingAction.findUnique.mockResolvedValue({
      lineUserId: mockUser.lineUserId,
      intentJson: JSON.stringify(storedIntent),
    })
    mockExecuteIntent.mockResolvedValue('ลบนัดหมายแล้ว')

    await request(app)
      .post('/webhook')
      .set('x-line-signature', 'test')
      .send(makePostbackEvent({ action: 'confirm_destructive' }))
      .expect(200)

    expect(mockPrisma.pendingAction.findUnique).toHaveBeenCalledWith({
      where: { lineUserId: mockUser.lineUserId },
    })
    expect(mockPrisma.pendingAction.delete).toHaveBeenCalledWith({
      where: { lineUserId: mockUser.lineUserId },
    })
    expect(mockExecuteIntent).toHaveBeenCalledWith(storedIntent, mockUser.id, mockFamilyMembers)
    expect(mockReplyMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.objectContaining({ type: 'text', text: 'ลบนัดหมายแล้ว' })],
      })
    )
  })

  test('7. confirm_destructive with no pending action → replies ไม่พบคำสั่งที่รอยืนยัน', async () => {
    mockPrisma.pendingAction.findUnique.mockResolvedValue(null)

    await request(app)
      .post('/webhook')
      .set('x-line-signature', 'test')
      .send(makePostbackEvent({ action: 'confirm_destructive' }))
      .expect(200)

    expect(mockExecuteIntent).not.toHaveBeenCalled()
    expect(mockReplyMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.objectContaining({ text: 'ไม่พบคำสั่งที่รอยืนยัน' })],
      })
    )
  })
})

describe('handlePostback — cancel_destructive', () => {
  test('8. cancel_destructive → replies ยกเลิกแล้วครับ, deleteMany called', async () => {
    await request(app)
      .post('/webhook')
      .set('x-line-signature', 'test')
      .send(makePostbackEvent({ action: 'cancel_destructive' }))
      .expect(200)

    expect(mockPrisma.pendingAction.deleteMany).toHaveBeenCalledWith({
      where: { lineUserId: mockUser.lineUserId },
    })
    expect(mockReplyMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.objectContaining({ text: 'ยกเลิกแล้วครับ' })],
      })
    )
  })
})

describe('handleTextMessage — text after destructive (no confirm)', () => {
  test('9. normal text message does NOT clear pending action', async () => {
    mockHandleAiMessage.mockResolvedValue({ type: 'text', text: 'ตอบกลับปกติ' })

    await request(app)
      .post('/webhook')
      .set('x-line-signature', 'test')
      .send({
        events: [{
          type: 'message',
          replyToken: 'reply-token-2',
          source: { userId: mockUser.lineUserId },
          message: { type: 'text', text: 'สวัสดี' },
        }],
      })
      .expect(200)

    expect(mockPrisma.pendingAction.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.pendingAction.delete).not.toHaveBeenCalled()
    expect(mockPrisma.pendingAction.deleteMany).not.toHaveBeenCalled()
    expect(mockReplyMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.objectContaining({ text: 'ตอบกลับปกติ' })],
      })
    )
  })
})
