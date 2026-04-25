/**
 * Tests for Feature 9: User Onboarding Flow
 * Covers tasks 9-C and 9-D.
 */

import { jest } from '@jest/globals'

// ── Mock handles ──────────────────────────────────────────────────────────────

const mockReplyMessage = jest.fn().mockResolvedValue({})
const mockFindOrCreate = jest.fn()
const mockListFamilyMembers = jest.fn()
const mockCreateFamilyMember = jest.fn()
const mockHandleAiMessage = jest.fn()
const mockExecuteIntent = jest.fn()

const mockPrisma = {
  onboardingSession: {
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    upsert: jest.fn(),
  },
  pendingAction: {
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  medication: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  symptomLog: {
    create: jest.fn(),
  },
}

jest.unstable_mockModule('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: jest.fn().mockImplementation(() => ({
      replyMessage: mockReplyMessage,
    })),
  },
}))

jest.unstable_mockModule('../lib/prisma.js', () => ({ prisma: mockPrisma }))
jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreate,
}))
jest.unstable_mockModule('../services/familyMemberService.js', () => ({
  listFamilyMembers: mockListFamilyMembers,
  createFamilyMember: mockCreateFamilyMember,
}))
jest.unstable_mockModule('../services/aiService.js', () => ({
  handleAiMessage: mockHandleAiMessage,
  executeIntent: mockExecuteIntent,
}))
jest.unstable_mockModule('../services/medicationService.js', () => ({
  createMedicationLog: jest.fn(),
  MEDICATION_LOG_STATUSES: new Set(['TAKEN', 'MISSED', 'SKIPPED']),
}))
jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: jest.fn(),
}))
jest.unstable_mockModule('../services/cloudinaryService.js', () => ({
  uploadBuffer: jest.fn(),
}))

// ── Dynamic import after mocks ────────────────────────────────────────────────

const { handleLineWebhook } = await import('../webhook/handler.js')

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER = { id: 'user-1', lineUserId: 'line-u-1' }

function makeTextEvent(text, replyToken = 'reply-token') {
  return {
    type: 'message',
    replyToken,
    source: { userId: 'line-u-1' },
    message: { type: 'text', id: 'msg-1', text },
  }
}

function makePostbackEvent(data, replyToken = 'reply-token') {
  return {
    type: 'postback',
    replyToken,
    source: { userId: 'line-u-1' },
    postback: { data: JSON.stringify(data) },
  }
}

async function dispatch(event) {
  await handleLineWebhook(
    { body: { events: [event] } },
    { status: jest.fn().mockReturnThis(), send: jest.fn() }
  )
}

function lastReply() {
  const calls = mockReplyMessage.mock.calls
  return calls[calls.length - 1]?.[0]
}

function lastReplyText() {
  const msg = lastReply()?.messages?.[0]
  return msg?.text ?? null
}

function lastReplyQuickReplyItems() {
  const msg = lastReply()?.messages?.[0]
  return msg?.quickReply?.items ?? null
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token'
  mockFindOrCreate.mockResolvedValue(USER)
  mockPrisma.onboardingSession.findUnique.mockResolvedValue(null)
  mockPrisma.onboardingSession.update.mockResolvedValue({})
  mockPrisma.onboardingSession.delete.mockResolvedValue({})
  mockPrisma.onboardingSession.upsert.mockResolvedValue({})
})

// ── Task 9-C: text message routing ───────────────────────────────────────────

