import { jest } from '@jest/globals'

const mockHealthMetricFindMany = jest.fn()
const mockHealthMetricFindUnique = jest.fn()
const mockHealthMetricCreate = jest.fn()
const mockHealthMetricUpdate = jest.fn()
const mockMetricThresholdFindMany = jest.fn()
const mockMetricThresholdFindUnique = jest.fn()
const mockMetricThresholdUpsert = jest.fn()
const mockMetricThresholdDelete = jest.fn()
const mockAssertCanReadMember = jest.fn()
const mockAssertCanWriteMember = jest.fn()
const mockAssertOwnerForMember = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockFindOrCreateByLineUserId = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    healthMetric: {
      findMany: mockHealthMetricFindMany,
      findUnique: mockHealthMetricFindUnique,
      create: mockHealthMetricCreate,
      update: mockHealthMetricUpdate,
      delete: jest.fn(),
    },
    metricThreshold: {
      findMany: mockMetricThresholdFindMany,
      findUnique: mockMetricThresholdFindUnique,
      upsert: mockMetricThresholdUpsert,
      delete: mockMetricThresholdDelete,
    },
  },
}))

jest.unstable_mockModule('../services/accessService.js', () => ({
  assertCanReadMember: mockAssertCanReadMember,
  assertCanWriteMember: mockAssertCanWriteMember,
  assertOwnerForMember: mockAssertOwnerForMember,
}))

