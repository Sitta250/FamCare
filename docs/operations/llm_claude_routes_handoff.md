# Handoff: routes, Express prefixes, LINE webhook, intent/Gemini

One copy-paste document for an LLM integrating with FamCare. Update this file if routes or webhook behavior change (keep in sync with `famcare-backend`).

**Note:** There is **no `app.js`**. The Express app lives only in `famcare-backend/src/index.js`.

---

## Express route prefixes (`famcare-backend/src/index.js`)

| Mount / route | Method(s) | Purpose |
|---------------|-----------|---------|
| `/` | GET | `{"status":"ok"}` |
| `/health` | GET | `{"ok": true, "service": "famcare-backend"}` |
| `/api/v1/health` | GET | same shape, versioned health check |
| `/webhook` | GET | LINE verify / ping: `200` + `famcare-backend-webhook` |
| `/webhook` | POST | LINE bot webhook (`handleLineWebhook`). If `LINE_CHANNEL_SECRET` is set: raw body + `x-line-signature` validation **before** `express.json()`. If unset (dev): `express.json()` + no signature. |
| `/api/v1` | — | `apiRouter` from `src/routes/index.js` (all REST API routes below) |

**After webhook registration:** `app.use(express.json())` for JSON bodies, then `app.use("/api/v1", apiRouter)`, then `app.use(errorHandler)`.

**Nested under `app.use("/api/v1", apiRouter)`:**
- `/api/v1/me`
- `/api/v1/family-members` (also mounts `/api/v1/family-members/:memberId/access` via `familyAccess.js`)
- `/api/v1/appointments`
- `/api/v1/medications`
- `/api/v1/health-metrics`
- `/api/v1/documents`
- `/api/v1/insurance`
- `/api/v1/symptom-logs`

---

## LINE: what the webhook handles

Source: `famcare-backend/src/webhook/handler.js`.

- **`message`**
  - **`text`** — `findOrCreateByLineUserId` → **`getGeminiReply`** (Google Gemini `gemini-2.0-flash` via `GEMINI_API_KEY`) → `reply` with that text. No `parseIntent` or keyword layer before Gemini.
  - **`audio`** — fetches content from LINE, optional Cloudinary upload, may create a `SymptomLog` for first family member, static Thai confirmation reply (no Gemini).
  - **Other `message` types** — logged as unhandled, no user reply.
- **`postback`** — expects JSON in `event.postback.data` with `action` among: `add_appointment`, `list_appointments`, `log_medication`; unknown actions get a generic acknowledgment.
- **`follow`** — `findOrCreateByLineUserId` and welcome `reply` text.
- **Other `event.type`** — logged as unhandled.

The handler always responds `200` to LINE immediately, then processes events in a loop.

---

## Intent / keyword handling before Gemini?

- **On the LINE text path: no.** Only user upsert then `getGeminiReply(userMessage)`.
- **`thaiNlpService.js`** exports `parseIntent(text)` (Thai strings for group/private chat mode, appointment-like phrases, date/time parsing). It is **not** imported by `webhook/handler.js`. It appears in unit tests (e.g. `communication_mode.test.js`).
- **Unrelated:** `GET /api/v1/documents` uses query params `keyword` / `q` for DB search, not the LINE chat pipeline.

---

## `famcare-backend/src/index.js` (full)

