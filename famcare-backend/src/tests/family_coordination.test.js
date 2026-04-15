import { jest } from '@jest/globals'

const mockFamilyMemberFindUnique = jest.fn()
const mockFamilyAccessFindUnique = jest.fn()
const mockFamilyAccessUpsert = jest.fn()
const mockFamilyAccessFindMany = jest.fn()
const mockFamilyAccessUpdateMany = jest.fn()
const mockFamilyAccessFindFirst = jest.fn()
const mockFamilyAccessDeleteMany = jest.fn()
const mockReminderFindMany = jest.fn()
const mockReminderUpdateMany = jest.fn()
const mockFindOrCreateByLineUserId = jest.fn()
const mockSendLinePushToUser = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    familyMember: {
      findUnique: mockFamilyMemberFindUnique,
    },
    familyAccess: {
      findUnique: mockFamilyAccessFindUnique,
      upsert: mockFamilyAccessUpsert,
      findMany: mockFamilyAccessFindMany,
      updateMany: mockFamilyAccessUpdateMany,
      findFirst: mockFamilyAccessFindFirst,
      deleteMany: mockFamilyAccessDeleteMany,
    },
    reminder: {
      findMany: mockReminderFindMany,
      updateMany: mockReminderUpdateMany,
    },
  },
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: mockFindOrCreateByLineUserId,
}))

jest.unstable_mockModule('../services/linePushService.js', () => ({
  sendLinePushToUser: mockSendLinePushToUser,
}))

const {
  assertCanReadMember,
  assertCanWriteMember,
  getAccessRoleForMember,
} = await import('../services/accessService.js')

const {
  grantAccess,
  listAccessForMember,
  parseNotificationPrefs,
  revokeAccess,
  updateNotificationPrefs,
} = await import('../services/familyAccessService.js')

const { dispatchDueReminders } = await import('../services/reminderDispatchService.js')

const OWNER_ID = 'owner-1'
const MEMBER_ID = 'member-1'
const INVITEE_ID = 'invitee-1'
const INVITEE_LINE_ID = 'U_invitee'
const OWNER_LINE_ID = 'U_owner'
const REMINDER_ID = 'reminder-1'
const APPOINTMENT_ID = 'appt-1'

function prefs(overrides = {}) {
  return {
    appointmentReminders: true,
    medicationReminders: true,
    missedDoseAlerts: true,
    ...overrides,
  }
}

