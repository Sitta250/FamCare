import { jest } from '@jest/globals'

// ── Mock function handles (declared before module registration) ───────────────
const mockFamilyMemberCreate   = jest.fn()
const mockFamilyMemberFindMany = jest.fn()
const mockFamilyMemberFindUnique = jest.fn()
const mockFamilyMemberUpdate   = jest.fn()
const mockFamilyMemberDelete   = jest.fn()
const mockFamilyAccessFindMany = jest.fn()
const mockFamilyAccessFindUnique = jest.fn()

const mockAssertCanReadMember    = jest.fn()
const mockAssertCanWriteMember   = jest.fn()
const mockGetAccessRoleForMember = jest.fn()
const mockAssertOwnerForMember   = jest.fn()

const mockFindOrCreateByLineUserId = jest.fn()
const mockGrantAccess = jest.fn()
const mockListAccessForMember = jest.fn()
const mockRevokeAccess = jest.fn()
const mockUpdateNotificationPrefs = jest.fn()

// ── Register module mocks before any dynamic imports ─────────────────────────
jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    familyMember: {
      create:     mockFamilyMemberCreate,
      findMany:   mockFamilyMemberFindMany,
      findUnique: mockFamilyMemberFindUnique,
      update:     mockFamilyMemberUpdate,
      delete:     mockFamilyMemberDelete,
    },
    familyAccess: {
      findMany:   mockFamilyAccessFindMany,
      findUnique: mockFamilyAccessFindUnique,
    },
    user: { upsert: jest.fn() },
  },
}))

jest.unstable_mockModule('../services/accessService.js', () => ({
  assertCanReadMember:    mockAssertCanReadMember,
  assertCanWriteMember:   mockAssertCanWriteMember,
  getAccessRoleForMember: mockGetAccessRoleForMember,
  assertOwnerForMember:   mockAssertOwnerForMember,
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreateByLineUserId,
}))

jest.unstable_mockModule('../services/familyAccessService.js', () => ({
  grantAccess: mockGrantAccess,
  listAccessForMember: mockListAccessForMember,
  revokeAccess: mockRevokeAccess,
  updateNotificationPrefs: mockUpdateNotificationPrefs,
}))

// ── Dynamic imports (must come after mock registration) ───────────────────────
const { default: express }            = await import('express')
const { default: supertest }          = await import('supertest')
const { default: familyMembersRouter } = await import('../routes/familyMembers.js')
const { errorHandler }                = await import('../middleware/errorHandler.js')

// ── Minimal test app ──────────────────────────────────────────────────────────
const app = express()
app.use(express.json())
app.use('/api/v1/family-members', familyMembersRouter)
app.use(errorHandler)

const request = supertest(app)

// ── Test fixtures ─────────────────────────────────────────────────────────────
const USER_ID    = 'user-1'
const LINE_ID    = 'U_test_123'
const MEMBER_ID  = 'member-abc'
const AUTH       = { 'x-line-userid': LINE_ID }

function fakeMember(overrides = {}) {
  return {
    id:                     MEMBER_ID,
    ownerId:                USER_ID,
    addedById:              USER_ID,
    name:                   'Grandma',
    relation:               'grandmother',
    dateOfBirth:            null,
    bloodType:              'O+',
    allergies:              'peanuts',
    conditions:             null,
    photoUrl:               null,
    preferredHospital:      null,
    missedDoseAlertsEnabled: true,
    isDeleted:              false,
    createdAt:              new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

function fakeAccess(overrides = {}) {
  return {
    id: 'access-1',
    grantedByUserId: USER_ID,
    grantedToUserId: 'user-2',
    familyMemberId: MEMBER_ID,
    role: 'CAREGIVER',
    notificationPrefs: {
      appointmentReminders: true,
      medicationReminders: true,
      missedDoseAlerts: true,
    },
    grantedTo: {
      id: 'user-2',
      lineUserId: 'U_invitee_123',
      displayName: 'Helper',
    },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

// ── Reset & restore defaults before each test ─────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreateByLineUserId.mockResolvedValue({ id: USER_ID, lineUserId: LINE_ID, displayName: 'Test' })
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockGetAccessRoleForMember.mockResolvedValue('OWNER')
  mockAssertOwnerForMember.mockResolvedValue(undefined)
  mockGrantAccess.mockResolvedValue(fakeAccess())
  mockListAccessForMember.mockResolvedValue([fakeAccess()])
  mockRevokeAccess.mockResolvedValue(undefined)
  mockUpdateNotificationPrefs.mockResolvedValue(fakeAccess())
})

// ── POST /api/v1/family-members ───────────────────────────────────────────────
describe('POST /api/v1/family-members', () => {
  test('with all fields → 201 and member returned', async () => {
    mockFamilyMemberCreate.mockResolvedValue(fakeMember())

    const res = await request
      .post('/api/v1/family-members')
      .set(AUTH)
      .send({ name: 'Grandma', relation: 'grandmother', bloodType: 'O+', allergies: 'peanuts' })

    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Grandma')
    expect(res.body.data.bloodType).toBe('O+')
  })

  test('missing required name → 400', async () => {
    const res = await request
      .post('/api/v1/family-members')
      .set(AUTH)
      .send({ relation: 'grandmother' })

    expect(res.status).toBe(400)
  })
})

// ── GET /api/v1/family-members ────────────────────────────────────────────────
describe('GET /api/v1/family-members', () => {
  test('returns only members owned by the requesting user', async () => {
    mockFamilyMemberFindMany.mockResolvedValue([fakeMember()])
    mockFamilyAccessFindMany.mockResolvedValue([])

    const res = await request.get('/api/v1/family-members').set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe(MEMBER_ID)

    // Prisma must be called with the requesting user's ownerId
    expect(mockFamilyMemberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: USER_ID }),
      })
    )
  })
})

