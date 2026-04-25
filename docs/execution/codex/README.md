# FamCare LLM Integration — Implementation Plan Index

> **For AI agents:** Read this file first. Each feature has its own document. Implement features in the order listed below. Do not start a feature until all features with lower numbers in this order are complete and `npm test` passes.

---

## Repository Root

`famcare-backend/` — all code lives here. ESM modules (`"type": "module"`). Node ≥ 20.

## Implementation Order

| Order | Feature | File | Key Dependency |
|-------|---------|------|---------------|
| 1 | Feature 4: LLM Provider Failover | [feature-04-failover.md](./feature-04-failover.md) | None |
| 2 | Feature 5: Token & Latency Telemetry | [feature-05-telemetry.md](./feature-05-telemetry.md) | Feature 4 (provider functions) |
| 3 | Feature 6: Rate Limiting | [feature-06-rate-limiting.md](./feature-06-rate-limiting.md) | None (schema migration) |
| 4 | Feature 7: Guardrails & Output Validation | [feature-07-guardrails.md](./feature-07-guardrails.md) | Features 4+5+6 wired in |
| 5 | Feature 1: Conversation Memory | [feature-01-conversation-memory.md](./feature-01-conversation-memory.md) | Schema migration + stable pipeline |
| 6 | Feature 2: Ambiguity Resolution | [feature-02-ambiguity-resolution.md](./feature-02-ambiguity-resolution.md) | Feature 7 (validated intent) |
| 7 | Feature 3: Destructive Confirmation | [feature-03-destructive-confirmation.md](./feature-03-destructive-confirmation.md) | Feature 2 (executeIntent exported) |
| 8 | Feature 8: Intent Expansion (Docs + Insurance) | [feature-08-intent-expansion.md](./feature-08-intent-expansion.md) | Feature 3 (DESTRUCTIVE_INTENTS) |
| 9 | Feature 9: User Onboarding | [feature-09-onboarding.md](./feature-09-onboarding.md) | All prior features stable |

---

## Key Files (Agent Reference)

| File | Purpose |
|------|---------|
| `famcare-backend/src/services/aiService.js` | LLM pipeline — all Features 1–8 touch this |
| `famcare-backend/src/webhook/handler.js` | LINE event dispatcher — Features 2, 3, 9 |
| `famcare-backend/prisma/schema.prisma` | Schema — Features 1, 3, 6, 9 add models |
| `famcare-backend/src/utils/datetime.js` | Bangkok timezone utils — Feature 9 adds Thai date parser |
| `famcare-backend/src/tests/` | All test files go here |

---

## Prisma Models Added (All Features Combined)

Run these migrations in order. If implementing multiple features at once, combine into one migration.

```
add_ai_usage_log          — Feature 6
add_conversation_message  — Feature 1
add_pending_action        — Feature 3
add_onboarding_session    — Feature 9
```

Single combined migration command (if doing all at once):
```bash
cd famcare-backend && npx prisma migrate dev --name add_llm_features
```

---

## Test Files Added

| Test File | Features Covered |
|-----------|-----------------|
| `src/tests/aiService_failover.test.js` | Feature 4 |
| `src/tests/aiService_telemetry.test.js` | Feature 5 |
| `src/tests/aiService_rateLimit.test.js` | Feature 6 |
| `src/tests/aiService_guardrails.test.js` | Feature 7 |
| `src/tests/aiService_memory.test.js` | Feature 1 |
| `src/tests/aiService_ambiguity.test.js` | Feature 2 |
| `src/tests/aiService_confirmation.test.js` | Feature 3 |
| `src/tests/aiService_documents.test.js` | Feature 8 (documents) |
| `src/tests/aiService_insurance.test.js` | Feature 8 (insurance) |
| `src/tests/handler_ambiguity.test.js` | Feature 2 (postback) |
| `src/tests/handler_confirmation.test.js` | Feature 3 (postback) |
| `src/tests/handler_onboarding.test.js` | Feature 9 |
| `src/tests/datetime_thai.test.js` | Feature 9 (date parser) |

---

## Global Constraints (Apply to All Features)

1. **ESM only** — use `import`/`export`, never `require()`. Use `jest.unstable_mockModule` for mocks.
2. **Bangkok timezone** — use `bangkokCalendarDate()` from `datetime.js` for any date keys. Never `new Date().toISOString().slice(0,10)`.
3. **No new npm packages** except `openai` (Feature 4). If you think you need another package, stop and raise it.
4. **Thin routes, fat services** — all new logic goes in services. Handler.js only dispatches.
5. **Error convention** — throw `Object.assign(new Error('msg'), { status: 400, code: 'X' })`. Never `res.status(400).json(...)` directly.
6. **Never block the LINE reply on memory/telemetry saves** — use fire-and-forget with `.catch()`.
7. **Test pattern** — mock Prisma with `jest.unstable_mockModule('../lib/prisma.js', ...)`. Mock LINE push service. Call `jest.clearAllMocks()` in `beforeEach`.
8. **Run `npm test` after every task.** All prior tests must still pass.

---

## Verification After Each Feature

```bash
cd famcare-backend
npm test                          # all tests must pass
npx prisma generate               # only if schema changed
```

Final verification after all 9 features:
```bash
cd famcare-backend && npm test
```
