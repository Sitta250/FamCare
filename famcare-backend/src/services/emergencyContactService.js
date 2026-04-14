import { prisma } from '../lib/prisma.js'
import { assertCanReadMember, assertCanWriteMember } from './accessService.js'
import { toBangkokISO } from '../utils/datetime.js'

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, code: 'BAD_REQUEST' })
}

function notFound(message) {
  return Object.assign(new Error(message), { status: 404, code: 'NOT_FOUND' })
}

function formatContact(contact) {
  return {
    ...contact,
    createdAt: toBangkokISO(contact.createdAt),
    updatedAt: toBangkokISO(contact.updatedAt),
  }
}

function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw badRequest('name is required')
  }

  return name.trim()
}

async function getScopedContact(familyMemberId, contactId) {
  const contact = await prisma.emergencyContact.findFirst({
    where: { id: contactId, familyMemberId },
  })

  if (!contact) {
    throw notFound('Emergency contact not found')
  }

  return contact
}

export async function listEmergencyContacts(actorUserId, familyMemberId) {
  await assertCanReadMember(actorUserId, familyMemberId)

  const contacts = await prisma.emergencyContact.findMany({
    where: { familyMemberId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })

  return contacts.map(formatContact)
}

export async function createEmergencyContact(actorUserId, familyMemberId, body = {}) {
  await assertCanWriteMember(actorUserId, familyMemberId)

  const name = validateName(body.name)
  const contact = await prisma.emergencyContact.create({
    data: {
      familyMemberId,
      name,
      phone: body.phone ?? null,
      relation: body.relation ?? null,
      sortOrder: body.sortOrder ?? 0,
    },
  })

  return formatContact(contact)
}

export async function updateEmergencyContact(actorUserId, familyMemberId, contactId, body = {}) {
  await assertCanWriteMember(actorUserId, familyMemberId)
  await getScopedContact(familyMemberId, contactId)

  const data = {}

  if (body.name !== undefined) data.name = validateName(body.name)
  if (body.phone !== undefined) data.phone = body.phone
  if (body.relation !== undefined) data.relation = body.relation
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder

  const contact = await prisma.emergencyContact.update({
    where: { id: contactId },
    data,
  })

  return formatContact(contact)
}

export async function deleteEmergencyContact(actorUserId, familyMemberId, contactId) {
  await assertCanWriteMember(actorUserId, familyMemberId)
  await getScopedContact(familyMemberId, contactId)
  await prisma.emergencyContact.delete({ where: { id: contactId } })
}