describe('handleTextMessage — onboarding routing', () => {
  test('1. 0 family members, no session → Quick Reply with 2 buttons', async () => {
    mockListFamilyMembers.mockResolvedValue([])

    await dispatch(makeTextEvent('สวัสดี'))

    const items = lastReplyQuickReplyItems()
    expect(items).toHaveLength(2)
    expect(items[0].action.label).toBe('เพิ่มสมาชิกตอนนี้')
    expect(items[1].action.label).toBe('เปิดแอป FamCare')
  })

  test('2. active session AWAITING_NAME → DOB question, session updated', async () => {
    const session = {
      id: 's-1', lineUserId: 'line-u-1', step: 'AWAITING_NAME', name: null,
      updatedAt: new Date(), // fresh
    }
    mockPrisma.onboardingSession.findUnique.mockResolvedValue(session)

    await dispatch(makeTextEvent('แม่'))

    expect(mockPrisma.onboardingSession.update).toHaveBeenCalledWith({
      where: { lineUserId: 'line-u-1' },
      data: { name: 'แม่', step: 'AWAITING_DOB' },
    })
    expect(lastReplyText()).toContain('เกิดวันที่')
    expect(mockHandleAiMessage).not.toHaveBeenCalled()
  })

  test('3. active session AWAITING_DOB, valid Thai date → createFamilyMember called, success reply, session deleted', async () => {
    const session = {
      id: 's-1', lineUserId: 'line-u-1', step: 'AWAITING_DOB', name: 'แม่',
      updatedAt: new Date(),
    }
    mockPrisma.onboardingSession.findUnique.mockResolvedValue(session)
    mockCreateFamilyMember.mockResolvedValue({ id: 'mem-1', name: 'แม่' })

    await dispatch(makeTextEvent('15 มีนาคม 2500'))

    expect(mockCreateFamilyMember).toHaveBeenCalledWith('user-1', {
      name: 'แม่',
      dateOfBirth: expect.any(Date),
      relation: 'สมาชิก',
    })
    expect(mockPrisma.onboardingSession.delete).toHaveBeenCalledWith({ where: { lineUserId: 'line-u-1' } })
    expect(lastReplyText()).toContain('✅')
    expect(lastReplyText()).toContain('แม่')
  })

  test('4. active session AWAITING_DOB, invalid date → error reply, session NOT deleted', async () => {
    const session = {
      id: 's-1', lineUserId: 'line-u-1', step: 'AWAITING_DOB', name: 'แม่',
      updatedAt: new Date(),
    }
    mockPrisma.onboardingSession.findUnique.mockResolvedValue(session)

    await dispatch(makeTextEvent('ไม่รู้วันเกิด'))

    expect(mockCreateFamilyMember).not.toHaveBeenCalled()
    expect(mockPrisma.onboardingSession.delete).not.toHaveBeenCalled()
    expect(lastReplyText()).toContain('ไม่สามารถอ่านวันเกิดได้')
  })

  test('5. session updatedAt > 10 min ago → session deleted, onboarding prompt shown', async () => {
    const oldDate = new Date(Date.now() - 11 * 60 * 1000)
    const session = {
      id: 's-1', lineUserId: 'line-u-1', step: 'AWAITING_NAME', name: null,
      updatedAt: oldDate,
    }
    mockPrisma.onboardingSession.findUnique.mockResolvedValue(session)
    mockListFamilyMembers.mockResolvedValue([])

    await dispatch(makeTextEvent('สวัสดี'))

    expect(mockPrisma.onboardingSession.delete).toHaveBeenCalledWith({ where: { lineUserId: 'line-u-1' } })
    const items = lastReplyQuickReplyItems()
    expect(items).toHaveLength(2)
  })

  test('6. ≥1 family members, no session → handleAiMessage called (normal flow)', async () => {
    mockListFamilyMembers.mockResolvedValue([{ id: 'mem-1', name: 'แม่' }])
    mockHandleAiMessage.mockResolvedValue({ type: 'text', text: 'ตอบกลับจาก AI' })

    await dispatch(makeTextEvent('ความดันแม่ 120/80'))

    expect(mockHandleAiMessage).toHaveBeenCalledWith(
      'ความดันแม่ 120/80',
      USER,
      [{ id: 'mem-1', name: 'แม่' }]
    )
  })
})

// ── Task 9-D: postback handlers ───────────────────────────────────────────────

describe('handlePostback — onboarding actions', () => {
  test('7. onboard_start, 0 members → session created (AWAITING_NAME), name question sent', async () => {
    mockListFamilyMembers.mockResolvedValue([])

    await dispatch(makePostbackEvent({ action: 'onboard_start' }))

    expect(mockPrisma.onboardingSession.upsert).toHaveBeenCalledWith({
      where: { lineUserId: 'line-u-1' },
      create: { lineUserId: 'line-u-1', step: 'AWAITING_NAME' },
      update: { step: 'AWAITING_NAME', name: null },
    })
    expect(lastReplyText()).toContain('ชื่อสมาชิก')
  })

  test('8. onboard_start, 1+ members → "คุณมีสมาชิกแล้ว" reply, no session created', async () => {
    mockListFamilyMembers.mockResolvedValue([{ id: 'mem-1', name: 'แม่' }])

    await dispatch(makePostbackEvent({ action: 'onboard_start' }))

    expect(mockPrisma.onboardingSession.upsert).not.toHaveBeenCalled()
    expect(lastReplyText()).toContain('คุณมีสมาชิกในครอบครัวแล้ว')
  })

  test('9. onboard_app → Thai app redirect message', async () => {
    await dispatch(makePostbackEvent({ action: 'onboard_app' }))

    expect(lastReplyText()).toContain('กรุณาเปิดแอป FamCare')
  })
})