```javascript
import "dotenv/config";
import express from "express";
import { validateSignature } from "@line/bot-sdk";
import { errorHandler } from "./middleware/errorHandler.js";
import apiRouter from "./routes/index.js";
import { handleLineWebhook } from "./webhook/handler.js";
import { startCronJobs } from "./jobs/cron.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

// LINE verify pings / manual health checks — always 200
app.get("/webhook", (_req, res) => {
  res.status(200).json({ ok: true, service: "famcare-backend-webhook" });
});

// LINE webhook — must be before express.json() so we can parse raw body once.
// Verify requests may send empty events. We fast-ack those before signature checks.
// Real events must still pass signature validation.
if (process.env.LINE_CHANNEL_SECRET) {
  app.post(
    "/webhook",
    express.raw({ type: "*/*" }),
    (req, res, next) => {
      const rawBodyBuffer =
        Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
      const rawBodyText = rawBodyBuffer.toString("utf8");

      let payload = {};
      if (rawBodyText.trim().length > 0) {
        try {
          payload = JSON.parse(rawBodyText);
        } catch (err) {
          console.warn(`[webhook] invalid JSON payload: ${err.message || err}`);
          return res.status(400).json({ error: "invalid json payload" });
        }
      }

      const events = Array.isArray(payload?.events) ? payload.events : [];
      if (events.length === 0) {
        return res.status(200).send();
      }

      const signature = req.get("x-line-signature");
      if (!signature) {
        console.warn("[webhook] missing x-line-signature for non-empty events");
        return res.status(401).json({ error: "missing signature" });
      }

      const isValid = validateSignature(
        rawBodyText,
        process.env.LINE_CHANNEL_SECRET,
        signature
      );
      if (!isValid) {
        console.warn("[webhook] invalid signature for non-empty events");
        return res.status(401).json({ error: "invalid signature" });
      }

      req.body = payload;
      return next();
    },
    handleLineWebhook
  );
} else {
  // Dev mode: no signature check
  app.post("/webhook", express.json(), handleLineWebhook);
}

app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "famcare-backend" });
});

app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "famcare-backend" });
});

app.use("/api/v1", apiRouter);

app.use(errorHandler);

app.listen(port, () => {
  console.log(`famcare-backend listening on :${port}`);
  startCronJobs();
});
```

---

## `famcare-backend/src/routes/` (file list, then each file in full)

Files (10):
1. `index.js` — aggregate router
2. `me.js`
3. `familyMembers.js` — also `router.use('/:memberId/access', familyAccessRouter)`
4. `familyAccess.js`
5. `appointments.js`
6. `medications.js`
7. `healthMetrics.js`
8. `documents.js`
9. `insurance.js`
10. `symptomLogs.js`

### `index.js`

```javascript
import { Router } from 'express'
import meRouter from './me.js'
import familyMembersRouter from './familyMembers.js'
import appointmentsRouter from './appointments.js'
import medicationsRouter from './medications.js'
import healthMetricsRouter from './healthMetrics.js'
import documentsRouter from './documents.js'
import insuranceRouter from './insurance.js'
import symptomLogsRouter from './symptomLogs.js'

const router = Router()

router.use('/me', meRouter)
router.use('/family-members', familyMembersRouter)
router.use('/appointments', appointmentsRouter)
router.use('/medications', medicationsRouter)
router.use('/health-metrics', healthMetricsRouter)
router.use('/documents', documentsRouter)
router.use('/insurance', insuranceRouter)
router.use('/symptom-logs', symptomLogsRouter)

export default router
```

### `me.js`

```javascript
import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import { toBangkokISO } from '../utils/datetime.js'
import { deleteUserAndData, updateChatMode } from '../services/userService.js'

const router = Router()

function serializeMe(user) {
  const { id, lineUserId, displayName, photoUrl, phone, chatMode, createdAt } = user
  return {
    id,
    lineUserId,
    displayName,
    photoUrl,
    phone,
    chatMode,
    createdAt: toBangkokISO(createdAt),
  }
}

router.get('/', requireLineUser, (req, res) => {
  res.json({ data: serializeMe(req.user) })
})

router.patch('/', requireLineUser, async (req, res, next) => {
  try {
    const user = await updateChatMode(req.user.id, req.body.chatMode)
    res.json({ data: serializeMe(user) })
  } catch (err) {
    next(err)
  }
})

/**
 * PDPA hard delete — permanently removes the authenticated user and all owned data.
 * After deletion, the same LINE user ID will be re-created as a fresh empty account
 * on next authenticated request.
 */
router.delete('/', requireLineUser, async (req, res, next) => {
  try {
    await deleteUserAndData(req.user.id)
    res.json({ data: { deleted: true } })
  } catch (err) {
    next(err)
  }
})

export default router
```

### `familyMembers.js`

