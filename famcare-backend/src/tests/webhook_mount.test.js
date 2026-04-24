import { jest } from '@jest/globals'

const mockReplyMessage = jest.fn()
const mockValidateSignature = jest.fn()

jest.unstable_mockModule('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: jest.fn().mockImplementation(() => ({
      replyMessage: mockReplyMessage,
    })),
  },
  validateSignature: mockValidateSignature,
}))

jest.unstable_mockModule('../lib/prisma.js', () => ({
  prisma: {
    user: { upsert: jest.fn(), findUnique: jest.fn() },
    medication: { findUnique: jest.fn() },
    symptomLog: { create: jest.fn() },
  },
}))

jest.unstable_mockModule('../services/userService.js', () => ({
  findOrCreateByLineUserId: jest.fn(),
}))

jest.unstable_mockModule('../services/appointmentService.js', () => ({
  createAppointment: jest.fn(),
  listAppointments: jest.fn().mockResolvedValue([]),
}))

jest.unstable_mockModule('../services/medicationService.js', () => ({
  createMedicationLog: jest.fn(),
  MEDICATION_LOG_STATUSES: new Set(['TAKEN', 'MISSED', 'SKIPPED']),
}))

jest.unstable_mockModule('../services/cloudinaryService.js', () => ({
  uploadBuffer: jest.fn(),
}))

jest.unstable_mockModule('../services/aiService.js', () => ({
  handleAiMessage: jest.fn().mockResolvedValue('mock AI reply'),
}))

jest.unstable_mockModule('../services/familyMemberService.js', () => ({
  listFamilyMembers: jest.fn().mockResolvedValue([]),
  createFamilyMember: jest.fn(),
  getFamilyMember: jest.fn(),
  updateFamilyMember: jest.fn(),
  deleteFamilyMember: jest.fn(),
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { validateSignature } = await import('@line/bot-sdk')
const { handleLineWebhook } = await import('../webhook/handler.js')

function buildApp({ withSecret }) {
  const app = express()

  app.get('/webhook', (_req, res) => {
    res.status(200).json({ ok: true, service: 'famcare-backend-webhook' })
  })

  if (withSecret) {
    app.post(
      '/webhook',
      express.raw({ type: '*/*' }),
      (req, res, next) => {
        const rawBodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '')
        const rawBodyText = rawBodyBuffer.toString('utf8')

        let payload = {}
        if (rawBodyText.trim().length > 0) {
          try {
            payload = JSON.parse(rawBodyText)
          } catch {
            return res.status(400).json({ error: 'invalid json payload' })
          }
        }

        const events = Array.isArray(payload?.events) ? payload.events : []
        if (events.length === 0) {
          return res.status(200).send()
        }

        const signature = req.get('x-line-signature')
        if (!signature) {
          return res.status(401).json({ error: 'missing signature' })
        }

        const isValid = validateSignature(rawBodyText, 'test-secret', signature)
        if (!isValid) {
          return res.status(401).json({ error: 'invalid signature' })
        }

        req.body = payload
        return next()
      },
      handleLineWebhook
    )
  } else {
    app.post('/webhook', express.json(), handleLineWebhook)
  }

  return app
}

beforeEach(() => {
  mockReplyMessage.mockResolvedValue(undefined)
  mockValidateSignature.mockReturnValue(true)
})

describe('webhook mount', () => {
  test('GET /webhook returns 200 ok for verify/health checks', async () => {
    const res = await supertest(buildApp({ withSecret: true })).get('/webhook')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, service: 'famcare-backend-webhook' })
  })

  test('POST /webhook with empty events returns 200 without signature', async () => {
    const res = await supertest(buildApp({ withSecret: true }))
      .post('/webhook')
      .send({ events: [] })
    expect(res.status).toBe(200)
    expect(mockValidateSignature).not.toHaveBeenCalled()
  })

  test('POST /webhook with non-empty events and missing signature returns 401', async () => {
    const res = await supertest(buildApp({ withSecret: true }))
      .post('/webhook')
      .send({ events: [{ type: 'message', message: { type: 'text', text: 'hi' } }] })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'missing signature' })
  })

  test('POST /webhook with non-empty events and invalid signature returns 401', async () => {
    mockValidateSignature.mockReturnValue(false)
    const res = await supertest(buildApp({ withSecret: true }))
      .post('/webhook')
      .set('x-line-signature', 'bad')
      .send({ events: [{ type: 'message', message: { type: 'text', text: 'hi' } }] })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'invalid signature' })
  })

  test('POST /webhook with non-empty events and valid signature returns 200', async () => {
    mockValidateSignature.mockReturnValue(true)
    const res = await supertest(buildApp({ withSecret: true }))
      .post('/webhook')
      .set('x-line-signature', 'valid')
      .send({ events: [{ type: 'unknown' }] })
    expect(res.status).toBe(200)
    expect(mockValidateSignature).toHaveBeenCalled()
  })

  test('POST /webhook in dev mode (no secret) still returns 200 for empty events', async () => {
    const res = await supertest(buildApp({ withSecret: false }))
      .post('/webhook')
      .send({ events: [] })
    expect(res.status).toBe(200)
  })
})
