import { jest } from '@jest/globals'

const mockApptFindUnique = jest.fn()
const mockApptFindFirst = jest.fn()
const mockSymptomLogFindMany = jest.fn()
const mockMedicationFindMany = jest.fn()
const mockHealthMetricFindMany = jest.fn()

const mockAssertCanReadMember = jest.fn()
const mockFindOrCreate = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    appointment: {
      findUnique: mockApptFindUnique,
      findFirst: mockApptFindFirst,
    },
    symptomLog: { findMany: mockSymptomLogFindMany },
    medication: { findMany: mockMedicationFindMany },
    healthMetric: { findMany: mockHealthMetricFindMany },
  },
}))

jest.unstable_mockModule('../services/accessService.js', () => ({
  assertCanReadMember: mockAssertCanReadMember,
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreate,
}))

jest.unstable_mockModule('../services/appointmentService.js', () => ({
  listAppointments: jest.fn(),
  createAppointment: jest.fn(),
  getAppointment: jest.fn(),
  updateAppointment: jest.fn(),
  deleteAppointment: jest.fn(),
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: appointmentsRouter } = await import('../routes/appointments.js')
const { errorHandler } = await import('../middleware/errorHandler.js')

const app = express()
app.use(express.json())
app.use('/api/v1/appointments', appointmentsRouter)
app.use(errorHandler)

const request = supertest(app)

const USER_ID = 'user-1'
const LINE_ID = 'U_test_123'
const MEMBER_ID = 'member-abc'
const APPT_ID = 'appt-xyz'
const AUTH = { 'x-line-userid': LINE_ID }

function fakeAppointment(overrides = {}) {
  return {
    id: APPT_ID,
    familyMemberId: MEMBER_ID,
    title: 'Cardiology follow-up',
    appointmentAt: new Date('2026-05-20T03:00:00Z'),
    doctor: 'Dr. Smith',
    hospital: 'Bangkok General',
    reason: 'Routine follow-up',
    status: 'UPCOMING',
    familyMember: { id: MEMBER_ID },
    ...overrides,
  }
}

function fakeCompletedAppointment(overrides = {}) {
  return {
    id: 'appt-prev',
    familyMemberId: MEMBER_ID,
    title: 'Previous visit',
    appointmentAt: new Date('2026-05-01T03:00:00Z'),
    status: 'COMPLETED',
    ...overrides,
  }
}

function fakeSymptom(overrides = {}) {
  return {
    id: 'symptom-1',
    description: 'Headache',
    severity: 4,
    note: 'Comes and goes',
    loggedAt: new Date('2026-05-05T02:00:00Z'),
    ...overrides,
  }
}

function makeMedicationLogs({ taken = 0, missed = 0, skipped = 0 } = {}) {
  return [
    ...Array.from({ length: taken }, (_, index) => ({
      id: `taken-${index}`,
      status: 'TAKEN',
      takenAt: new Date('2026-05-06T01:00:00Z'),
    })),
    ...Array.from({ length: missed }, (_, index) => ({
      id: `missed-${index}`,
      status: 'MISSED',
      takenAt: new Date('2026-05-06T01:00:00Z'),
    })),
    ...Array.from({ length: skipped }, (_, index) => ({
      id: `skipped-${index}`,
      status: 'SKIPPED',
      takenAt: new Date('2026-05-06T01:00:00Z'),
    })),
  ]
}

function fakeMedication(overrides = {}) {
  return {
    id: 'med-1',
    name: 'Metformin',
    dosage: '500mg',
    logs: makeMedicationLogs({ taken: 20, missed: 5 }),
    ...overrides,
  }
}

function fakeHealthMetric(overrides = {}) {
  return {
    id: 'metric-1',
    type: 'BLOOD_PRESSURE',
    value: '140/90',
    unit: 'mmHg',
    note: 'Morning reading',
    measuredAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()

  mockFindOrCreate.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID, displayName: 'Test User' })
  mockAssertCanReadMember.mockResolvedValue('OWNER')

  mockApptFindUnique.mockResolvedValue(fakeAppointment())
  mockApptFindFirst.mockResolvedValue(fakeCompletedAppointment())
  mockSymptomLogFindMany.mockResolvedValue([
    fakeSymptom(),
    fakeSymptom({
      id: 'symptom-2',
      description: 'Fever',
      severity: 8,
      note: 'Mostly evenings',
      loggedAt: new Date('2026-05-08T02:00:00Z'),
    }),
  ])
  mockMedicationFindMany.mockResolvedValue([fakeMedication()])
  mockHealthMetricFindMany.mockResolvedValue([fakeHealthMetric()])
})

