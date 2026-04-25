# Feature 8: Intent Coverage Expansion — Documents and Insurance

> **Implementation order: 8**

---

## 1. Goal Summary

Add 7 new intents for document and insurance CRUD via LINE chat:
- Documents: `list_documents`, `get_document`, `delete_document`
- Insurance: `list_insurance`, `get_insurance`, `update_insurance`, `delete_insurance`

`create_document` and `create_insurance` are not added (require file upload). Enforce existing OWNER/CAREGIVER/VIEWER access control. Add `delete_document` and `delete_insurance` to the `DESTRUCTIVE_INTENTS` set (Feature 3 pattern).

---

## 2. Existing Files / Modules Involved

| File | Role |
|------|------|
| `famcare-backend/src/services/aiService.js` | Add new intents to prompt + `executeIntent` switch + `DESTRUCTIVE_INTENTS` |
| `famcare-backend/src/services/documentService.js` | Existing CRUD — reuse `listDocuments`, `getDocument`, `deleteDocument` |
| `famcare-backend/src/services/insuranceService.js` | Existing CRUD — reuse `listInsuranceCards`, `getInsuranceCard`, `updateInsuranceCard`, `deleteInsuranceCard` |
| `famcare-backend/src/services/accessService.js` | Existing `assertCanReadMember`, `assertCanWriteMember` |

No schema changes. No route changes. No handler changes.

---

## 3. Data Model Changes

None. `Document` and `InsuranceCard` models already exist in `schema.prisma`.

---

## 4. API Changes

`buildIntentPrompt` — add 7 new intent schemas to the prompt text.

`executeIntent` — add 7 new `case` branches.

`DESTRUCTIVE_INTENTS` set — add `'delete_document'` and `'delete_insurance'`.

`KNOWN_INTENTS` set (Feature 7 guardrails) — add all 7 new intent strings.

---

## 5. Frontend Changes

None.

---

## 6. Edge Cases

| Case | Handling |
|------|---------|
| User asks to add a document via chat | Reply: "การอัปโหลดเอกสารต้องใช้แอป FamCare กรุณาเปิดแอปเพื่อเพิ่มเอกสาร" |
| User asks to add insurance via chat | Same: direct to app |
| VIEWER tries to `delete_document` | `assertCanWriteMember` throws 403; catch in `executeIntent`, return Thai permission-denied message |
| `get_document` by keyword returns multiple matches | Return first match with a note; e.g. "พบเอกสาร: [name]. พิมพ์ชื่อเอกสารให้ชัดขึ้นเพื่อค้นหาเฉพาะ" |
| `update_insurance` with no fields changed | Call service with empty update — service handles gracefully |
| No documents/insurance for member | Return Thai "ไม่พบ..." message |
| `delete_document`/`delete_insurance` → triggers Feature 3 confirmation flow | `DESTRUCTIVE_INTENTS` set includes these; confirmation runs automatically |

---

## 7. Implementation Tasks

### Task 8-A: Verify Existing Service Function Signatures

**Purpose:** Read `documentService.js` and `insuranceService.js` to confirm exported function names and parameter shapes before writing intent execution code.

**Files to read:**
- `famcare-backend/src/services/documentService.js`
- `famcare-backend/src/services/insuranceService.js`

**Action:** This is a research task — no code to write. Document the exact function signatures found, then use them in Task 8-B.

**Assumption (if files match typical CRUD pattern):**
```js
// documentService.js
listDocuments(userId, { familyMemberId, type, keyword })
getDocument(userId, documentId)
deleteDocument(userId, documentId)

// insuranceService.js
listInsuranceCards(userId, { familyMemberId })
getInsuranceCard(userId, cardId)
updateInsuranceCard(userId, cardId, body)
deleteInsuranceCard(userId, cardId)
```

**If signatures differ, update Task 8-B accordingly.**

**Verification:** Manual read — no tests.

**Risks:** Service functions may use different parameter names (e.g., `insuranceCardId` vs `cardId`). Must verify before coding.

---