jest.unstable_mockModule('../services/caregiverNotifyService.js', () => ({
  notifyOwnerIfCaregiver: mockNotifyOwnerIfCaregiver,
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreateByLineUserId,
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: healthMetricsRouter } = await import('../routes/healthMetrics.js')
const { errorHandler } = await import('../middleware/errorHandler.js')

const app = express()
app.use(express.json())
app.use('/api/v1/health-metrics', healthMetricsRouter)
app.use(errorHandler)

const request = supertest(app)

const USER_ID = 'user-1'
const LINE_ID = 'U_test_123'
const MEMBER_ID = 'member-abc'
const METRIC_ID = 'metric-1'
const AUTH = { 'x-line-userid': LINE_ID }

function fakeMetric(overrides = {}) {
  return {
    id: METRIC_ID,
    familyMemberId: MEMBER_ID,
    addedByUserId: USER_ID,
    type: 'CUSTOM',
    value: 2.3,
    value2: null,
    unit: 'ratio',
    label: 'INR',
    note: null,
    measuredAt: new Date('2026-04-14T03:00:00Z'),
    createdAt: new Date('2026-04-14T03:00:05Z'),
    ...overrides,
  }
}

function fakeThreshold(overrides = {}) {
  return {
    id: 'threshold-1',
    familyMemberId: MEMBER_ID,
    type: 'BLOOD_PRESSURE',
    unit: 'mmHg',
    minValue: null,
    maxValue: 130,
    minValue2: null,
    maxValue2: null,
    createdAt: new Date('2026-04-14T03:00:00Z'),
    updatedAt: new Date('2026-04-14T03:05:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreateByLineUserId.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID, displayName: 'Test' })
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockAssertOwnerForMember.mockResolvedValue(undefined)
  mockNotifyOwnerIfCaregiver.mockResolvedValue(undefined)
  mockHealthMetricFindMany.mockResolvedValue([fakeMetric()])
  mockHealthMetricFindUnique.mockResolvedValue(fakeMetric())
  mockHealthMetricCreate.mockImplementation(async ({ data }) => fakeMetric(data))
  mockHealthMetricUpdate.mockImplementation(async ({ data }) => fakeMetric(data))
  mockMetricThresholdFindMany.mockResolvedValue([])
  mockMetricThresholdFindUnique.mockResolvedValue(null)
  mockMetricThresholdUpsert.mockImplementation(async ({ create, update }) => fakeThreshold({ ...create, ...update }))
  mockMetricThresholdDelete.mockResolvedValue(undefined)
})

describe('GET /api/v1/health-metrics', () => {
  test('returns 400 when familyMemberId is missing', async () => {
    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'Query parameter familyMemberId is required' })
    expect(mockHealthMetricFindMany).not.toHaveBeenCalled()
  })

  test('returns 403 when list access is denied', async () => {
    mockAssertCanReadMember.mockRejectedValue(
      Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ code: 'FORBIDDEN', error: 'Access denied' })
    expect(mockHealthMetricFindMany).not.toHaveBeenCalled()
  })

  test('returns metrics with isAbnormal, label, and value2 fields', async () => {
    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].isAbnormal).toBe(false)
    expect(res.body.data[0].label).toBe('INR')
    expect(res.body.data[0].value2).toBeNull()
    expect(res.body.data[0]).not.toHaveProperty('abnormal')
  })

  test('marks high systolic blood pressure as abnormal', async () => {
    mockHealthMetricFindMany.mockResolvedValue([
      fakeMetric({
        type: 'BLOOD_PRESSURE',
        value: 145,
        value2: null,
        unit: 'mmHg',
        label: null,
      }),
    ])

    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data[0].isAbnormal).toBe(true)
  })

  test('marks normal blood pressure as not abnormal', async () => {
    mockHealthMetricFindMany.mockResolvedValue([
      fakeMetric({
        type: 'BLOOD_PRESSURE',
        value: 120,
        value2: 80,
        unit: 'mmHg',
        label: null,
      }),
    ])

    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data[0].isAbnormal).toBe(false)
  })

  test('applies date range filters to list queries', async () => {
    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({
        familyMemberId: MEMBER_ID,
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-12-31T23:59:59.000Z',
      })

    expect(res.status).toBe(200)
    expect(mockHealthMetricFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        familyMemberId: MEMBER_ID,
        measuredAt: expect.objectContaining({
          gte: new Date('2025-01-01T00:00:00.000Z'),
          lte: new Date('2025-12-31T23:59:59.000Z'),
        }),
      }),
      orderBy: { measuredAt: 'asc' },
    }))
  })

  test('applies type and from filters for trend queries', async () => {
    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({
        familyMemberId: MEMBER_ID,
        type: 'BLOOD_SUGAR',
        from: '2025-01-01T00:00:00.000Z',
      })

    expect(res.status).toBe(200)
    expect(mockHealthMetricFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        familyMemberId: MEMBER_ID,
        type: 'BLOOD_SUGAR',
        measuredAt: expect.objectContaining({
          gte: new Date('2025-01-01T00:00:00.000Z'),
        }),
      }),
    }))
  })

  test('marks high diastolic blood pressure as abnormal', async () => {
    mockHealthMetricFindMany.mockResolvedValue([
      fakeMetric({
        type: 'BLOOD_PRESSURE',
        value: 120,
        value2: 95,
        unit: 'mmHg',
        label: null,
      }),
    ])

    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data[0].isAbnormal).toBe(true)
  })

  test('marks low systolic blood pressure as abnormal', async () => {
    mockHealthMetricFindMany.mockResolvedValue([
      fakeMetric({
        type: 'BLOOD_PRESSURE',
        value: 85,
        value2: null,
        unit: 'mmHg',
        label: null,
      }),
    ])

    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data[0].isAbnormal).toBe(true)
  })

  test('marks abnormal blood sugar in mg/dL as abnormal', async () => {
    mockHealthMetricFindMany.mockResolvedValue([
      fakeMetric({
        type: 'BLOOD_SUGAR',
        value: 130,
        value2: null,
        unit: 'mg/dL',
        label: null,
      }),
    ])

    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data[0].isAbnormal).toBe(true)
  })

  test('marks normal blood sugar in mg/dL as not abnormal', async () => {
    mockHealthMetricFindMany.mockResolvedValue([
      fakeMetric({
        type: 'BLOOD_SUGAR',
        value: 100,
        value2: null,
        unit: 'mg/dL',
        label: null,
      }),
    ])

    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data[0].isAbnormal).toBe(false)
  })

  test('marks high temperature in celsius as abnormal', async () => {
    mockHealthMetricFindMany.mockResolvedValue([
      fakeMetric({
        type: 'TEMPERATURE',
        value: 38,
        value2: null,
        unit: '°C',
        label: null,
      }),
    ])

    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data[0].isAbnormal).toBe(true)
  })

  test('marks normal temperature in celsius as not abnormal', async () => {
    mockHealthMetricFindMany.mockResolvedValue([
      fakeMetric({
        type: 'TEMPERATURE',
        value: 37,
        value2: null,
        unit: '°C',
        label: null,
      }),
    ])

    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data[0].isAbnormal).toBe(false)
  })

  test('applies member threshold overrides when listing metrics', async () => {
    mockHealthMetricFindMany.mockResolvedValue([
      fakeMetric({
        type: 'BLOOD_PRESSURE',
        value: 135,
        value2: null,
        unit: 'mmHg',
        label: null,
      }),
    ])
    mockMetricThresholdFindMany.mockResolvedValue([
      fakeThreshold({ type: 'BLOOD_PRESSURE', maxValue: 130 }),
    ])

    const res = await request
      .get('/api/v1/health-metrics')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(mockMetricThresholdFindMany).toHaveBeenCalledWith({ where: { familyMemberId: MEMBER_ID } })
    expect(res.body.data[0].isAbnormal).toBe(true)
  })
})

