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

## Live microphone harness

The developer-only harness exercises the real browser microphone paths without
depending on the product rail or ward board. Run the pipeline and harness in
separate terminals:

```bash
# Terminal 1
cd apps/corti-pipeline
npm run dev

# Terminal 2
cd apps/corti-pipeline
npm run dev:harness
```

Open <http://127.0.0.1:5173> in Chrome and allow microphone access. The header
must say `Pipeline live · Corti configured` before testing.

### Ambient smoke test

1. Click **Start ambient** and confirm the status becomes `Recording`.
2. Speak synthetic content for 20–30 seconds. A suggested Karen phrase is shown
   in the harness.
3. Confirm interim and final timestamped segments appear.
4. Click **Stop** and wait for `Ended cleanly`; this waits for Corti's terminal
   stream event before releasing the microphone.

### Dictation smoke test

1. Use the separate Corti Dictation microphone control.
2. Say the suggested routing/deadline correction and stop recording.
3. Confirm final words appear, then click **Build preview**.
4. Confirm the constrained patch is shown with the message that explicit
   clinician confirmation is still required.

The harness never sends a ledger command and cannot commit a clinical task.
Use synthetic patient details only. On macOS, Chrome may also need permission
under **System Settings → Privacy & Security → Microphone**.

The HTTP and event contracts are documented in [docs/api.md](docs/api.md).
Browser adapters consume scoped tokens from this service; they never receive the
Corti client secret.

## Integration boundary

- UI code imports the `./browser` entry or calls the documented HTTP endpoints.
- The agent/ledger consumes candidate drafts and confirmed revision commands.
- This service never writes committed thread/task state.
- `approvalId` is required before supporting document or coding calls.
- Live Corti verification requires credentials and tenant entitlements; local
  tests use dependency-injected gateways and make no external AI calls.
