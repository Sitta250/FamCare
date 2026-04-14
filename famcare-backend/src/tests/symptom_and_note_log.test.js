import { jest } from '@jest/globals'

const mockSymptomLogCreate = jest.fn()
const mockSymptomLogFindUnique = jest.fn()
const mockSymptomLogFindMany = jest.fn()
const mockSymptomLogUpdate = jest.fn()
const mockSymptomLogDelete = jest.fn()
const mockAssertCanReadMember = jest.fn()
const mockAssertCanWriteMember = jest.fn()
const mockNotifyOwnerIfCaregiver = jest.fn()
const mockFindOrCreate = jest.fn()
const mockUploadBuffer = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    symptomLog: {
      create: mockSymptomLogCreate,
      findUnique: mockSymptomLogFindUnique,
      findMany: mockSymptomLogFindMany,
      update: mockSymptomLogUpdate,
      delete: mockSymptomLogDelete,
    },
  },
}))

jest.unstable_mockModule('../services/accessService.js', () => ({
  assertCanReadMember: mockAssertCanReadMember,
  assertCanWriteMember: mockAssertCanWriteMember,
}))

jest.unstable_mockModule('../services/caregiverNotifyService.js', () => ({
  notifyOwnerIfCaregiver: mockNotifyOwnerIfCaregiver,
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreate,
}))

