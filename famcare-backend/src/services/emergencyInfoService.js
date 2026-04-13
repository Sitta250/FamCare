import { prisma } from '../lib/prisma.js'
import { assertCanReadMember } from './accessService.js'
import { toBangkokISO } from '../utils/datetime.js'

export async function getEmergencyInfo(actorUserId, familyMemberId) {
  await assertCanReadMember(actorUserId, familyMemberId)

  const member = await prisma.familyMember.findUnique({
    where: { id: familyMemberId },
    include: {
      emergencyContacts: { orderBy: { sortOrder: 'asc' } },
      medications: {
        where: { active: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!member) {
    throw Object.assign(new Error('Family member not found'), { status: 404, code: 'NOT_FOUND' })
  }

  return {
    member: {
      id: member.id,
      name: member.name,
      relation: member.relation,
      dateOfBirth: toBangkokISO(member.dateOfBirth),
      bloodType: member.bloodType ?? null,
      allergies: member.allergies ?? null,
      conditions: member.conditions ?? null,
      preferredHospital: member.preferredHospital ?? null,
      photoUrl: member.photoUrl ?? null,
    },
    emergencyContacts: member.emergencyContacts.map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? null,
      relation: c.relation ?? null,
      sortOrder: c.sortOrder,
    })),
    activeMedications: member.medications.map(m => ({
      id: m.id,
      name: m.name,
      dosage: m.dosage ?? null,
      frequency: m.frequency ?? null,
      instructions: m.instructions ?? null,
    })),
  }
}
