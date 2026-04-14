# Phase 7 — LINE webhook (verify + thin handler)

## Goal

`POST /webhook` validates **LINE signature** when `LINE_CHANNEL_SECRET` is set (`@line/bot-sdk` middleware). Events delegated to **`src/webhook/handler.js`**: handle `message` (text), `postback`; reply with a simple echo or placeholder text—**no business logic in `index.js`**.

## Prerequisites

- [Phase 1](phase1.md) health server pattern
- Env: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` (token used in Phase 8)

## Step-by-step

1. Add dependency: `@line/bot-sdk`.

2. **Mount order (critical)**
   - Register `POST /webhook` **before** `app.use(express.json())` globally **or** use LINE middleware on its own path per SDK docs so **raw body** verification works.
   - Pattern: if `LINE_CHANNEL_SECRET` missing (local dev), accept JSON body without signature (document risk—dev only).

3. **`webhook/handler.js`**
   - `export async function handleLineWebhook(req, res)` — `req.body.events` array.
   - For each event: switch `type` — `message`, `postback`; use `replyToken` with Messaging API reply or `client.replyMessage` for smoke test.
   - Always `res.status(200).send()` after processing (LINE requires 200 quickly).

4. **README**
   - Document `ngrok http 3000` and pasting URL into LINE Developer Console webhook settings.

5. **Do not** import Prisma in handler for this phase if you want a pure smoke test; optional: resolve LINE user id for future linking.

## Definition of done

- Real LINE channel: webhook verifies and 200.
- Dev without secret: can POST mock JSON (document sample).

## Verify

LINE Developers Console “Verify” or send a message to the bot; server logs show event.

## Next

[phase8.md](phase8.md)