describe('POST /api/v1/health-metrics', () => {
  test('stores blood pressure with Bangkok-formatted measuredAt in the response', async () => {
    mockHealthMetricCreate.mockImplementation(async ({ data }) => fakeMetric({
      ...data,
      type: 'BLOOD_PRESSURE',
      value: 120,
      value2: 80,
      label: null,
      unit: 'mmHg',
    }))

    const res = await request
      .post('/api/v1/health-metrics')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        type: 'BLOOD_PRESSURE',
        value: 120,
        value2: 80,
        unit: 'mmHg',
        measuredAt: '2025-06-01T09:00:00+07:00',
      })

    expect(res.status).toBe(201)
    expect(mockHealthMetricCreate).toHaveBeenCalled()
    expect(mockHealthMetricCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        measuredAt: new Date('2025-06-01T02:00:00.000Z'),
      }),
    }))
    expect(res.body.data.measuredAt).toBe('2025-06-01T09:00:00.000+07:00')
  })

  test('rejects invalid type values', async () => {
    const res = await request
      .post('/api/v1/health-metrics')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        type: 'INVALID',
        value: 2.3,
        unit: 'ratio',
        measuredAt: '2026-04-14T10:00:00+07:00',
      })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'type is invalid' })
    expect(mockHealthMetricCreate).not.toHaveBeenCalled()
  })

  test('rejects CUSTOM metrics without a label', async () => {
    const res = await request
      .post('/api/v1/health-metrics')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        type: 'CUSTOM',
        value: 2.3,
        unit: 'ratio',
        measuredAt: '2026-04-14T10:00:00+07:00',
      })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'label is required for CUSTOM type' })
    expect(mockHealthMetricCreate).not.toHaveBeenCalled()
  })

  test('creates CUSTOM metrics with trimmed label and null value2', async () => {
    const res = await request
      .post('/api/v1/health-metrics')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        type: 'CUSTOM',
        label: '  INR  ',
        value: 2.3,
        unit: 'ratio',
        measuredAt: '2026-04-14T10:00:00+07:00',
      })

    expect(res.status).toBe(201)
    expect(mockHealthMetricCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        familyMemberId: MEMBER_ID,
        type: 'CUSTOM',
        label: 'INR',
        value: 2.3,
        value2: null,
      }),
    }))
    expect(res.body.data.label).toBe('INR')
    expect(res.body.data.value2).toBeNull()
    expect(res.body.data).toHaveProperty('isAbnormal')
  })

  test('creates blood pressure metrics with value2', async () => {
    mockHealthMetricCreate.mockImplementation(async ({ data }) => fakeMetric({
      ...data,
      type: 'BLOOD_PRESSURE',
      unit: 'mmHg',
      label: null,
      value: 145,
      value2: 92,
    }))

    const res = await request
      .post('/api/v1/health-metrics')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        type: 'BLOOD_PRESSURE',
        value: 145,
        value2: 92,
        unit: 'mmHg',
        measuredAt: '2026-04-14T10:00:00+07:00',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.value).toBe(145)
    expect(res.body.data.value2).toBe(92)
    expect(res.body.data.label).toBeNull()
    expect(res.body.data).toHaveProperty('isAbnormal')
  })

  test('marks normal blood pressure as not abnormal on create', async () => {
    mockHealthMetricCreate.mockImplementation(async ({ data }) => fakeMetric({
      ...data,
      type: 'BLOOD_PRESSURE',
      value: 120,
      value2: 80,
      label: null,
      unit: 'mmHg',
    }))

    const res = await request
      .post('/api/v1/health-metrics')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        type: 'BLOOD_PRESSURE',
        value: 120,
        value2: 80,
        unit: 'mmHg',
        measuredAt: '2026-04-14T10:00:00+07:00',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.isAbnormal).toBe(false)
  })

  test('marks high diastolic blood pressure as abnormal on create', async () => {
    mockHealthMetricCreate.mockImplementation(async ({ data }) => fakeMetric({
      ...data,
      type: 'BLOOD_PRESSURE',
      value: 120,
      value2: 95,
      label: null,
      unit: 'mmHg',
    }))

    const res = await request
      .post('/api/v1/health-metrics')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        type: 'BLOOD_PRESSURE',
        value: 120,
        value2: 95,
        unit: 'mmHg',
        measuredAt: '2026-04-14T10:00:00+07:00',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.isAbnormal).toBe(true)
  })

  test('applies member threshold overrides when creating metrics', async () => {
    mockHealthMetricCreate.mockImplementation(async ({ data }) => fakeMetric({
      ...data,
      type: 'BLOOD_PRESSURE',
      unit: 'mmHg',
      label: null,
      value: 135,
      value2: null,
    }))
    mockMetricThresholdFindUnique.mockResolvedValue(fakeThreshold({ type: 'BLOOD_PRESSURE', maxValue: 130 }))

    const res = await request
      .post('/api/v1/health-metrics')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        type: 'BLOOD_PRESSURE',
        value: 135,
        unit: 'mmHg',
        measuredAt: '2026-04-14T10:00:00+07:00',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.isAbnormal).toBe(true)
    expect(mockMetricThresholdFindUnique).toHaveBeenCalledWith({
      where: {
        familyMemberId_type: {
          familyMemberId: MEMBER_ID,
          type: 'BLOOD_PRESSURE',
        },
      },
    })
  })

  test('rejects non-numeric value', async () => {
    const res = await request
      .post('/api/v1/health-metrics')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        type: 'WEIGHT',
        value: 'not-a-number',
        unit: 'kg',
        measuredAt: '2026-04-14T10:00:00+07:00',
      })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'value must be a number' })
    expect(mockHealthMetricCreate).not.toHaveBeenCalled()
  })

  test('marks high temperature as abnormal on create', async () => {
    mockHealthMetricCreate.mockImplementation(async ({ data }) => fakeMetric({
      ...data,
      type: 'TEMPERATURE',
      value: 38,
      value2: null,
      label: null,
      unit: '°C',
    }))

    const res = await request
      .post('/api/v1/health-metrics')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        type: 'TEMPERATURE',
        value: 38,
        unit: '°C',
        measuredAt: '2026-04-14T10:00:00+07:00',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.isAbnormal).toBe(true)
  })

  test('marks high blood sugar as abnormal on create', async () => {
    mockHealthMetricCreate.mockImplementation(async ({ data }) => fakeMetric({
      ...data,
      type: 'BLOOD_SUGAR',
      value: 130,
      value2: null,
      label: null,
      unit: 'mg/dL',
    }))

    const res = await request
      .post('/api/v1/health-metrics')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        type: 'BLOOD_SUGAR',
        value: 130,
        unit: 'mg/dL',
        measuredAt: '2026-04-14T10:00:00+07:00',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.isAbnormal).toBe(true)
  })
})