function accessRecord(overrides = {}) {
  return {
    id: 'access-1',
    grantedByUserId: OWNER_ID,
    grantedToUserId: INVITEE_ID,
    familyMemberId: MEMBER_ID,
    role: 'CAREGIVER',
    notificationPrefs: JSON.stringify(prefs()),
    grantedTo: {
      id: INVITEE_ID,
      lineUserId: INVITEE_LINE_ID,
      displayName: 'Invitee',
    },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

function reminderRecord(overrides = {}) {
  return {
    id: REMINDER_ID,
    appointmentId: APPOINTMENT_ID,
    type: 'SEVEN_DAYS',
    scheduledAt: new Date(Date.now() - 60_000),
    sent: false,
    appointment: {
      id: APPOINTMENT_ID,
      title: 'Checkup',
      appointmentAt: new Date(Date.now() + 60 * 60 * 1000),
      hospital: 'City Hospital',
      status: 'UPCOMING',
      familyMember: {
        id: MEMBER_ID,
        name: 'Grandma',
        owner: { id: OWNER_ID, lineUserId: OWNER_LINE_ID },
        accessList: [],
      },
    },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFamilyMemberFindUnique.mockResolvedValue({ ownerId: OWNER_ID })
  mockFamilyAccessFindUnique.mockResolvedValue(null)
  mockFamilyAccessUpsert.mockResolvedValue(accessRecord())
  mockFamilyAccessFindMany.mockResolvedValue([accessRecord()])
  mockFamilyAccessUpdateMany.mockResolvedValue({ count: 1 })
  mockFamilyAccessFindFirst.mockResolvedValue(accessRecord())
  mockFamilyAccessDeleteMany.mockResolvedValue({ count: 1 })
  mockReminderFindMany.mockResolvedValue([])
  mockReminderUpdateMany.mockResolvedValue({ count: 1 })
  mockFindOrCreateByLineUserId.mockResolvedValue({
    id: INVITEE_ID,
    lineUserId: INVITEE_LINE_ID,
    displayName: 'Invitee',
  })
  mockSendLinePushToUser.mockResolvedValue(undefined)
})

describe('parseNotificationPrefs', () => {
  test('returns all-enabled defaults for null', () => {
    expect(parseNotificationPrefs(null)).toEqual(prefs())
  })

  test('fills missing keys with true', () => {
    expect(parseNotificationPrefs(JSON.stringify({ medicationReminders: false }))).toEqual(
      prefs({ medicationReminders: false })
    )
  })

  test('falls back to defaults for invalid JSON', () => {
    expect(parseNotificationPrefs('{bad json')).toEqual(prefs())
  })
})

describe('grantAccess roles', () => {
  test('grant CAREGIVER returns CAREGIVER and grantee can read and write', async () => {
    mockFamilyAccessUpsert.mockResolvedValue(accessRecord({ role: 'CAREGIVER' }))

    const result = await grantAccess(OWNER_ID, MEMBER_ID, {
      grantedToLineUserId: INVITEE_LINE_ID,
      role: 'CAREGIVER',
    })

    expect(result.role).toBe('CAREGIVER')
    expect(mockFamilyAccessUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { role: 'CAREGIVER' },
        create: expect.objectContaining({ role: 'CAREGIVER' }),
      })
    )

    mockFamilyAccessFindUnique.mockResolvedValue({ role: 'CAREGIVER' })

    await expect(assertCanReadMember(INVITEE_ID, MEMBER_ID)).resolves.toBe('CAREGIVER')
    await expect(assertCanWriteMember(INVITEE_ID, MEMBER_ID)).resolves.toBe('CAREGIVER')
  })

  test('grant VIEWER returns VIEWER and grantee cannot write', async () => {
    mockFamilyAccessUpsert.mockResolvedValue(accessRecord({ role: 'VIEWER' }))

    const result = await grantAccess(OWNER_ID, MEMBER_ID, {
      grantedToLineUserId: INVITEE_LINE_ID,
      role: 'VIEWER',
    })

    expect(result.role).toBe('VIEWER')

    mockFamilyAccessFindUnique.mockResolvedValue({ role: 'VIEWER' })

    await expect(assertCanReadMember(INVITEE_ID, MEMBER_ID)).resolves.toBe('VIEWER')
    await expect(assertCanWriteMember(INVITEE_ID, MEMBER_ID)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  test('stores notificationPrefs as JSON on create and preserves them on update when omitted', async () => {
    mockFamilyAccessUpsert.mockResolvedValue(
      accessRecord({
        notificationPrefs: JSON.stringify(prefs({ medicationReminders: false })),
      })
    )

    const result = await grantAccess(OWNER_ID, MEMBER_ID, {
      grantedToLineUserId: INVITEE_LINE_ID,
      role: 'CAREGIVER',
      notificationPrefs: prefs({ medicationReminders: false }),
    })

    expect(result.notificationPrefs).toEqual(prefs({ medicationReminders: false }))
    expect(mockFamilyAccessUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          role: 'CAREGIVER',
          notificationPrefs: JSON.stringify(prefs({ medicationReminders: false })),
        },
        create: expect.objectContaining({
          notificationPrefs: JSON.stringify(prefs({ medicationReminders: false })),
        }),
      })
    )

    await grantAccess(OWNER_ID, MEMBER_ID, {
      grantedToLineUserId: INVITEE_LINE_ID,
      role: 'VIEWER',
    })

    expect(mockFamilyAccessUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: { role: 'VIEWER' },
      })
    )
  })
})

