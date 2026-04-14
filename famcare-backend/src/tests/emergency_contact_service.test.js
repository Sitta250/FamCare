import { jest } from '@jest/globals'

const mockFindMany = jest.fn()
const mockCreate = jest.fn()
const mockFindFirst = jest.fn()
const mockUpdate = jest.fn()
const mockDelete = jest.fn()
const mockAssertCanReadMember = jest.fn()
const mockAssertCanWriteMember = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    emergencyContact: {
      findMany: mockFindMany,
      create: mockCreate,
      findFirst: mockFindFirst,
      update: mockUpdate,
      delete: mockDelete,
    },
  },
}))

jest.unstable_mockModule('../services/accessService.js', () => ({
  assertCanReadMember: mockAssertCanReadMember,
  assertCanWriteMember: mockAssertCanWriteMember,
}))

const {
  listEmergencyContacts,
  createEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
} = await import('../services/emergencyContactService.js')

const ACTOR_USER_ID = 'usr_123'
const MEMBER_ID = 'mem_123'
const CONTACT_ID = 'contact_123'

function fakeContact(overrides = {}) {
  return {
    id: CONTACT_ID,
    familyMemberId: MEMBER_ID,
    name: 'Napa Jaidee',
    phone: '0812345678',
    relation: 'Daughter',
    sortOrder: 0,
    createdAt: new Date('2026-04-14T10:00:00Z'),
    updatedAt: new Date('2026-04-14T11:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockAssertCanWriteMember.mockResolvedValue('OWNER')
  mockFindMany.mockResolvedValue([fakeContact()])
  mockCreate.mockImplementation(async ({ data }) => fakeContact(data))
  mockFindFirst.mockResolvedValue(fakeContact())
  mockUpdate.mockImplementation(async ({ where, data }) => fakeContact({ id: where.id, ...data }))
  mockDelete.mockResolvedValue(fakeContact())
})

describe('emergencyContactService', () => {
  test('lists emergency contacts ordered by sortOrder then createdAt', async () => {
    const result = await listEmergencyContacts(ACTOR_USER_ID, MEMBER_ID)

    expect(mockAssertCanReadMember).toHaveBeenCalledWith(ACTOR_USER_ID, MEMBER_ID)
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { familyMemberId: MEMBER_ID },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    expect(result[0]).toMatchObject({
      id: CONTACT_ID,
      createdAt: '2026-04-14T17:00:00.000+07:00',
      updatedAt: '2026-04-14T18:00:00.000+07:00',
    })
  })

  test('creates a contact with trimmed name and default sortOrder', async () => {
    const result = await createEmergencyContact(ACTOR_USER_ID, MEMBER_ID, {
      name: '  Napa Jaidee  ',
      phone: '0812345678',
      relation: 'Daughter',
    })

    expect(mockAssertCanWriteMember).toHaveBeenCalledWith(ACTOR_USER_ID, MEMBER_ID)
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        familyMemberId: MEMBER_ID,
        name: 'Napa Jaidee',
        phone: '0812345678',
        relation: 'Daughter',
        sortOrder: 0,
      },
    })
    expect(result.name).toBe('Napa Jaidee')
  })

  test('returns 400 when create name is missing', async () => {
    await expect(createEmergencyContact(ACTOR_USER_ID, MEMBER_ID, {})).rejects.toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
      message: 'name is required',
    })

    expect(mockCreate).not.toHaveBeenCalled()
  })

  test('returns 400 when update name is empty', async () => {
    await expect(updateEmergencyContact(ACTOR_USER_ID, MEMBER_ID, CONTACT_ID, { name: '   ' })).rejects.toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
      message: 'name is required',
    })

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: CONTACT_ID, familyMemberId: MEMBER_ID },
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test('returns 404 when updating a contact outside the member scope', async () => {
    mockFindFirst.mockResolvedValue(null)

    await expect(updateEmergencyContact(ACTOR_USER_ID, MEMBER_ID, CONTACT_ID, { relation: 'Sister' })).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Emergency contact not found',
    })

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test('returns 404 when deleting a contact outside the member scope', async () => {
    mockFindFirst.mockResolvedValue(null)

    await expect(deleteEmergencyContact(ACTOR_USER_ID, MEMBER_ID, CONTACT_ID)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Emergency contact not found',
    })

    expect(mockDelete).not.toHaveBeenCalled()
  })
})
