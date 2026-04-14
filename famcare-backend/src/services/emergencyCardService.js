import { prisma } from '../lib/prisma.js'
import { assertCanReadMember } from './accessService.js'
import { toBangkokISO } from '../utils/datetime.js'

function notFound(message) {
  return Object.assign(new Error(message), { status: 404, code: 'NOT_FOUND' })
}

function formatContact(contact) {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone ?? null,
    relation: contact.relation ?? null,
    sortOrder: contact.sortOrder,
    createdAt: toBangkokISO(contact.createdAt),
    updatedAt: toBangkokISO(contact.updatedAt),
  }
}

function formatMedication(medication) {
  return {
    id: medication.id,
    name: medication.name,
    dosage: medication.dosage ?? null,
    frequency: medication.frequency ?? null,
  }
}

export async function getEmergencyCard(actorUserId, familyMemberId) {
  await assertCanReadMember(actorUserId, familyMemberId)

  const member = await prisma.familyMember.findFirst({
    where: {
      id: familyMemberId,
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

  if (!member) {
    throw notFound('Family member not found')
  }

  return {
    memberId: member.id,
    name: member.name,
    bloodType: member.bloodType ?? null,
    allergies: member.allergies ?? null,
    conditions: member.conditions ?? null,
    preferredHospital: member.preferredHospital ?? null,
    medications: member.medications.map(formatMedication),
    emergencyContacts: member.emergencyContacts.map(formatContact),
  }
}