describe('PATCH /api/v1/health-metrics/:id', () => {
  test('updates and clears label/value2 fields', async () => {
    const res = await request
      .patch(`/api/v1/health-metrics/${METRIC_ID}`)
      .set(AUTH)
      .send({
        label: null,
        value2: '92',
      })

    expect(res.status).toBe(200)
    expect(mockHealthMetricUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: METRIC_ID },
      data: expect.objectContaining({
        label: null,
        value2: 92,
      }),
    }))
  })
})

describe('GET /api/v1/health-metrics/:memberId/thresholds', () => {
  test('returns threshold overrides for readers', async () => {
    mockMetricThresholdFindMany.mockResolvedValue([fakeThreshold()])

    const res = await request
      .get(`/api/v1/health-metrics/${MEMBER_ID}/thresholds`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].type).toBe('BLOOD_PRESSURE')
    expect(res.body.data[0].createdAt).toBe('2026-04-14T10:00:00.000+07:00')
    expect(mockAssertCanReadMember).toHaveBeenCalledWith(USER_ID, MEMBER_ID)
  })
})

describe('PUT /api/v1/health-metrics/:memberId/thresholds/:type', () => {
  test('upserts a threshold for owners', async () => {
    const res = await request
      .put(`/api/v1/health-metrics/${MEMBER_ID}/thresholds/BLOOD_PRESSURE`)
      .set(AUTH)
      .send({ unit: 'mmHg', maxValue: 130 })

    expect(res.status).toBe(200)
    expect(mockAssertOwnerForMember).toHaveBeenCalledWith(USER_ID, MEMBER_ID)
    expect(mockMetricThresholdUpsert).toHaveBeenCalledWith({
      where: {
        familyMemberId_type: {
          familyMemberId: MEMBER_ID,
          type: 'BLOOD_PRESSURE',
        },
      },
      update: {
        unit: 'mmHg',
        minValue: undefined,
        maxValue: 130,
        minValue2: undefined,
        maxValue2: undefined,
      },
      create: {
        familyMemberId: MEMBER_ID,
        type: 'BLOOD_PRESSURE',
        unit: 'mmHg',
        minValue: undefined,
        maxValue: 130,
        minValue2: undefined,
        maxValue2: undefined,
      },
    })
    expect(res.body.data.maxValue).toBe(130)
  })

  test('rejects invalid threshold types', async () => {
    const res = await request
      .put(`/api/v1/health-metrics/${MEMBER_ID}/thresholds/INVALID`)
      .set(AUTH)
      .send({ unit: 'mmHg', maxValue: 130 })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'type is invalid' })
    expect(mockMetricThresholdUpsert).not.toHaveBeenCalled()
  })

  test('rejects caregiver threshold writes', async () => {
    mockAssertOwnerForMember.mockRejectedValue(
      Object.assign(new Error('Only the owner can manage access'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .put(`/api/v1/health-metrics/${MEMBER_ID}/thresholds/BLOOD_PRESSURE`)
      .set(AUTH)
      .send({ unit: 'mmHg', maxValue: 130 })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ code: 'FORBIDDEN', error: 'Only the owner can manage access' })
    expect(mockMetricThresholdUpsert).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/health-metrics/:memberId/thresholds/:type', () => {
  test('deletes an existing threshold', async () => {
    const res = await request
      .delete(`/api/v1/health-metrics/${MEMBER_ID}/thresholds/BLOOD_PRESSURE`)
      .set(AUTH)

    expect(res.status).toBe(204)
    expect(mockMetricThresholdDelete).toHaveBeenCalledWith({
      where: {
        familyMemberId_type: {
          familyMemberId: MEMBER_ID,
          type: 'BLOOD_PRESSURE',
        },
      },
    })
  })

  test('treats missing thresholds as idempotent success', async () => {
    mockMetricThresholdDelete.mockRejectedValue({ code: 'P2025' })

    const res = await request
      .delete(`/api/v1/health-metrics/${MEMBER_ID}/thresholds/BLOOD_PRESSURE`)
      .set(AUTH)

    expect(res.status).toBe(204)
  })
})