describe('GET /api/v1/appointments/:id/pre-appointment-report', () => {
  test('TC-1: full history returns all populated sections', async () => {
    const res = await request
      .get(`/api/v1/appointments/${APPT_ID}/pre-appointment-report`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.basedOnLastVisit).toBe(true)
    expect(res.body.data.symptoms).toHaveLength(2)
    expect(res.body.data.medicationAdherence[0].adherenceRate).toBe(80)
    expect(res.body.data.recentHealthMetrics).toHaveLength(1)
    expect(res.body.data.suggestedQuestions.length).toBeGreaterThanOrEqual(1)
    expect(res.body.data.appointment.id).toBe(APPT_ID)
  })

  test('TC-2: no prior symptoms returns an empty symptoms array', async () => {
    mockSymptomLogFindMany.mockResolvedValue([])

    const res = await request
      .get(`/api/v1/appointments/${APPT_ID}/pre-appointment-report`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.symptoms).toEqual([])
  })

  test('TC-3: response is valid JSON with all required sections', async () => {
    const res = await request
      .get(`/api/v1/appointments/${APPT_ID}/pre-appointment-report`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      appointment: expect.any(Object),
      windowStart: expect.any(String),
      windowEnd: expect.any(String),
      basedOnLastVisit: expect.any(Boolean),
      symptoms: expect.any(Array),
      medicationAdherence: expect.any(Array),
      recentHealthMetrics: expect.any(Array),
      suggestedQuestions: expect.any(Array),
    }))
    expect(res.body.data.appointment).toEqual(expect.objectContaining({
      id: APPT_ID,
      title: expect.any(String),
      appointmentAt: expect.any(String),
      doctor: expect.any(String),
      hospital: expect.any(String),
      reason: expect.any(String),
    }))
    expect(res.body.data.appointment.appointmentAt).toMatch(/\+07:00$/)
  })

  test('TC-4: adherence calculation returns 20 taken, 5 missed, total 25, rate 80', async () => {
    mockMedicationFindMany.mockResolvedValue([
      fakeMedication({ logs: makeMedicationLogs({ taken: 20, missed: 5 }) }),
    ])

    const res = await request
      .get(`/api/v1/appointments/${APPT_ID}/pre-appointment-report`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.medicationAdherence[0]).toEqual(expect.objectContaining({
      taken: 20,
      missed: 5,
      total: 25,
      adherenceRate: 80,
    }))
  })

  test('TC-5: high severity symptom appears in suggested questions', async () => {
    mockSymptomLogFindMany.mockResolvedValue([
      fakeSymptom({ description: 'Fever', severity: 9, note: null }),
    ])

    const res = await request
      .get(`/api/v1/appointments/${APPT_ID}/pre-appointment-report`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.suggestedQuestions.some(question => question.includes('Fever'))).toBe(true)
  })

  test('TC-6: appointment not found returns 404', async () => {
    mockApptFindUnique.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/appointments/${APPT_ID}/pre-appointment-report`)
      .set(AUTH)

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  test('TC-7: access denied returns 403', async () => {
    mockAssertCanReadMember.mockRejectedValue(
      Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' }),
    )

    const res = await request
      .get(`/api/v1/appointments/${APPT_ID}/pre-appointment-report`)
      .set(AUTH)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })

  test('TC-8: no prior completed appointment falls back to a 14 day window', async () => {
    mockApptFindFirst.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/appointments/${APPT_ID}/pre-appointment-report`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.basedOnLastVisit).toBe(false)
    expect(res.body.data.windowStart).toBeTruthy()
  })

  test('TC-9: no active medications returns an empty adherence array', async () => {
    mockMedicationFindMany.mockResolvedValue([])

    const res = await request
      .get(`/api/v1/appointments/${APPT_ID}/pre-appointment-report`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.medicationAdherence).toEqual([])
  })

  test('TC-10: missing x-line-userid header returns 401', async () => {
    const res = await request
      .get(`/api/v1/appointments/${APPT_ID}/pre-appointment-report`)

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('UNAUTHORIZED')
  })
})
