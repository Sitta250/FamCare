# Repo rules

## Commands
- Install: `cd famcare-backend && npm install`
- Dev: `cd famcare-backend && npm run dev`
- Start: `cd famcare-backend && npm start`
- Schema check: `cd famcare-backend && npm run check`
- Unit tests: `cd famcare-backend && npm test`
- Unit tests (watch): `cd famcare-backend && npm run test:watch`

## Conventions
- Use JavaScript (ESM) for backend code
- No new dependencies without asking
- Reuse existing API patterns
- Keep changes minimal
- Add tests for all new behavior

## Done means
- Relevant tests pass
- Prisma schema validates (`npm run check`)
- Include summary of changed files and open issues