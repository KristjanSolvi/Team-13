# Follow-Through Corti pipeline

Developer 1's isolated TypeScript service for Corti authentication, Ambient
session setup, Dictation authentication, Text Generation, Medical Coding, and
normalized handoff contracts.

It deliberately does not own the Thread Resolution Agent, MCP tools, Clinical
Thread Ledger, task assignment state, verification, escalation, or product UI.

## Local setup

```bash
cd apps/corti-pipeline
cp .env.example .env
npm install
npm run dev
```

Keep real Corti credentials only in the ignored `.env` file. The service will
start without credentials so contract tests and the health route still work;
Corti-backed endpoints return a safe configuration error until credentials are
present.

## Commands

```bash
npm run typecheck
npm test
npm run build
```

The HTTP and event contracts are documented in `docs/api.md`. Browser adapters
will consume scoped tokens from this service; they must never receive the Corti
client secret.
