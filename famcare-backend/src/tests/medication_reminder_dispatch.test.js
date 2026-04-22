import { jest } from '@jest/globals'

const mockFamilyMemberFindUnique = jest.fn()
const mockMedicationScheduleFindMany = jest.fn()
const mockMedicationScheduleUpdate = jest.fn()
const mockMedicationLogFindFirst = jest.fn()
const mockSendLinePushToUser = jest.fn()

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    familyMember: {
      findUnique: mockFamilyMemberFindUnique,
    },
    medicationSchedule: {
      findMany: mockMedicationScheduleFindMany,
      update: mockMedicationScheduleUpdate,
    },
    medicationLog: {
      findFirst: mockMedicationLogFindFirst,
    },
  },
}))

jest.unstable_mockModule('../services/linePushService.js', () => ({
  sendLinePushToUser: mockSendLinePushToUser,
}))

const {
  dispatchMedicationReminders,
  getRecipients,
} = await import('../services/medicationReminderDispatchService.js')

const MEMBER_ID = 'member-1'
const OWNER_LINE_ID = 'U_owner'
const CAREGIVER_LINE_ID = 'U_caregiver'

function memberRecord(overrides = {}) {
  return {
    id: MEMBER_ID,
    missedDoseAlertsEnabled: true,
    owner: { lineUserId: OWNER_LINE_ID, chatMode: 'GROUP' },
    accessList: [
      {
        notificationPrefs: JSON.stringify({
          appointmentReminders: true,
          medicationReminders: true,
          missedDoseAlerts: true,
        }),
        grantedTo: { lineUserId: CAREGIVER_LINE_ID },
      },
    ],
    ...overrides,
  }
}

function medicationRecord(overrides = {}) {
  return {
    id: 'med-1',
    familyMemberId: MEMBER_ID,
    name: 'Aspirin',
    dosage: '1 pill',
    active: true,
    familyMember: {
      id: MEMBER_ID,
      name: 'Grandma',
    },
    ...overrides,
  }
}

function scheduleRecord(overrides = {}) {
  return {
    id: 'sched-1',
    timeLocal: '09:00',
    lastSentDate: null,
    lastMissedSentDate: null,
    medication: medicationRecord(),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockMedicationScheduleFindMany.mockResolvedValue([])
  mockMedicationScheduleUpdate.mockResolvedValue({})
  mockMedicationLogFindFirst.mockResolvedValue(null)
  mockSendLinePushToUser.mockResolvedValue(undefined)
})

describe('getRecipients', () => {
  test('returns only owner when owner chatMode is PRIVATE', async () => {
    mockFamilyMemberFindUnique.mockResolvedValue(
      memberRecord({
        owner: { lineUserId: OWNER_LINE_ID, chatMode: 'PRIVATE' },
      })
    )

    const result = await getRecipients(MEMBER_ID, 'medicationReminders')

    expect(result).toEqual({
      recipients: [OWNER_LINE_ID],
      missedAlertsEnabled: true,
    })
  })

  test('filters medication reminders by medicationReminders preference', async () => {
    mockFamilyMemberFindUnique.mockResolvedValue(
      memberRecord({
        accessList: [
          {
            notificationPrefs: JSON.stringify({
              medicationReminders: false,
              missedDoseAlerts: true,
            }),
            grantedTo: { lineUserId: CAREGIVER_LINE_ID },
          },
        ],
      })
    )

    const result = await getRecipients(MEMBER_ID, 'medicationReminders')

    expect(result).toEqual({
      recipients: [OWNER_LINE_ID],
      missedAlertsEnabled: true,
    })
  })

  test('filters missed dose alerts by missedDoseAlerts preference', async () => {
    mockFamilyMemberFindUnique.mockResolvedValue(
      memberRecord({
        accessList: [
          {
            notificationPrefs: JSON.stringify({
              medicationReminders: true,
              missedDoseAlerts: false,
            }),
            grantedTo: { lineUserId: CAREGIVER_LINE_ID },
          },
        ],
      })
    )

    const result = await getRecipients(MEMBER_ID, 'missedDoseAlerts')

    expect(result).toEqual({
      recipients: [OWNER_LINE_ID],
      missedAlertsEnabled: true,
    })
  })

  test('treats null prefs as all enabled and defaults eventType to medicationReminders', async () => {
    mockFamilyMemberFindUnique.mockResolvedValue(
      memberRecord({
        accessList: [
          {
            notificationPrefs: null,
            grantedTo: { lineUserId: CAREGIVER_LINE_ID },
          },
        ],
      })
    )

    const result = await getRecipients(MEMBER_ID)

    expect(result).toEqual({
      recipients: [OWNER_LINE_ID, CAREGIVER_LINE_ID],
      missedAlertsEnabled: true,
    })
  })
})

describe('dispatchMedicationReminders', () => {
  test('uses medicationReminders for reminder pass and missedDoseAlerts for missed-dose pass', async () => {
    mockMedicationScheduleFindMany
      .mockResolvedValueOnce([
        scheduleRecord({
          id: 'sched-reminder',
          medication: medicationRecord({ id: 'med-reminder' }),
        }),
      ])
      .mockResolvedValueOnce([
        scheduleRecord({
          id: 'sched-missed',
          medication: medicationRecord({ id: 'med-missed' }),
        }),
      ])

    mockFamilyMemberFindUnique
      .mockResolvedValueOnce(
        memberRecord({
          accessList: [
            {
              notificationPrefs: JSON.stringify({
                medicationReminders: false,
                missedDoseAlerts: true,
              }),
              grantedTo: { lineUserId: CAREGIVER_LINE_ID },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        memberRecord({
          accessList: [
            {
              notificationPrefs: JSON.stringify({
                medicationReminders: false,
                missedDoseAlerts: true,
              }),
              grantedTo: { lineUserId: CAREGIVER_LINE_ID },
            },
          ],
        })
      )

    await dispatchMedicationReminders()

    expect(mockSendLinePushToUser).toHaveBeenCalledWith(
      OWNER_LINE_ID,
      expect.stringContaining('เตือนกินยา')
    )
    expect(mockSendLinePushToUser).toHaveBeenCalledWith(
      OWNER_LINE_ID,
      expect.stringContaining('ยังไม่กินยา')
    )
    expect(mockSendLinePushToUser).toHaveBeenCalledWith(
      CAREGIVER_LINE_ID,
      expect.stringContaining('ยังไม่กินยา')
    )
    expect(mockSendLinePushToUser).not.toHaveBeenCalledWith(
      CAREGIVER_LINE_ID,
      expect.stringContaining('เตือนกินยา')
    )
  })
})