describe('access lifecycle', () => {
  test('revokeAccess succeeds when grant exists', async () => {
    await expect(revokeAccess(OWNER_ID, MEMBER_ID, INVITEE_ID)).resolves.toBeUndefined()
    expect(mockFamilyAccessDeleteMany).toHaveBeenCalledWith({
      where: { familyMemberId: MEMBER_ID, grantedToUserId: INVITEE_ID },
    })
  })

  test('revokeAccess throws 404 when grant does not exist', async () => {
    mockFamilyAccessDeleteMany.mockResolvedValue({ count: 0 })

    await expect(revokeAccess(OWNER_ID, MEMBER_ID, INVITEE_ID)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  test('listAccessForMember returns parsed notificationPrefs objects instead of raw strings', async () => {
    mockFamilyAccessFindMany.mockResolvedValue([
      accessRecord({
        id: 'access-1',
        notificationPrefs: JSON.stringify(prefs({ medicationReminders: false })),
      }),
      accessRecord({
        id: 'access-2',
        grantedToUserId: 'invitee-2',
        notificationPrefs: null,
        grantedTo: {
          id: 'invitee-2',
          lineUserId: 'U_invitee_2',
          displayName: 'Invitee 2',
        },
      }),
      accessRecord({
        id: 'access-3',
        grantedToUserId: 'invitee-3',
        notificationPrefs: '{bad json',
        grantedTo: {
          id: 'invitee-3',
          lineUserId: 'U_invitee_3',
          displayName: 'Invitee 3',
        },
      }),
    ])

    const result = await listAccessForMember(OWNER_ID, MEMBER_ID)

    expect(result[0].notificationPrefs).toEqual(prefs({ medicationReminders: false }))
    expect(result[1].notificationPrefs).toEqual(prefs())
    expect(result[2].notificationPrefs).toEqual(prefs())
  })

  test('updateNotificationPrefs updates prefs and returns parsed record', async () => {
    mockFamilyAccessFindFirst.mockResolvedValue(
      accessRecord({
        notificationPrefs: JSON.stringify(prefs({ appointmentReminders: false })),
      })
    )

    const result = await updateNotificationPrefs(
      OWNER_ID,
      MEMBER_ID,
      INVITEE_ID,
      prefs({ appointmentReminders: false })
    )

    expect(mockFamilyAccessUpdateMany).toHaveBeenCalledWith({
      where: { familyMemberId: MEMBER_ID, grantedToUserId: INVITEE_ID },
      data: { notificationPrefs: JSON.stringify(prefs({ appointmentReminders: false })) },
    })
    expect(result.notificationPrefs).toEqual(prefs({ appointmentReminders: false }))
  })

  test('updateNotificationPrefs throws 404 when grant does not exist', async () => {
    mockFamilyAccessUpdateMany.mockResolvedValue({ count: 0 })

    await expect(
      updateNotificationPrefs(OWNER_ID, MEMBER_ID, INVITEE_ID, prefs({ missedDoseAlerts: false }))
    ).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })
})

describe('dispatchDueReminders notification filtering', () => {
  test('caregiver with appointmentReminders:false does not receive push', async () => {
    mockReminderFindMany.mockResolvedValue([
      reminderRecord({
        appointment: {
          id: APPOINTMENT_ID,
          title: 'Checkup',
          appointmentAt: new Date(Date.now() + 60 * 60 * 1000),
          hospital: 'City Hospital',
          status: 'UPCOMING',
          familyMember: {
            id: MEMBER_ID,
            name: 'Grandma',
            owner: { id: OWNER_ID, lineUserId: OWNER_LINE_ID },
            accessList: [
              {
                notificationPrefs: JSON.stringify(prefs({ appointmentReminders: false })),
                grantedTo: { id: INVITEE_ID, lineUserId: INVITEE_LINE_ID },
              },
            ],
          },
        },
      }),
    ])

    await dispatchDueReminders()

    expect(mockSendLinePushToUser).toHaveBeenCalledTimes(1)
    expect(mockSendLinePushToUser).toHaveBeenCalledWith(
      OWNER_LINE_ID,
      expect.stringContaining('Checkup')
    )
    expect(mockSendLinePushToUser).not.toHaveBeenCalledWith(
      INVITEE_LINE_ID,
      expect.any(String)
    )
  })

  test('caregiver with null notificationPrefs still receives push', async () => {
    mockReminderFindMany.mockResolvedValue([
      reminderRecord({
        appointment: {
          id: APPOINTMENT_ID,
          title: 'Checkup',
          appointmentAt: new Date(Date.now() + 60 * 60 * 1000),
          hospital: 'City Hospital',
          status: 'UPCOMING',
          familyMember: {
            id: MEMBER_ID,
            name: 'Grandma',
            owner: { id: OWNER_ID, lineUserId: OWNER_LINE_ID },
            accessList: [
              {
                notificationPrefs: null,
                grantedTo: { id: INVITEE_ID, lineUserId: INVITEE_LINE_ID },
              },
            ],
          },
        },
      }),
    ])

    await dispatchDueReminders()

    expect(mockSendLinePushToUser).toHaveBeenCalledTimes(2)
    expect(mockSendLinePushToUser).toHaveBeenCalledWith(
      OWNER_LINE_ID,
      expect.stringContaining('Checkup')
    )
    expect(mockSendLinePushToUser).toHaveBeenCalledWith(
      INVITEE_LINE_ID,
      expect.stringContaining('Checkup')
    )
  })
})

describe('owner access is always retained', () => {
  test('getAccessRoleForMember returns OWNER for the member owner without FamilyAccess lookup', async () => {
    const role = await getAccessRoleForMember(OWNER_ID, MEMBER_ID)

    expect(role).toBe('OWNER')
    expect(mockFamilyAccessFindUnique).not.toHaveBeenCalled()
  })

  test('assertCanReadMember does not throw for the owner even with no access rows', async () => {
    await expect(assertCanReadMember(OWNER_ID, MEMBER_ID)).resolves.toBe('OWNER')
  })

  test('dispatchDueReminders always sends to owner even if accessList is empty', async () => {
    mockReminderFindMany.mockResolvedValue([reminderRecord()])

    await dispatchDueReminders()

    expect(mockSendLinePushToUser).toHaveBeenCalledTimes(1)
    expect(mockSendLinePushToUser).toHaveBeenCalledWith(
      OWNER_LINE_ID,
      expect.stringContaining('Checkup')
    )
  })
})
