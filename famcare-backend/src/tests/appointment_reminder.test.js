import { jest } from '@jest/globals'

// ── Mock handles ──────────────────────────────────────────────────────────────
const mockReminderFindMany   = jest.fn()
const mockReminderUpdateMany = jest.fn()
const mockReminderDeleteMany = jest.fn()
const mockReminderCreateMany = jest.fn()
const mockTransaction        = jest.fn()

const mockApptCreate         = jest.fn()
const mockApptFindUnique     = jest.fn()
const mockApptFindMany       = jest.fn()
const mockApptUpdate         = jest.fn()

const mockFamilyMemberFindUnique = jest.fn()
const mockFamilyAccessFindUnique = jest.fn()

const mockSendLinePush           = jest.fn()
const mockAssertCanReadMember    = jest.fn()
const mockAssertCanWriteMember   = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockFindOrCreate           = jest.fn()

// ── Module mocks ──────────────────────────────────────────────────────────────
jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    reminder: {
      findMany:   mockReminderFindMany,
      updateMany: mockReminderUpdateMany,
      deleteMany: mockReminderDeleteMany,
      createMany: mockReminderCreateMany,
    },
    appointment: {
      create:     mockApptCreate,
      findUnique: mockApptFindUnique,
      findMany:   mockApptFindMany,
      update:     mockApptUpdate,
    },
    familyMember:  { findUnique: mockFamilyMemberFindUnique },
    familyAccess:  { findUnique: mockFamilyAccessFindUnique },
    $transaction:  mockTransaction,
  },
}))

jest.unstable_mockModule('../services/linePushService.js', () => ({
  sendLinePushToUser: mockSendLinePush,
}))

jest.unstable_mockModule('../services/accessService.js', () => ({
  assertCanReadMember:    mockAssertCanReadMember,
  assertCanWriteMember:   mockAssertCanWriteMember,
  getAccessRoleForMember: jest.fn().mockResolvedValue('OWNER'),
  assertOwnerForMember:   jest.fn().mockResolvedValue(undefined),
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreate,
}))

jest.unstable_mockModule('../services/caregiverNotifyService.js', () => ({
  notifyOwnerIfCaregiver: mockNotifyOwnerIfCaregiver,
}))

// ── Dynamic imports after mocks ───────────────────────────────────────────────
const { dispatchDueReminders }    = await import('../services/reminderDispatchService.js')
const { default: express }        = await import('express')
const { default: supertest }      = await import('supertest')
const { default: appointmentsRouter } = await import('../routes/appointments.js')
const { errorHandler }            = await import('../middleware/errorHandler.js')

// ── Minimal HTTP app (for custom timing test) ────────────────────────────────
const app = express()
app.use(express.json())
app.use('/api/v1/appointments', appointmentsRouter)
app.use(errorHandler)
const request = supertest(app)

// ── Constants ─────────────────────────────────────────────────────────────────
const USER_ID    = 'user-1'
const LINE_ID    = 'U_test_owner'
const MEMBER_ID  = 'member-abc'
const APPT_ID    = 'appt-xyz'
const REMINDER_ID = 'reminder-1'
const AUTH        = { 'x-line-userid': LINE_ID }

// 30 days ahead — all default (and custom) offsets will still be in the future
const FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

function fakeReminder(overrides = {}) {
  return {
    id:            REMINDER_ID,
    appointmentId: APPT_ID,
    type:          'SEVEN_DAYS',
    scheduledAt:   new Date(Date.now() - 60_000), // 1 min ago → due
    sent:          false,
    appointment: {
      id:            APPT_ID,
      title:         'Checkup',
      appointmentAt: FUTURE_DATE,
      hospital:      'City Hospital',
      doctor:        'Dr. Smith',
      status:        'UPCOMING',
      familyMember: {
        id:   MEMBER_ID,
        name: 'Grandma',
        owner: { id: USER_ID, lineUserId: LINE_ID },
        accessList: [],
      },
    },
    ...overrides,
  }
}

