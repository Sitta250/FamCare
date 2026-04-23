import { jest } from '@jest/globals'

const mockReplyMessage = jest.fn()
let mockVerifyBehavior = 'ok'

jest.unstable_mockModule('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: jest.fn().mockImplementation(() => ({
      replyMessage: mockReplyMessage,
    })),
  },
  middleware: jest.fn(() => (req, _res, next) => {
    if (mockVerifyBehavior === 'no-signature') {
      return next(new Error('no signature'))
    }
    if (mockVerifyBehavior === 'bad-signature') {
      return next(new Error('invalid signature'))
    }
    req.body = req.body || { events: [] }
    return next()
  }),
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
}))

jest.unstable_mockModule('../services/medicationService.js', () => ({
  createMedicationLog: jest.fn(),
  MEDICATION_LOG_STATUSES: new Set(['TAKEN', 'MISSED', 'SKIPPED']),
}))

jest.unstable_mockModule('../services/cloudinaryService.js', () => ({
  uploadBuffer: jest.fn(),
}))

const { default: express } = await import('express')
const { default: supertest } = await import('supertest')
const { middleware: lineMiddleware } = await import('@line/bot-sdk')
const { handleLineWebhook } = await import('../webhook/handler.js')

function buildApp({ withSecret }) {
  const app = express()

  app.get('/webhook', (_req, res) => {
    res.status(200).json({ ok: true, service: 'famcare-backend-webhook' })
  })

  if (withSecret) {
    const verifySignature = lineMiddleware({ channelSecret: 'test-secret' })
    app.post(
      '/webhook',
      (req, res, next) => {
        verifySignature(req, res, (err) => {
          if (err) {
            return express.json()(req, res, next)
          }
          return next()
        })
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
  mockVerifyBehavior = 'ok'
})

describe('webhook mount', () => {
  test('GET /webhook returns 200 ok for verify/health checks', async () => {
    const res = await supertest(buildApp({ withSecret: true })).get('/webhook')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, service: 'famcare-backend-webhook' })
  })

  test('POST /webhook with valid signature ack is 200', async () => {
    const res = await supertest(buildApp({ withSecret: true }))
      .post('/webhook')
      .set('x-line-signature', 'valid')
      .send({ events: [] })
    expect(res.status).toBe(200)
  })

  test('POST /webhook without signature still returns 200 (LINE verify-safe)', async () => {
    mockVerifyBehavior = 'no-signature'
    const res = await supertest(buildApp({ withSecret: true }))
      .post('/webhook')
      .send({ events: [] })
    expect(res.status).toBe(200)
  })

  test('POST /webhook with invalid signature still returns 200', async () => {
    mockVerifyBehavior = 'bad-signature'
    const res = await supertest(buildApp({ withSecret: true }))
      .post('/webhook')
      .set('x-line-signature', 'bad')
      .send({ events: [] })
    expect(res.status).toBe(200)
  })

  test('POST /webhook in dev mode (no secret) returns 200 for empty events', async () => {
    const res = await supertest(buildApp({ withSecret: false }))
      .post('/webhook')
      .send({ events: [] })
    expect(res.status).toBe(200)
  })
})