```javascript
import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import {
  listFamilyMembers,
  createFamilyMember,
  getFamilyMember,
  updateFamilyMember,
  deleteFamilyMember,
} from '../services/familyMemberService.js'
import { getEmergencyInfo } from '../services/emergencyInfoService.js'
import { getEmergencyCard } from '../services/emergencyCardService.js'
import {
  listEmergencyContacts,
  createEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
} from '../services/emergencyContactService.js'
import familyAccessRouter from './familyAccess.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const data = await listFamilyMembers(req.user.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = await createFamilyMember(req.user.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

// Sub-routes before generic `/:id` so paths like `.../emergency-info` are not captured as ids
router.get('/:id/emergency-info', async (req, res, next) => {
  try {
    const data = await getEmergencyInfo(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:memberId/emergency-card', async (req, res, next) => {
  try {
    const data = await getEmergencyCard(req.user.id, req.params.memberId)
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:memberId/emergency-contacts', async (req, res, next) => {
  try {
    const data = await listEmergencyContacts(req.user.id, req.params.memberId)
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/:memberId/emergency-contacts', async (req, res, next) => {
  try {
    const data = await createEmergencyContact(req.user.id, req.params.memberId, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.patch('/:memberId/emergency-contacts/:contactId', async (req, res, next) => {
  try {
    const data = await updateEmergencyContact(req.user.id, req.params.memberId, req.params.contactId, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:memberId/emergency-contacts/:contactId', async (req, res, next) => {
  try {
    await deleteEmergencyContact(req.user.id, req.params.memberId, req.params.contactId)
    res.status(204).send()
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getFamilyMember(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const data = await updateFamilyMember(req.user.id, req.params.id, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteFamilyMember(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

router.use('/:memberId/access', familyAccessRouter)

export default router
```

### `familyAccess.js`

```javascript
import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import {
  grantAccess,
  listAccessForMember,
  revokeAccess,
  updateNotificationPrefs,
} from '../services/familyAccessService.js'

// Mounted at /api/v1/family-members/:memberId/access
const router = Router({ mergeParams: true })

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const data = await listAccessForMember(req.user.id, req.params.memberId)
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const { grantedToLineUserId, role, notificationPrefs } = req.body
    const data = await grantAccess(req.user.id, req.params.memberId, {
      grantedToLineUserId,
      role,
      notificationPrefs,
    })
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.patch('/:grantedToUserId', async (req, res, next) => {
  try {
    const data = await updateNotificationPrefs(
      req.user.id,
      req.params.memberId,
      req.params.grantedToUserId,
      req.body.notificationPrefs,
    )
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:grantedToUserId', async (req, res, next) => {
  try {
    await revokeAccess(req.user.id, req.params.memberId, req.params.grantedToUserId)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
```

### `appointments.js`

```javascript
import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import {
  listAppointments,
  createAppointment,
  getAppointment,
  updateAppointment,
  deleteAppointment,
} from '../services/appointmentService.js'
import { getPreAppointmentReport } from '../services/preAppointmentReportService.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const { familyMemberId, status, from, to, accompaniedByUserId, view } = req.query
    const data = await listAppointments(req.user.id, { familyMemberId, status, from, to, accompaniedByUserId, view })
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = await createAppointment(req.user.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.get('/:id/pre-appointment-report', async (req, res, next) => {
  try {
    const data = await getPreAppointmentReport(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getAppointment(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const data = await updateAppointment(req.user.id, req.params.id, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteAppointment(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
```

### `medications.js`

```javascript
import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import {
  listMedications,
  createMedication,
  getMedication,
  updateMedication,
  deleteMedication,
  listMedicationLogs,
  createMedicationLog,
  getMedicationAdherence,
  updateMedicationSchedule,
  getMedicationSchedule,
} from '../services/medicationService.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const { familyMemberId, active } = req.query
    const data = await listMedications(req.user.id, familyMemberId, { active })
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = await createMedication(req.user.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

// Sub-routes before generic `/:id` (e.g. avoid treating "logs" as a medication id)
router.get('/:id/logs', async (req, res, next) => {
  try {
    const { from, to, limit, cursor } = req.query
    const data = await listMedicationLogs(req.user.id, req.params.id, {
      from,
      to,
      limit,
      cursor,
    })
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/:id/logs', async (req, res, next) => {
  try {
    const data = await createMedicationLog(req.user.id, req.params.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.get('/:id/schedule', async (req, res, next) => {
  try {
    const data = await getMedicationSchedule(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.put('/:id/schedule', async (req, res, next) => {
  try {
    const { times } = req.body
    const data = await updateMedicationSchedule(req.user.id, req.params.id, times)
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:id/adherence', async (req, res, next) => {
  try {
    const { from, to } = req.query
    const data = await getMedicationAdherence(req.user.id, req.params.id, { from, to })
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getMedication(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const data = await updateMedication(req.user.id, req.params.id, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteMedication(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
```

### `healthMetrics.js`

