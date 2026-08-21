# Ward Companion UI

The product shell for Follow-Through: a calm ward rail and bed board that turns
evidence from clinical conversations into clinician-reviewed, trackable work.

This directory began as the Lovable prototype from
[`YaldesDev/ward-companion`](https://github.com/YaldesDev/ward-companion) and is
imported into the submission repository with Git subtree history. It is now
being connected to the real Corti pipeline and the shared integration API. The
visual shell, patient records, Nervecentre screen, staffing information, tasks,
and historical activity are synthetic demo fixtures; they are not a live EHR.

## Current live boundary

- `Corti Ambient` uses the real browser microphone adapter from
  `apps/corti-pipeline` and shows transcript and audio-quality events. Browser
  requests use the same-origin `/follow-through-api` boundary; Vite proxies it
  locally and the built Railway server proxies it in production.
- Final transcript evidence is sent to the pipeline's conservative candidate
  generator.
- Evidence-backed candidates are sent to the integration API for record and
  open-work checks. A candidate is not a task and does not authorize action.
- Expanded task cards offer the official Corti Dictation control plus a typed
  corridor fallback. Both produce a constrained change preview; fixture tasks
  cannot be mutated because they have no authoritative ledger version.
- If the integration/agent service is unavailable, the UI retains the
  candidate without creating local work.
- A successful companion read replaces that patient's demo rows with the
  authoritative Agentic/MCP projection, including versions and valid commands.
  Failed reads retain rows that are visibly labelled `demo fixture`.
- Nervecentre, inbox, district-nursing, and task-system behavior is simulated;
  no external clinical system is connected.

## Local development

Use Node.js 22 or newer. Keep all credentials in ignored `.env` files; no Corti
secret or Agentic bearer token belongs in this browser application.

```bash
# Terminal 1 — Corti pipeline (port 8787)
cd apps/corti-pipeline
cp .env.example .env  # once, then add the event credentials
npm install
npm run dev

# Terminal 2 — browser-facing integration API (port 8790)
cd apps/integration-api
cp .env.example .env
npm install
npm run dev

# Terminal 3 — UI (Lovable config currently selects port 8080)
cd apps/ward-companion
cp .env.example .env  # optional; blank VITE value uses the same-origin proxy
npm install
npm run dev

# Terminal 4 — Agentic/MCP backend (port 3000, required for context/ledger work)
# From the Team-13 repository root
npm install
npm run dev
```

Without the Agentic HTTP service, Ambient and Dictation remain available through
the integration proxy, while context checks and ledger reads fail closed. This
is safer than manufacturing a task in browser state.

Checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## Updating the Lovable source

The team repository is canonical. Fetch and inspect upstream before importing a
new Lovable change, then pull it as a squash subtree commit from a clean branch:

```bash
git fetch ward-ui main
git subtree pull --prefix apps/ward-companion ward-ui main --squash
```

Do not push this feature branch to the Lovable repository's `main`. Product
integration commits belong in the Team-13 repository.
