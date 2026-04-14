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

## Documentation Navigation
- Repo map: `README.md`
- Active execution status: `docs/execution/STATUS.md`
- Feature plans: `docs/execution/features/`
- Phase history: `docs/execution/phases/`
- Product/architecture context: `docs/product/` and `docs/architecture/`

## Source of Truth Priority
1. Runtime code and schema (`famcare-backend/prisma/schema.prisma`)
2. Backend implementation contract (`famcare-backend/CLAUDE.md`)
3. Product intent (`docs/product/prd.md`)
4. Drift and decisions (`docs/decisions/DECISION_LOG.md`)
5. Historical execution plans (`docs/execution/phases/`)

## Done means
- Relevant tests pass
- Prisma schema validates (`npm run check`)
- Include summary of changed files and open issues