function fakeAppt(overrides = {}) {
  return {
    id:                   APPT_ID,
    familyMemberId:       MEMBER_ID,
    addedByUserId:        USER_ID,
    title:                'Checkup',
    appointmentAt:        FUTURE_DATE,
    doctor:               'Dr. Smith',
    hospital:             'City Hospital',
    reason:               null,
    preNotes:             null,
    postNotes:            null,
    status:               'UPCOMING',
    accompaniedByUserId:  null,
    whoBringsNote:        null,
    reminderOffsetsJson:  null,
    createdAt:            new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

// ── Reset before each test ────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreate.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID, displayName: 'Test' })
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockNotifyOwnerIfCaregiver.mockResolvedValue(undefined)
  mockSendLinePush.mockResolvedValue(undefined)
  mockReminderUpdateMany.mockResolvedValue({ count: 1 })
  mockReminderDeleteMany.mockResolvedValue({ count: 0 })
  mockReminderCreateMany.mockResolvedValue({ count: 0 })
  mockTransaction.mockImplementation(async (ops) => Promise.all(ops))
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cron fires → only unsent reminders within +5min window are dispatched
// ─────────────────────────────────────────────────────────────────────────────
describe('dispatchDueReminders — window and delivery', () => {
  test('sends LINE push and marks reminder sent for unsent reminders within +5min window', async () => {
    mockReminderFindMany.mockResolvedValue([fakeReminder()])

    await dispatchDueReminders()

    // LINE push sent to the family member owner
    expect(mockSendLinePush).toHaveBeenCalledTimes(1)
    expect(mockSendLinePush).toHaveBeenCalledWith(LINE_ID, expect.stringContaining('Checkup'))

    // Reminder marked as sent
    expect(mockReminderUpdateMany).toHaveBeenCalledWith({
      where: { id: REMINDER_ID, sent: false },
      data:  { sent: true },
    })
  })

  test('query uses a +5min lookahead window so reminders are never dispatched late', async () => {
    mockReminderFindMany.mockResolvedValue([])

    await dispatchDueReminders()

    const findArg = mockReminderFindMany.mock.calls[0][0]
    const { lte } = findArg.where.scheduledAt

    // lte must be a Date roughly 5 minutes ahead of now (allow ±2s clock drift)
    const expectedMs = Date.now() + 5 * 60 * 1000
    expect(lte).toBeInstanceOf(Date)
    expect(Math.abs(lte.getTime() - expectedMs)).toBeLessThan(2000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cancelled appointment → its reminders are skipped
// ─────────────────────────────────────────────────────────────────────────────
describe('dispatchDueReminders — cancelled appointments', () => {
  test('WHERE clause excludes reminders whose appointment is CANCELLED', async () => {
    mockReminderFindMany.mockResolvedValue([])

    await dispatchDueReminders()

    const findArg = mockReminderFindMany.mock.calls[0][0]
    // The query must filter out CANCELLED appointments
    expect(findArg.where.appointment).toEqual(
      expect.objectContaining({ status: { not: 'CANCELLED' } })
    )
  })

  test('no LINE push is sent when query returns zero results (all filtered)', async () => {
    // Simulate: cancelled reminder was correctly excluded by the WHERE clause
    mockReminderFindMany.mockResolvedValue([])

    await dispatchDueReminders()

    expect(mockSendLinePush).not.toHaveBeenCalled()
    expect(mockReminderUpdateMany).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Custom timing: [3d, 1d] → only 2 Reminder rows created
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/appointments — custom reminder offsets', () => {
  test('creates exactly 2 reminder rows when reminderOffsets = [3d, 1d]', async () => {
    mockApptCreate.mockResolvedValue(fakeAppt())

    const threeDaysMs = 3 * 24 * 60 * 60 * 1000
    const oneDayMs    = 1 * 24 * 60 * 60 * 1000

    const res = await request
      .post('/api/v1/appointments')
      .set(AUTH)
      .send({
        familyMemberId:  MEMBER_ID,
        title:           'Checkup',
        appointmentAt:   FUTURE_DATE.toISOString(),
        reminderOffsets: [threeDaysMs, oneDayMs],
      })

    expect(res.status).toBe(201)

    // syncRemindersForAppointment runs with custom offsets → createMany with 2 rows
    expect(mockReminderCreateMany).toHaveBeenCalledTimes(1)
    const { data: reminders } = mockReminderCreateMany.mock.calls[0][0]

    expect(reminders).toHaveLength(2)
    reminders.forEach(r => expect(r.type).toBe('CUSTOM'))

    const apptMs = FUTURE_DATE.getTime()
    const scheduledMs = reminders.map(r => r.scheduledAt.getTime()).sort((a, b) => a - b)
    expect(scheduledMs[0]).toBe(apptMs - threeDaysMs) // earlier reminder
    expect(scheduledMs[1]).toBe(apptMs - oneDayMs)    // later reminder
  })

  test('default 4 reminders created when no reminderOffsets supplied', async () => {
    mockApptCreate.mockResolvedValue(fakeAppt())

    const res = await request
      .post('/api/v1/appointments')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        title:          'Checkup',
        appointmentAt:  FUTURE_DATE.toISOString(),
      })

    expect(res.status).toBe(201)
    expect(mockReminderCreateMany).toHaveBeenCalledTimes(1)
    const { data: reminders } = mockReminderCreateMany.mock.calls[0][0]
    expect(reminders).toHaveLength(4)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Idempotency — reminder not double-sent if cron overlaps
// ─────────────────────────────────────────────────────────────────────────────
describe('dispatchDueReminders — idempotency', () => {
  test('updateMany uses sent:false guard so concurrent runs cannot double-send', async () => {
    mockReminderFindMany.mockResolvedValue([fakeReminder()])

    await dispatchDueReminders()

    // The WHERE condition `sent: false` makes the update a no-op if already sent
    const updateArg = mockReminderUpdateMany.mock.calls[0][0]
    expect(updateArg.where).toEqual({ id: REMINDER_ID, sent: false })
    expect(updateArg.data).toEqual({ sent: true })
  })

  test('already-sent reminders are excluded by the query (sent: false filter)', async () => {
    mockReminderFindMany.mockResolvedValue([])

    await dispatchDueReminders()

    const findArg = mockReminderFindMany.mock.calls[0][0]
    expect(findArg.where.sent).toBe(false)
  })
})
