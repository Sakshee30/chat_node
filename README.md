# chat_node

Node.js / TypeScript migration of [ooarchitect92/Chat](https://github.com/ooarchitect92/Chat).

> **Migration in progress: NOT feature-complete and NOT production-ready.**
> The source repository is unchanged. A passing liveness check is not proof of feature parity.

## Current implementation

- Fastify TypeScript application skeleton
- `GET /health/live` (same JSON as the Python service)
- `GET /health/ready` (PostgreSQL / Redis / NVIDIA checks; always 503 until the whole platform is verified)
- `GET /metrics` (Prometheus metrics endpoint with request count, latency histograms, and Node.js process metrics; no sensitive route/user labels)
- HTTP security response headers, deterministic injected-probe tests
- GitHub Actions CI for type checking, tests, and compilation
- Python `security.py` token/JWT generation and verification, Argon2 password hashing/verification, API key generation and fingerprinting converted to Node.js TypeScript with unit tests (not wired into authentication endpoints yet)
- Agent-purpose PostgreSQL query helpers and scoped authorization/delegation policy converted and unit-tested
- Telegram manager request-validation and configuration security logic converted and unit-tested; its transactional event processor, deduplication, connection provisioning, and HTTP endpoints are **not** ported yet
- Telegram Bot API transport client (getMe, managed bot methods, webhooks, callbacks, text delivery, retryability and chunking) converted to TypeScript with mocked-network tests; this client is not wired to any production channel worker
- Redis rate limits and refresh-session family lifecycle ported from Python using compatible Redis keys/Lua scripts; fail-open memory fallback and fail-closed behavior unit-tested (not wired into live auth yet)

**Imported unchanged:** The existing React frontend (568 source/repository files), website (197 files), and website-platform (46 files) have been copied from the source repository. The frontend has passed its TypeScript build in CI, but its full test suite currently fails and backend integration has not been verified.\n\n**Not yet ported:** Authentication, agents, RAG, PostgreSQL schemas/migrations, education, Telegram/WhatsApp, CRM, CMS, analytics, queues/workers, production deployments, end-to-end tests, and the remaining Python backend business logic.

## Start locally

Use Node.js 22+.

```bash
cd backend
cp .env.example .env
npm install
npm run typecheck
npm test
npm run dev
# GET http://127.0.0.1:3001/health/live
# GET http://127.0.0.1:3001/health/ready  (503 by design)
```

Set `DATABASE_URL`, `REDIS_URL`, and (if needed) `NVIDIA_API_KEY` in the environment to test dependency connectivity. Do not commit actual values.

## Non-negotiable migration acceptance criteria

1. Inventory every source route, input/output schema, status code, cookie, policy, worker, environment variable, and migration.
2. Preserve the existing UI; migrate the existing Python domain services to Node.js/TypeScript with equivalent behavior, not placeholder endpoints.
3. Preserve existing PostgreSQL schema and data, tenant isolation, transaction boundaries, indices, pgvector operations, and permission checks. Never run destructive schema changes against live data.
4. Preserve authentication, encryption, security, audit logging, idempotency, webhooks, and rate limits.
5. Preserve RabbitMQ / Kafka / Redis background processes and retries, dead-letter semantics and event idempotency.
6. Run equivalent integration and E2E tests against seeded environments, compare original vs new API behavior, and verify every feature.
7. Switch readiness to successful only after migration completion and required services are operational.

**Do not deploy this scaffold as a replacement for the Python backend.**