jest.unstable_mockModule('../services/cloudinaryService.js', () => ({
  uploadBuffer: mockUploadBuffer,
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { default: symptomLogsRouter } = await import('../routes/symptomLogs.js')
const { errorHandler } = await import('../middleware/errorHandler.js')

const app = express()
app.use(express.json())
app.use('/api/v1/symptom-logs', symptomLogsRouter)
app.use(errorHandler)

const request = supertest(app)

const LINE_ID = 'U_test_symptom_123'
const USER_ID = 'usr_symptom_abc'
const MEMBER_ID = 'mem_xyz'
const LOG_ID = 'clogabc12345678901234567'
const AUTH = { 'x-line-userid': LINE_ID }

function fakeLog(overrides = {}) {
  return {
    id: LOG_ID,
    familyMemberId: MEMBER_ID,
    addedByUserId: USER_ID,
    description: 'Headache',
    severity: 6,
    note: null,
    photoUrl: null,
    voiceNoteUrl: null,
    loggedAt: new Date('2026-04-14T10:00:00Z'),
    createdAt: new Date('2026-04-14T10:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreate.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID, displayName: 'Test' })
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockNotifyOwnerIfCaregiver.mockResolvedValue(undefined)
  mockUploadBuffer.mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/famcare/symptom-logs/mem_xyz/photos/headache.jpg',
    public_id: 'famcare/symptom-logs/mem_xyz/photos/headache',
  })
  mockSymptomLogCreate.mockImplementation(async ({ data }) => fakeLog(data))
  mockSymptomLogFindUnique.mockResolvedValue(fakeLog())
  mockSymptomLogFindMany.mockResolvedValue([
    fakeLog({ id: 'clognew12345678901234567', description: 'Dizziness', loggedAt: new Date('2026-04-15T10:00:00Z') }),
    fakeLog({ id: 'clogold12345678901234567', description: 'Headache', loggedAt: new Date('2026-04-13T10:00:00Z') }),
  ])
  mockSymptomLogUpdate.mockImplementation(async ({ where, data }) => fakeLog({ id: where.id, ...data }))
  mockSymptomLogDelete.mockResolvedValue(fakeLog())
})

describe('POST /api/v1/symptom-logs', () => {
  test('creates a symptom log with severity and returns 201', async () => {
    const res = await request
      .post('/api/v1/symptom-logs')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        description: 'Grandma has a headache today',
        severity: 6,
        note: 'After lunch',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.id).toBe(LOG_ID)
    expect(res.body.data.severity).toBe(6)
    expect(mockSymptomLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyMemberId: MEMBER_ID,
        description: 'Grandma has a headache today',
        severity: 6,
        note: 'After lunch',
        photoUrl: null,
        voiceNoteUrl: null,
      }),
    })
  })

  test('stores photoUrl when provided', async () => {
    const photoUrl = 'https://res.cloudinary.com/demo/image/upload/v1/famcare/symptom-logs/mem_xyz/photos/headache.jpg'

    const res = await request
      .post('/api/v1/symptom-logs')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        description: 'Visible rash',
        severity: '6',
        photoUrl,
      })

    expect(res.status).toBe(201)
    expect(res.body.data.photoUrl).toBe(photoUrl)
    expect(mockSymptomLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        photoUrl,
      }),
    })
  })

  test('returns 400 when description is missing', async () => {
    const res = await request
      .post('/api/v1/symptom-logs')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        severity: 6,
      })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'description is required' })
    expect(mockSymptomLogCreate).not.toHaveBeenCalled()
  })

  test('returns 400 when severity is 0', async () => {
    const res = await request
      .post('/api/v1/symptom-logs')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        description: 'Headache',
        severity: 0,
      })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'severity must be an integer between 1 and 10' })
    expect(mockSymptomLogCreate).not.toHaveBeenCalled()
  })

  test('returns 400 when severity is 11', async () => {
    const res = await request
      .post('/api/v1/symptom-logs')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        description: 'Headache',
        severity: 11,
      })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'severity must be an integer between 1 and 10' })
  })

  test('returns 400 when severity is a float', async () => {
    const res = await request
      .post('/api/v1/symptom-logs')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        description: 'Headache',
        severity: 5.5,
      })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'severity must be an integer between 1 and 10' })
  })

  test('returns 403 when write access is denied', async () => {
    mockAssertCanWriteMember.mockRejectedValue(
      Object.assign(new Error('Access denied'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .post('/api/v1/symptom-logs')
      .set(AUTH)
      .send({
        familyMemberId: MEMBER_ID,
        description: 'Headache',
        severity: 6,
      })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ code: 'FORBIDDEN', error: 'Access denied' })
    expect(mockSymptomLogCreate).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/symptom-logs', () => {
  test('returns newest-first timeline', async () => {
    const res = await request
      .get('/api/v1/symptom-logs')
      .set(AUTH)
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    expect(res.body.data[0].description).toBe('Dizziness')
    expect(res.body.data[1].description).toBe('Headache')
    expect(mockSymptomLogFindMany).toHaveBeenCalledWith({
      where: { familyMemberId: MEMBER_ID },
      orderBy: { loggedAt: 'desc' },
      take: 50,
    })
  })

  test('returns 400 when familyMemberId is missing', async () => {
    const res = await request
      .get('/api/v1/symptom-logs')
      .set(AUTH)

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'Query parameter familyMemberId is required' })
    expect(mockSymptomLogFindMany).not.toHaveBeenCalled()
  })

  test('applies from and to filters', async () => {
    const res = await request
      .get('/api/v1/symptom-logs')
      .set(AUTH)
      .query({
        familyMemberId: MEMBER_ID,
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-30T23:59:59.000Z',
      })

    expect(res.status).toBe(200)
    expect(mockSymptomLogFindMany).toHaveBeenCalledWith({
      where: {
        familyMemberId: MEMBER_ID,
        loggedAt: {
          gte: new Date('2026-04-01T00:00:00.000Z'),
          lte: new Date('2026-04-30T23:59:59.000Z'),
        },
      },
      orderBy: { loggedAt: 'desc' },
      take: 50,
    })
  })

  test('treats empty from and to strings as absent', async () => {
    const res = await request
      .get('/api/v1/symptom-logs')
      .set(AUTH)
      .query({
        familyMemberId: MEMBER_ID,
        from: '',
        to: '',
      })

    expect(res.status).toBe(200)
    expect(mockSymptomLogFindMany).toHaveBeenCalledWith({
      where: { familyMemberId: MEMBER_ID },
      orderBy: { loggedAt: 'desc' },
      take: 50,
    })
  })

  test('returns 400 when from is after to', async () => {
    const res = await request
      .get('/api/v1/symptom-logs')
      .set(AUTH)
      .query({
        familyMemberId: MEMBER_ID,
        from: '2026-05-01T00:00:00.000Z',
        to: '2026-04-01T00:00:00.000Z',
      })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'from must be less than or equal to to' })
    expect(mockSymptomLogFindMany).not.toHaveBeenCalled()
  })

  test('returns 400 when from is invalid', async () => {
    const res = await request
      .get('/api/v1/symptom-logs')
      .set(AUTH)
      .query({
        familyMemberId: MEMBER_ID,
        from: 'not-a-date',
      })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'BAD_REQUEST', error: 'from must be a valid ISO date' })
    expect(mockSymptomLogFindMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/symptom-logs/:id', () => {
  test('returns a single symptom log', async () => {
    const res = await request
      .get(`/api/v1/symptom-logs/${LOG_ID}`)
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(LOG_ID)
    expect(res.body.data).toHaveProperty('loggedAt')
  })

  test('returns 404 when the symptom log is missing', async () => {
    mockSymptomLogFindUnique.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/symptom-logs/${LOG_ID}`)
      .set(AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ code: 'NOT_FOUND', error: 'Symptom log not found' })
  })
})

describe('PATCH /api/v1/symptom-logs/:id', () => {
  test('updates severity', async () => {
    const res = await request
      .patch(`/api/v1/symptom-logs/${LOG_ID}`)
      .set(AUTH)
      .send({ severity: 8 })

    expect(res.status).toBe(200)
    expect(res.body.data.severity).toBe(8)
    expect(mockSymptomLogUpdate).toHaveBeenCalledWith({
      where: { id: LOG_ID },
      data: { severity: 8 },
    })
  })

  test('updates photoUrl and voiceNoteUrl fields', async () => {
    const res = await request
      .patch(`/api/v1/symptom-logs/${LOG_ID}`)
      .set(AUTH)
      .send({
        photoUrl: 'https://example.com/photo.jpg',
        voiceNoteUrl: 'https://example.com/note.m4a',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.photoUrl).toBe('https://example.com/photo.jpg')
    expect(res.body.data.voiceNoteUrl).toBe('https://example.com/note.m4a')
    expect(mockSymptomLogUpdate).toHaveBeenCalledWith({
      where: { id: LOG_ID },
      data: {
        photoUrl: 'https://example.com/photo.jpg',
        voiceNoteUrl: 'https://example.com/note.m4a',
      },
    })
  })
})

describe('DELETE /api/v1/symptom-logs/:id', () => {
  test('deletes a symptom log', async () => {
    const res = await request
      .delete(`/api/v1/symptom-logs/${LOG_ID}`)
      .set(AUTH)

    expect(res.status).toBe(204)
    expect(mockSymptomLogDelete).toHaveBeenCalledWith({ where: { id: LOG_ID } })
  })
})

describe('POST /api/v1/symptom-logs/:id/photo', () => {
  test('uploads a photo and stores photoUrl', async () => {
    mockUploadBuffer.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/famcare/symptom-logs/mem_xyz/photos/rash.jpg',
      public_id: 'famcare/symptom-logs/mem_xyz/photos/rash',
    })

    const res = await request
      .post(`/api/v1/symptom-logs/${LOG_ID}/photo`)
      .set(AUTH)
      .attach('file', Buffer.from('image-bytes'), { filename: 'rash.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({
      id: LOG_ID,
      photoUrl: 'https://res.cloudinary.com/demo/image/upload/v1/famcare/symptom-logs/mem_xyz/photos/rash.jpg',
    })
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        folder: 'famcare/symptom-logs/mem_xyz/photos',
        resourceType: 'image',
        originalname: 'rash.jpg',
      })
    )
    expect(mockSymptomLogUpdate).toHaveBeenCalledWith({
      where: { id: LOG_ID },
      data: {
        photoUrl: 'https://res.cloudinary.com/demo/image/upload/v1/famcare/symptom-logs/mem_xyz/photos/rash.jpg',
      },
    })
  })

  test('returns 404 when uploading photo to a missing log', async () => {
    mockSymptomLogFindUnique.mockResolvedValue(null)

    const res = await request
      .post(`/api/v1/symptom-logs/${LOG_ID}/photo`)
      .set(AUTH)
      .attach('file', Buffer.from('image-bytes'), { filename: 'rash.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ code: 'NOT_FOUND', error: 'Symptom log not found' })
    expect(mockUploadBuffer).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/symptom-logs/:id/voice-note', () => {
  test('uploads a voice note and stores voiceNoteUrl', async () => {
    mockUploadBuffer.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/demo/raw/upload/v1/famcare/symptom-logs/mem_xyz/voice-notes/headache.m4a',
      public_id: 'famcare/symptom-logs/mem_xyz/voice-notes/headache',
    })

    const res = await request
      .post(`/api/v1/symptom-logs/${LOG_ID}/voice-note`)
      .set(AUTH)
      .attach('file', Buffer.from('audio-bytes'), { filename: 'headache.m4a', contentType: 'audio/x-m4a' })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({
      id: LOG_ID,
      voiceNoteUrl: 'https://res.cloudinary.com/demo/raw/upload/v1/famcare/symptom-logs/mem_xyz/voice-notes/headache.m4a',
    })
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        folder: 'famcare/symptom-logs/mem_xyz/voice-notes',
        resourceType: 'raw',
        originalname: 'headache.m4a',
      })
    )
    expect(mockSymptomLogUpdate).toHaveBeenCalledWith({
      where: { id: LOG_ID },
      data: {
        voiceNoteUrl: 'https://res.cloudinary.com/demo/raw/upload/v1/famcare/symptom-logs/mem_xyz/voice-notes/headache.m4a',
      },
    })
  })
})

describe('authentication', () => {
  test('returns 401 when x-line-userid header is missing', async () => {
    const res = await request
      .get('/api/v1/symptom-logs')
      .query({ familyMemberId: MEMBER_ID })

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ code: 'UNAUTHORIZED', error: 'Missing x-line-userid header' })
    expect(mockFindOrCreate).not.toHaveBeenCalled()
  })
})
