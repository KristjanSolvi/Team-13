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
2. Select the closest available microphone. A lapel, headset, or directional
   microphone 15–30 cm from the speakers is preferable to a distant laptop mic.
3. Speak synthetic content for 20–30 seconds. A suggested Karen phrase is shown
   in the harness.
4. Confirm interim and final timestamped segments appear. If Corti detects poor
   speech quality, the harness says `Audio unclear · move closer`; candidate
   evidence from that interval is withheld from investigation.
5. Click **Stop** and wait for `Ended cleanly`; this waits for Corti's terminal
   stream event before releasing the microphone.

### Dictation smoke test

1. Use the separate Corti Dictation microphone control.
2. Select the closest microphone in the component settings, say the suggested
   receiving-team/deadline/urgency correction, and stop recording.
3. Confirm final words appear, then click **Build preview**.
4. Confirm the constrained patch is shown with the message that explicit
   clinician confirmation is still required.

The harness never sends a ledger command and cannot commit a clinical task.
Use synthetic patient details only. On macOS, Chrome may also need permission
under **System Settings → Privacy & Security → Microphone**.

Both paths enable Corti audio-quality events and reviewed synthetic keyterms.
Ambient additionally requests supported browser echo cancellation, noise
suppression, automatic gain control, and mono capture. Dictation always retains
typed editing as the corridor-safe fallback; noise handling never turns an
uncertain transcript into authorization.

The HTTP and event contracts are documented in [docs/api.md](docs/api.md).
Browser adapters consume scoped tokens from this service; they never receive the
Corti client secret.

## Integration boundary

- UI code imports the `./browser` entry or calls the documented HTTP endpoints.
- The agent/ledger consumes candidate drafts and confirmed revision commands.
- `buildIntegrationCandidateRequest` and `investigateCandidate` send the full
  evidence-backed candidate to `POST /api/candidates/investigate`; the
  integration API alone maps it to Agentic and holds the application bearer.
- `submitConfirmedTaskCorrection` sends a clinician-confirmed patch to the
  integration API. A Dictation preview alone never mutates task state.
- Tasks route to a receiving team first. A named person becomes accountable only
  by accepting the offer or through Developer 2's deterministic timeout policy.
- This service never writes committed thread/task state.
- `approvalId` is required before supporting document or coding calls.
- Live Corti verification requires credentials and tenant entitlements; local
  tests use dependency-injected gateways and make no external AI calls.