### Task 8-B: Add Document Intent Schemas to Prompt + Execute Cases

**Purpose:** Add `list_documents`, `get_document`, `delete_document` to the LLM prompt and the `executeIntent` switch.

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Dependencies:** Task 8-A (confirmed service signatures)

**New prompt schemas to add (append to `buildIntentPrompt`):**

```
list_documents:
{
  "intent": "list_documents",
  "familyMemberId": "<id or null>",
  "type": "<document type or null>",
  "keyword": "<search keyword or null>"
}

get_document:
{
  "intent": "get_document",
  "familyMemberId": "<id or null>",
  "keyword": "<document name or search term>"
}

delete_document:
{
  "intent": "delete_document",
  "familyMemberId": "<id or null>",
  "keyword": "<document name to delete>"
}
```

**New executeIntent cases:**

```js
case 'list_documents': {
  const memberId = resolveOrPickFirstMember(intent.familyMemberId, familyMembers)
  if (!memberId) return '...'
  const docs = await listDocuments(userId, { familyMemberId: memberId, keyword: intent.keyword })
  if (!docs.length) return `📄 ไม่พบเอกสารสำหรับ${memberNameById(memberId, familyMembers)}`
  const lines = docs.slice(0, 5).map(d => `• ${d.type}: ${d.ocrText?.slice(0,50) ?? '(ไม่มีข้อความ)'}`)
  return `📄 เอกสารของ${memberNameById(memberId, familyMembers)}:\n${lines.join('\n')}`
}

case 'get_document': {
  // list with keyword, return first match
  const memberId = resolveOrPickFirstMember(intent.familyMemberId, familyMembers)
  if (!memberId) return '...'
  const docs = await listDocuments(userId, { familyMemberId: memberId, keyword: intent.keyword })
  if (!docs.length) return `📄 ไม่พบเอกสาร "${intent.keyword}"`
  const d = docs[0]
  return `📄 ${d.type}\n${d.ocrText?.slice(0,200) ?? '(ไม่มีข้อความ OCR)'}`
}

case 'delete_document': {
  // This case is reached only after confirmation (Feature 3)
  const memberId = resolveOrPickFirstMember(intent.familyMemberId, familyMembers)
  if (!memberId) return '...'
  const docs = await listDocuments(userId, { familyMemberId: memberId, keyword: intent.keyword })
  if (!docs.length) return `❌ ไม่พบเอกสาร "${intent.keyword}"`
  await deleteDocument(userId, docs[0].id)
  return `🗑️ ลบเอกสารเรียบร้อยแล้ว`
}
```

**Update `DESTRUCTIVE_INTENTS`:**
```js
const DESTRUCTIVE_INTENTS = new Set([
  'delete_appointment', 'delete_medication', 'delete_symptom',
  'delete_document',  // new
  'delete_insurance', // new
  'update_appointment',
])
```

**Update `KNOWN_INTENTS` (Feature 7 guardrails):**
```js
const KNOWN_INTENTS = new Set([
  // existing...
  'list_documents', 'get_document', 'delete_document',
  'list_insurance', 'get_insurance', 'update_insurance', 'delete_insurance',
])
```

**Acceptance criteria:**
- `list_documents` → calls `listDocuments(userId, {familyMemberId, keyword})`
- `get_document` → calls `listDocuments` with keyword, returns first match description
- `delete_document` → calls `deleteDocument(userId, docId)` with correct ID from keyword lookup
- `delete_document` is in `DESTRUCTIVE_INTENTS` → triggers Feature 3 confirmation
- Unknown document intent → handled by existing guardrail (Feature 7)
- VIEWER role → `assertCanWriteMember` in `deleteDocument` throws 403; catch returns Thai permission message

**Tests to add:**
`famcare-backend/src/tests/aiService_documents.test.js`

