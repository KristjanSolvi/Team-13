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
  `apps/corti-pipeline` and shows transcript and audio-quality events.
- Final transcript evidence is sent to the pipeline's conservative candidate
  generator.
- Evidence-backed candidates are sent to the integration API for record and
  open-work checks. A candidate is not a task and does not authorize action.
- If the integration/agent service is unavailable, the UI retains the
  candidate without creating local work.
- Existing board rows and activity controls are demo fixtures until they are
  replaced with the authoritative Agentic/MCP overview and command endpoints.
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

# Terminal 2 — UI (normally port 5173)
cd apps/ward-companion
cp .env.example .env  # optional; blank VITE values use same-origin proxies
npm install
npm run dev
```

For candidate investigation, also run the integration API on port 8790 and the
Agentic/MCP backend on port 3000. Until the teammate's Agentic HTTP routes are
implemented, investigation will visibly fail closed; this is expected and is
safer than manufacturing a task in browser state.

```bash
# Terminal 3
cd apps/integration-api
cp .env.example .env
npm install
npm run dev

# Terminal 4
cd ../..
npm install
npm run dev
```

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