```javascript
import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import {
  listHealthMetrics,
  createHealthMetric,
  getHealthMetric,
  updateHealthMetric,
  deleteHealthMetric,
} from '../services/healthMetricService.js'
import {
  listThresholds,
  upsertThreshold,
  deleteThreshold,
} from '../services/healthMetricThresholdService.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const { familyMemberId, type, from, to } = req.query
    const data = await listHealthMetrics(req.user.id, { familyMemberId, type, from, to })
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = await createHealthMetric(req.user.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.get('/:memberId/thresholds', async (req, res, next) => {
  try {
    const data = await listThresholds(req.user.id, req.params.memberId)
    res.json({ data })
  } catch (err) { next(err) }
})

router.put('/:memberId/thresholds/:type', async (req, res, next) => {
  try {
    const data = await upsertThreshold(req.user.id, req.params.memberId, req.params.type, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:memberId/thresholds/:type', async (req, res, next) => {
  try {
    await deleteThreshold(req.user.id, req.params.memberId, req.params.type)
    res.status(204).send()
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getHealthMetric(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const data = await updateHealthMetric(req.user.id, req.params.id, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteHealthMetric(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
```

### `documents.js`

```javascript
import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import { uploadSingle } from '../middleware/upload.js'
import {
  listDocuments,
  createDocument,
  getDocument,
  deleteDocument,
} from '../services/documentService.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const familyMemberId = req.query.familyMemberId ?? req.query.memberId
    const keyword = req.query.keyword ?? req.query.q
    const { from, to, date } = req.query

    const data = await listDocuments(req.user.id, {
      familyMemberId,
      keyword,
      from,
      to,
      date,
    })
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', uploadSingle, async (req, res, next) => {
  try {
    const data = await createDocument(req.user.id, {
      ...req.body,
      file: req.file,
    })
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getDocument(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteDocument(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
```

### `insurance.js`

```javascript
import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import { uploadInsurancePhotos } from '../middleware/upload.js'
import {
  createInsuranceCard,
  deleteInsuranceCard,
  getInsuranceCard,
  listInsuranceCards,
  updateInsuranceCard,
} from '../services/insuranceService.js'

const router = Router()

router.use(requireLineUser)

router.post('/', uploadInsurancePhotos, async (req, res, next) => {
  try {
    const result = await createInsuranceCard(req.user.id, {
      ...req.body,
      files: req.files,
    })
    res.status(201).json({
      data: result.card,
      ocrSuccess: result.ocrSuccess,
      extractedFields: result.extractedFields,
    })
  } catch (err) { next(err) }
})

router.get('/', async (req, res, next) => {
  try {
    const familyMemberId = req.query.familyMemberId ?? req.query.memberId
    const data = await listInsuranceCards(req.user.id, { familyMemberId })
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getInsuranceCard(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', uploadInsurancePhotos, async (req, res, next) => {
  try {
    const result = await updateInsuranceCard(req.user.id, req.params.id, {
      ...req.body,
      files: req.files,
    })
    res.json({
      data: result.card,
      ocrSuccess: result.ocrSuccess,
      extractedFields: result.extractedFields,
    })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteInsuranceCard(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
```

### `symptomLogs.js`

```javascript
import { Router } from 'express'
import { requireLineUser } from '../middleware/auth.js'
import { uploadAudio, uploadSingle } from '../middleware/upload.js'
import {
  listSymptomLogs,
  createSymptomLog,
  getSymptomLog,
  updateSymptomLog,
  deleteSymptomLog,
  attachPhotoToSymptomLog,
  attachVoiceNoteToSymptomLog,
} from '../services/symptomLogService.js'

const router = Router()

router.use(requireLineUser)

router.get('/', async (req, res, next) => {
  try {
    const { familyMemberId, limit, cursor, from, to } = req.query
    const data = await listSymptomLogs(req.user.id, { familyMemberId, limit, cursor, from, to })
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const data = await createSymptomLog(req.user.id, req.body)
    res.status(201).json({ data })
  } catch (err) { next(err) }
})

router.post('/:id/photo', uploadSingle, async (req, res, next) => {
  try {
    const data = await attachPhotoToSymptomLog(req.user.id, req.params.id, req.file)
    res.json({ data })
  } catch (err) { next(err) }
})

router.post('/:id/voice-note', uploadAudio, async (req, res, next) => {
  try {
    const data = await attachVoiceNoteToSymptomLog(req.user.id, req.params.id, req.file)
    res.json({ data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await getSymptomLog(req.user.id, req.params.id)
    res.json({ data })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const data = await updateSymptomLog(req.user.id, req.params.id, req.body)
    res.json({ data })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteSymptomLog(req.user.id, req.params.id)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
```
