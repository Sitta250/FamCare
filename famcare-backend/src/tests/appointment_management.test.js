import { jest } from '@jest/globals'

// ── Mock handles ──────────────────────────────────────────────────────────────
const mockApptCreate     = jest.fn()
const mockApptFindMany   = jest.fn()
const mockApptFindUnique = jest.fn()
const mockApptFindFirst  = jest.fn()
const mockApptUpdate     = jest.fn()
const mockApptDelete     = jest.fn()

const mockReminderDeleteMany = jest.fn()
const mockReminderCreateMany = jest.fn()
const mockTransaction        = jest.fn()

const mockFamilyMemberFindUnique = jest.fn()
const mockFamilyAccessFindUnique = jest.fn()
const mockSymptomLogFindMany     = jest.fn()
const mockMedicationFindMany     = jest.fn()
const mockHealthMetricFindMany   = jest.fn()

const mockAssertCanReadMember    = jest.fn()
const mockAssertCanWriteMember   = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockFindOrCreate           = jest.fn()

// ── Module mocks (before any dynamic imports) ─────────────────────────────────
jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    appointment: {
      create:     mockApptCreate,
      findMany:   mockApptFindMany,
      findUnique: mockApptFindUnique,
      findFirst:  mockApptFindFirst,
      update:     mockApptUpdate,
      delete:     mockApptDelete,
    },
    reminder: {
      deleteMany: mockReminderDeleteMany,
      createMany: mockReminderCreateMany,
    },
    familyMember:  { findUnique: mockFamilyMemberFindUnique },
    familyAccess:  { findUnique: mockFamilyAccessFindUnique },
    symptomLog:    { findMany:   mockSymptomLogFindMany },
    medication:    { findMany:   mockMedicationFindMany },
    healthMetric:  { findMany:   mockHealthMetricFindMany },
    $transaction:  mockTransaction,
  },
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
const { default: express }           = await import('express')
const { default: supertest }         = await import('supertest')
const { default: appointmentsRouter } = await import('../routes/appointments.js')
const { errorHandler }               = await import('../middleware/errorHandler.js')

// ── Minimal test app ──────────────────────────────────────────────────────────
const app = express()
app.use(express.json())
app.use('/api/v1/appointments', appointmentsRouter)
app.use(errorHandler)

const request = supertest(app)

// ── Constants ─────────────────────────────────────────────────────────────────
const USER_ID   = 'user-1'
const LINE_ID   = 'U_test_123'
const MEMBER_ID = 'member-abc'
const APPT_ID   = 'appt-xyz'
const AUTH      = { 'x-line-userid': LINE_ID }

// 30 days ahead: all 4 reminder offsets (7d/2d/1d/2h) are still in the future
const FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

