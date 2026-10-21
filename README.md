# chat_node

Node.js / TypeScript migration workspace.

> **Status: initial scaffold only.** This repository is NOT a complete migration of the private Python source. No original private source files have been copied here. The source repository must remain unchanged.

## Run

```bash
cd backend
npm install
npm run dev
# health: http://localhost:3001/health/live
npm test
```

## Migration quality gates

- Keep the original project untouched.
- Keep this destination private before transferring any private source, credentials, or proprietary artifacts.
- Inventory existing API endpoints and request/response shapes, including /api/v1 and /v1 compatibility.
- Port business logic and tenant isolation module by module, preserving contracts.
- Port database schema and historical migration semantics without data loss.
- Port all asynchronous workers, event consumers and integrations.
- Preserve the React frontend and verify its compatibility with the new API.
- Match original auth, security, audit, rate-limit and isolation behavior.
- Run parity, integration, security and end-to-end tests before replacing production runtime.

**Do not deploy the scaffold as a replacement for the Python backend.**