// ── PATCH /api/v1/family-members/:id ─────────────────────────────────────────
describe('PATCH /api/v1/family-members/:id', () => {
  test('updates only sent fields, others unchanged', async () => {
    mockFamilyMemberUpdate.mockResolvedValue(fakeMember({ bloodType: 'A+' }))

    const res = await request
      .patch(`/api/v1/family-members/${MEMBER_ID}`)
      .set(AUTH)
      .send({ bloodType: 'A+' })

    expect(res.status).toBe(200)
    expect(res.body.data.bloodType).toBe('A+')
    expect(res.body.data.name).toBe('Grandma') // unchanged

    // Only the sent field should be in the update payload
    const updateArg = mockFamilyMemberUpdate.mock.calls[0][0]
    expect(updateArg.data).toHaveProperty('bloodType', 'A+')
    expect(updateArg.data).not.toHaveProperty('name')
    expect(updateArg.data).not.toHaveProperty('relation')
  })
})

// ── DELETE /api/v1/family-members/:id ────────────────────────────────────────
describe('DELETE /api/v1/family-members/:id', () => {
  test('soft-deletes; subsequent GET excludes it', async () => {
    mockFamilyMemberUpdate.mockResolvedValue(fakeMember({ isDeleted: true }))

    const deleteRes = await request
      .delete(`/api/v1/family-members/${MEMBER_ID}`)
      .set(AUTH)

    expect(deleteRes.status).toBe(204)

    // Must be a soft delete (update), not a hard delete
    expect(mockFamilyMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MEMBER_ID },
        data:  { isDeleted: true },
      })
    )
    expect(mockFamilyMemberDelete).not.toHaveBeenCalled()

    // Subsequent GET: service filters isDeleted=false so soft-deleted member is excluded
    mockFamilyMemberFindMany.mockResolvedValue([])
    mockFamilyAccessFindMany.mockResolvedValue([])

    const listRes = await request.get('/api/v1/family-members').set(AUTH)
    expect(listRes.status).toBe(200)
    expect(listRes.body.data).toHaveLength(0)
  })
})

describe('Family access routes', () => {
  test('POST /api/v1/family-members/:memberId/access forwards notificationPrefs and returns 201', async () => {
    const notificationPrefs = {
      appointmentReminders: false,
      medicationReminders: true,
      missedDoseAlerts: false,
    }

    mockGrantAccess.mockResolvedValue(fakeAccess({ notificationPrefs }))

    const res = await request
      .post(`/api/v1/family-members/${MEMBER_ID}/access`)
      .set(AUTH)
      .send({
        grantedToLineUserId: 'U_invitee_123',
        role: 'CAREGIVER',
        notificationPrefs,
      })

    expect(res.status).toBe(201)
    expect(mockGrantAccess).toHaveBeenCalledWith(USER_ID, MEMBER_ID, {
      grantedToLineUserId: 'U_invitee_123',
      role: 'CAREGIVER',
      notificationPrefs,
    })
    expect(res.body.data.notificationPrefs).toEqual(notificationPrefs)
  })

  test('PATCH /api/v1/family-members/:memberId/access/:grantedToUserId returns updated record', async () => {
    const notificationPrefs = {
      appointmentReminders: true,
      medicationReminders: false,
      missedDoseAlerts: true,
    }

    mockUpdateNotificationPrefs.mockResolvedValue(fakeAccess({ notificationPrefs }))

    const res = await request
      .patch(`/api/v1/family-members/${MEMBER_ID}/access/user-2`)
      .set(AUTH)
      .send({ notificationPrefs })

    expect(res.status).toBe(200)
    expect(mockUpdateNotificationPrefs).toHaveBeenCalledWith(
      USER_ID,
      MEMBER_ID,
      'user-2',
      notificationPrefs
    )
    expect(res.body.data.notificationPrefs).toEqual(notificationPrefs)
  })

  test('PATCH /api/v1/family-members/:memberId/access/:grantedToUserId returns 404 when grant is missing', async () => {
    mockUpdateNotificationPrefs.mockRejectedValue(
      Object.assign(new Error('Access grant not found'), { status: 404, code: 'NOT_FOUND' })
    )

    const res = await request
      .patch(`/api/v1/family-members/${MEMBER_ID}/access/missing-user`)
      .set(AUTH)
      .send({
        notificationPrefs: {
          appointmentReminders: true,
          medicationReminders: true,
          missedDoseAlerts: false,
        },
      })

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  test('PATCH /api/v1/family-members/:memberId/access/:grantedToUserId returns 403 for non-owner', async () => {
    mockUpdateNotificationPrefs.mockRejectedValue(
      Object.assign(new Error('Only the owner can manage access'), { status: 403, code: 'FORBIDDEN' })
    )

    const res = await request
      .patch(`/api/v1/family-members/${MEMBER_ID}/access/user-2`)
      .set(AUTH)
      .send({
        notificationPrefs: {
          appointmentReminders: true,
          medicationReminders: false,
          missedDoseAlerts: true,
        },
      })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })
})
