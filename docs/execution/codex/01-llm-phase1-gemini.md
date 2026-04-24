# LLM Phase 1 — Basic Gemini Conversation — Codex Task

## Status
IMPLEMENT

## Goal
Make the LINE bot respond intelligently to any text message using Gemini 2.0 Flash. When a user sends a text message, call Gemini with a FamCare system prompt and return the reply via LINE reply message. If Gemini fails, send a Thai fallback message instead of crashing.

## Relevant Files

| File | Role |
|------|------|
| `famcare-backend/src/webhook/handler.js` | LINE webhook event dispatcher — add Gemini call here for text message events |
| `famcare-backend/package.json` | Add `@google/generative-ai` dependency |
| `famcare-backend/.env` (Railway) | Add `GEMINI_API_KEY=your_key_here` |

## Tasks

1. Install the Gemini package:
   ```bash
   cd famcare-backend && npm install @google/generative-ai
   ```

2. Open `famcare-backend/src/webhook/handler.js`.

3. At the top, import the Gemini client:
   ```js
   import { GoogleGenerativeAI } from '@google/generative-ai';
   const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
   const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
   ```

4. In the text message event handler (where the bot currently echoes or ignores messages), replace or add the following logic:
   ```js
   const SYSTEM_PROMPT = `You are FamCare, a Thai family health assistant. Help users manage medications, appointments, and health records for their elderly family members. Respond in Thai if the user writes in Thai, English if they write in English. Keep responses concise and friendly.`;

   async function getGeminiReply(userMessage) {
     try {
       const result = await geminiModel.generateContent(`${SYSTEM_PROMPT}\n\nUser: ${userMessage}`);
       return result.response.text();
     } catch (err) {
       console.error('Gemini error:', err);
       return 'ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง';
     }
   }
   ```

5. When a `message` event of type `text` is received, call `getGeminiReply(event.message.text)` and send the result back using the LINE client's `replyMessage` with the event's `replyToken`.

6. Ensure the fallback Thai error message (`ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง`) is sent (not thrown) when Gemini fails.

7. Add `GEMINI_API_KEY` to Railway environment variables (do this manually in the Railway dashboard or via Railway CLI — do not commit the key).

8. Run `cd famcare-backend && npm test` — confirm no existing tests broke.

## Test Commands

```bash
cd famcare-backend && npm test
```

Manual verification (requires deployed Railway instance + GEMINI_API_KEY set):
- Send "hello" to the LINE bot → expect an intelligent English reply
- Send "สวัสดี" to the LINE bot → expect a Thai reply
- Remove GEMINI_API_KEY temporarily → send a message → expect the fallback Thai error message, no crash

## Pass Criteria

- Send "hello" to bot → gets intelligent English reply
- Send "สวัสดี" to bot → gets Thai reply
- Gemini failure (bad key or network error) → fallback message sent via LINE, no server crash
- All existing Jest tests still pass