function fakeAppt(overrides = {}) {
  return {
    id:                  APPT_ID,
    familyMemberId:      MEMBER_ID,
    addedByUserId:       USER_ID,
    title:               'Checkup',
    appointmentAt:       FUTURE_DATE,
    doctor:              'Dr. Smith',
    hospital:            'City Hospital',
    reason:              null,
    preNotes:            null,
    postNotes:           null,
    status:              'UPCOMING',
    accompaniedByUserId: null,
    whoBringsNote:       null,
    createdAt:           new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

// ── Reset mocks before each test ──────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreate.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID, displayName: 'Test' })
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockNotifyOwnerIfCaregiver.mockResolvedValue(undefined)
  // Simulate $transaction by awaiting all ops passed to it
  mockTransaction.mockImplementation(async (ops) => Promise.all(ops))
  mockReminderDeleteMany.mockResolvedValue({ count: 0 })
  mockReminderCreateMany.mockResolvedValue({ count: 4 })
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. Create → 4 Reminder rows at correct UTC offsets
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/appointments', () => {
  test('auto-creates 4 reminder rows at correct UTC offsets', async () => {
    mockApptCreate.mockResolvedValue(fakeAppt())

    const res = await request
      .post('/api/v1/appointments')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        title:          'Checkup',
        appointmentAt:  FUTURE_DATE.toISOString(),
        doctor:         'Dr. Smith',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.title).toBe('Checkup')

    // $transaction was called (by syncRemindersForAppointment)
    expect(mockTransaction).toHaveBeenCalledTimes(1)

    // deleteMany clears old unsent reminders first
    expect(mockReminderDeleteMany).toHaveBeenCalledWith({
      where: { appointmentId: APPT_ID, sent: false },
    })

    // createMany called with exactly 4 reminders
    expect(mockReminderCreateMany).toHaveBeenCalledTimes(1)
    const { data: reminders } = mockReminderCreateMany.mock.calls[0][0]
    expect(reminders).toHaveLength(4)

    const types = reminders.map(r => r.type)
    expect(types).toEqual(expect.arrayContaining(['SEVEN_DAYS', 'TWO_DAYS', 'ONE_DAY', 'TWO_HOURS']))

    // Verify exact UTC offsets from the appointment time
    const apptMs = FUTURE_DATE.getTime()
    const byType = Object.fromEntries(reminders.map(r => [r.type, r.scheduledAt.getTime()]))
    expect(byType.SEVEN_DAYS).toBe(apptMs - 7 * 24 * 60 * 60 * 1000)
    expect(byType.TWO_DAYS).toBe(apptMs - 2 * 24 * 60 * 60 * 1000)
    expect(byType.ONE_DAY).toBe(apptMs - 1 * 24 * 60 * 60 * 1000)
    expect(byType.TWO_HOURS).toBe(apptMs - 2 * 60 * 60 * 1000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reschedule → Reminder rows recalculated
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/v1/appointments/:id — reschedule', () => {
  test('recalculates reminder rows based on the new appointment time', async () => {
    const newDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000)
    mockApptFindUnique.mockResolvedValue(fakeAppt())
    mockApptUpdate.mockResolvedValue(fakeAppt({ appointmentAt: newDate }))

    const res = await request
      .patch(`/api/v1/appointments/${APPT_ID}`)
      .set(AUTH)
      .send({ appointmentAt: newDate.toISOString() })

    expect(res.status).toBe(200)

    // syncReminders called → $transaction fired
    expect(mockTransaction).toHaveBeenCalledTimes(1)

    // 4 reminders created for the new date
    expect(mockReminderCreateMany).toHaveBeenCalledTimes(1)
    const { data: reminders } = mockReminderCreateMany.mock.calls[0][0]
    expect(reminders).toHaveLength(4)

    // SEVEN_DAYS offset is relative to the NEW date
    const byType = Object.fromEntries(reminders.map(r => [r.type, r.scheduledAt.getTime()]))
    expect(byType.SEVEN_DAYS).toBe(newDate.getTime() - 7 * 24 * 60 * 60 * 1000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET ?view=upcoming → future, non-cancelled, sorted ascending
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/appointments?view=upcoming', () => {
  test('passes correct filter to DB: future dates, excludes CANCELLED, sorted asc', async () => {
    mockApptFindMany.mockResolvedValue([fakeAppt()])

    const res = await request
      .get('/api/v1/appointments')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID, view: 'upcoming' })

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)

    const findArg = mockApptFindMany.mock.calls[0][0]
    expect(findArg.where.status).toEqual({ not: 'CANCELLED' })
    expect(findArg.where.appointmentAt).toHaveProperty('gte')
    expect(findArg.where.appointmentAt.gte).toBeInstanceOf(Date)
    expect(findArg.orderBy).toEqual({ appointmentAt: 'asc' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. GET ?view=calendar → grouped by date key
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/appointments?view=calendar', () => {
  test('returns appointments grouped as an object keyed by YYYY-MM-DD date', async () => {
    // Two appointments on different days
    const day1 = new Date('2025-06-15T10:00:00Z')
    const day2 = new Date('2025-06-20T14:00:00Z')
    mockApptFindMany.mockResolvedValue([
      fakeAppt({ id: 'a1', appointmentAt: day1 }),
      fakeAppt({ id: 'a2', appointmentAt: day2 }),
    ])

    const res = await request
      .get('/api/v1/appointments')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID, view: 'calendar' })

    expect(res.status).toBe(200)

    const data = res.body.data
    expect(typeof data).toBe('object')
    expect(Array.isArray(data)).toBe(false)

    const keys = Object.keys(data)
    expect(keys).toHaveLength(2)
    keys.forEach(k => expect(k).toMatch(/^\d{4}-\d{2}-\d{2}$/))
    keys.forEach(k => expect(Array.isArray(data[k])).toBe(true))
    // Each date bucket holds the right appointment
    keys.forEach(k => expect(data[k][0].appointmentAt.startsWith(k)).toBe(true))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Mark completed with postNotes
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/v1/appointments/:id — mark completed', () => {
  test('sets status to COMPLETED and persists postNotes', async () => {
    mockApptFindUnique.mockResolvedValue(fakeAppt())
    mockApptUpdate.mockResolvedValue(
      fakeAppt({ status: 'COMPLETED', postNotes: 'Recovery going well' })
    )

    const res = await request
      .patch(`/api/v1/appointments/${APPT_ID}`)
      .set(AUTH)
      .send({ status: 'COMPLETED', postNotes: 'Recovery going well' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('COMPLETED')
    expect(res.body.data.postNotes).toBe('Recovery going well')

    const updateArg = mockApptUpdate.mock.calls[0][0]
    expect(updateArg.data).toMatchObject({
      status:    'COMPLETED',
      postNotes: 'Recovery going well',
    })

    // deleteUnsentReminders is called for COMPLETED (no $transaction)
    expect(mockReminderDeleteMany).toHaveBeenCalledWith({
      where: { appointmentId: APPT_ID, sent: false },
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Cancel → CANCELLED status, unsent reminders deleted
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/v1/appointments/:id — cancel', () => {
  test('sets status to CANCELLED and deletes unsent reminders', async () => {
    mockApptFindUnique.mockResolvedValue(fakeAppt())
    mockApptUpdate.mockResolvedValue(fakeAppt({ status: 'CANCELLED' }))

    const res = await request
      .patch(`/api/v1/appointments/${APPT_ID}`)
      .set(AUTH)
      .send({ status: 'CANCELLED' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('CANCELLED')

    // deleteUnsentReminders called directly (no $transaction)
    expect(mockReminderDeleteMany).toHaveBeenCalledWith({
      where: { appointmentId: APPT_ID, sent: false },
    })
    expect(mockReminderCreateMany).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. Authorization: accessing another family's appointments → 403
// ─────────────────────────────────────────────────────────────────────────────
describe('Authorization', () => {
  test("returns 403 when requesting a family member the user does not own or have access to", async () => {
    mockAssertCanReadMember.mockRejectedValueOnce(
      Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .get('/api/v1/appointments')
      .set(AUTH)
      .query({ familyMemberId: 'other-users-member' })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })
})