Test cases:
1. `executeIntent` with `list_documents` → `listDocuments` called, Thai list returned
2. `executeIntent` with `list_documents`, no results → "ไม่พบเอกสาร" message
3. `executeIntent` with `get_document`, keyword match → document details returned
4. `executeIntent` with `delete_document` → `deleteDocument` called (note: in practice this runs via confirmation postback)
5. `handleAiMessage` with `delete_document` intent → `{ type: 'flexMessage' }` returned (Feature 3 triggers)
6. `listDocuments` throws 403 → Thai permission-denied message returned

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService_documents
```

---

### Task 8-C: Add Insurance Intent Schemas to Prompt + Execute Cases

**Purpose:** Add `list_insurance`, `get_insurance`, `update_insurance`, `delete_insurance` to the LLM prompt and `executeIntent`.

**Files affected:**
- `famcare-backend/src/services/aiService.js`

**Dependencies:** Task 8-A, Task 8-B

**New prompt schemas:**

```
list_insurance:
{
  "intent": "list_insurance",
  "familyMemberId": "<id or null>"
}

get_insurance:
{
  "intent": "get_insurance",
  "familyMemberId": "<id or null>",
  "keyword": "<company name or policy number or null>"
}

update_insurance:
{
  "intent": "update_insurance",
  "familyMemberId": "<id or null>",
  "keyword": "<insurance card identifier>",
  "expirationDate": "<ISO 8601 or null>",
  "policyNumber": "<new policy number or null>",
  "companyName": "<new company name or null>"
}

delete_insurance:
{
  "intent": "delete_insurance",
  "familyMemberId": "<id or null>",
  "keyword": "<insurance card identifier>"
}
```

**New executeIntent cases (follow document pattern):**

```js
case 'list_insurance': { ... }    // list all cards, Thai formatted
case 'get_insurance': { ... }     // find by keyword, show details
case 'update_insurance': { ... }  // find by keyword, call updateInsuranceCard
case 'delete_insurance': { ... }  // find by keyword, call deleteInsuranceCard (via confirmation)
```

**Acceptance criteria:**
- `list_insurance` → calls `listInsuranceCards(userId, {familyMemberId})`
- `get_insurance` → finds by keyword, returns company name, policy number, expiry
- `update_insurance` → calls `updateInsuranceCard(userId, cardId, {expirationDate, policyNumber, companyName})`
- `delete_insurance` is in `DESTRUCTIVE_INTENTS` → Feature 3 confirmation fires
- VIEWER trying `update_insurance` or `delete_insurance` → Thai permission-denied message
- All 4 intents in `KNOWN_INTENTS`

**Tests to add:**
`famcare-backend/src/tests/aiService_insurance.test.js`

Test cases:
1. `list_insurance` → `listInsuranceCards` called, Thai summary returned
2. `get_insurance` → insurance details returned
3. `update_insurance` → `updateInsuranceCard` called with correct fields
4. `delete_insurance` intent → `{ type: 'flexMessage' }` returned (confirmation triggered)
5. `list_insurance` no cards → "ไม่พบข้อมูลประกัน" message
6. `update_insurance` — VIEWER role → permission-denied message

**Verification:**
```bash
cd famcare-backend && npm test -- --testPathPattern=aiService_insurance
cd famcare-backend && npm test
```

---

## 8. Safe Implementation Order

```
8-A (read service signatures) → 8-B (document intents + tests) → 8-C (insurance intents + tests)
```

---

## 9. Global Risks and Ambiguities

| Risk | Mitigation |
|------|-----------|
| `documentService.js` / `insuranceService.js` functions may not match assumed signatures | Task 8-A is a mandatory research step — verify before writing any code |
| Finding documents/insurance by keyword may return multiple matches | Always take first match; mention this in the Thai response text |
| `update_insurance` requires knowing which card to update — keyword matching may be ambiguous | Return top-3 card names if match fails; ask user to be more specific |
| Access control errors from service functions | All service functions call `assertCanReadMember`/`assertCanWriteMember` internally; catch in `executeIntent` and return Thai error |
| Adding 7 new intent schemas significantly increases prompt length | Token count increase: ~300 tokens. Still well within Gemini's context window. Monitor with Feature 5 telemetry. |
