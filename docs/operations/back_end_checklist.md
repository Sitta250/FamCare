2. Deploy backend first
Deploy to Railway (you're already set up for it) before touching frontend. You want a real live URL, not localhost, because:

LINE webhook requires a public HTTPS URL
Frontend needs a real API to connect to
Catches environment-specific bugs early (env vars, DB connection, etc.)

3. Test LINE bot end-to-end
With the deployed backend, test actual LINE push notifications with ngrok or your Railway URL. Reminders and webhook flows can't be fully verified locally.
4. Then frontend
Web dashboard (React/Next.js most likely). By this point your API contract is stable so frontend won't keep breaking due to backend changes.
5. LINE bot UI layer
Flex Messages, postback handlers, conversational flows — this is separate from the web dashboard and can be built in parallel or after.