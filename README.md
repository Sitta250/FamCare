# FamCare Repo Guide

This repository is organized for agent-friendly execution across product docs, implementation context, and execution plans.

## Start Here

1. Read [`AGENTS.md`](AGENTS.md) for repo-wide working rules.
2. Read [`famcare-backend/CLAUDE.md`](famcare-backend/CLAUDE.md) for backend implementation conventions.
3. Use [`docs/execution/STATUS.md`](docs/execution/STATUS.md) to find the active phase and active feature plan.

## Source-of-Truth Precedence

When docs disagree, use this order:

1. Runtime truth: backend code + [`famcare-backend/prisma/schema.prisma`](famcare-backend/prisma/schema.prisma)
2. Backend implementation contract: [`famcare-backend/CLAUDE.md`](famcare-backend/CLAUDE.md)
3. Product intent: [`docs/product/prd.md`](docs/product/prd.md)
4. Intentional divergence record: [`docs/decisions/DECISION_LOG.md`](docs/decisions/DECISION_LOG.md)
5. Historical execution docs: [`docs/execution/phases/`](docs/execution/phases/)

## Docs Map

- Product: [`docs/product/`](docs/product/)
- Architecture: [`docs/architecture/`](docs/architecture/)
- Decisions: [`docs/decisions/`](docs/decisions/)
- Operations: [`docs/operations/`](docs/operations/)
- Execution phases: [`docs/execution/phases/`](docs/execution/phases/)
- Feature plans: [`docs/execution/features/`](docs/execution/features/)
