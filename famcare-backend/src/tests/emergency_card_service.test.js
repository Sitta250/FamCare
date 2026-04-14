import { jest } from '@jest/globals'

const mockFindFirst = jest.fn()
const mockAssertCanReadMember = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    familyMember: {
      findFirst: mockFindFirst,
    },
  },
}))

jest.unstable_mockModule('../services/accessService.js', () => ({
  assertCanReadMember: mockAssertCanReadMember,
}))

const { getEmergencyCard } = await import('../services/emergencyCardService.js')

const ACTOR_USER_ID = 'usr_123'
const MEMBER_ID = 'mem_123'

function fakeMember(overrides = {}) {
  return {
    id: MEMBER_ID,
    name: 'Somchai Jaidee',
    bloodType: 'O+',
    allergies: 'Penicillin',
    conditions: 'Hypertension',
    preferredHospital: 'Bangkok Hospital',
    medications: [
      {
        id: 'med_1',
        name: 'Metformin',
        dosage: '500mg',
        frequency: '2x daily',
      },
    ],
    emergencyContacts: [
      {
        id: 'contact_1',
        name: 'Napa Jaidee',
        phone: '0812345678',
        relation: 'Daughter',
        sortOrder: 0,
        createdAt: new Date('2026-04-14T10:00:00Z'),
        updatedAt: new Date('2026-04-14T11:00:00Z'),
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAssertCanReadMember.mockResolvedValue('OWNER')
  mockFindFirst.mockResolvedValue(fakeMember())
})

describe('emergencyCardService', () => {
  test('returns the emergency card payload with active medications and contacts', async () => {
    const result = await getEmergencyCard(ACTOR_USER_ID, MEMBER_ID)

    expect(mockAssertCanReadMember).toHaveBeenCalledWith(ACTOR_USER_ID, MEMBER_ID)
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        id: MEMBER_ID,
        isDeleted: false,
      },
      include: {
        medications: {
          where: { active: true },
          select: {
            id: true,
            name: true,
            dosage: true,
            frequency: true,
          },
        },
        emergencyContacts: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    })
    expect(result).toEqual({
      memberId: MEMBER_ID,
      name: 'Somchai Jaidee',
      bloodType: 'O+',
      allergies: 'Penicillin',
      conditions: 'Hypertension',
      preferredHospital: 'Bangkok Hospital',
      medications: [
        {
          id: 'med_1',
          name: 'Metformin',
          dosage: '500mg',
          frequency: '2x daily',
        },
      ],
      emergencyContacts: [
        {
          id: 'contact_1',
          name: 'Napa Jaidee',
          phone: '0812345678',
          relation: 'Daughter',
          sortOrder: 0,
          createdAt: '2026-04-14T17:00:00.000+07:00',
          updatedAt: '2026-04-14T18:00:00.000+07:00',
        },
      ],
    })
  })

  test('returns nullable member fields and empty arrays when no data exists', async () => {
    mockFindFirst.mockResolvedValue(fakeMember({
      bloodType: null,
      allergies: null,
      conditions: null,
      preferredHospital: null,
      medications: [],
      emergencyContacts: [],
    }))

    const result = await getEmergencyCard(ACTOR_USER_ID, MEMBER_ID)

    expect(result).toEqual({
      memberId: MEMBER_ID,
      name: 'Somchai Jaidee',
      bloodType: null,
      allergies: null,
      conditions: null,
      preferredHospital: null,
      medications: [],
      emergencyContacts: [],
    })
  })

  test('returns 404 when member is missing or soft-deleted', async () => {
    mockFindFirst.mockResolvedValue(null)

    await expect(getEmergencyCard(ACTOR_USER_ID, MEMBER_ID)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Family member not found',
    })
  })
})
