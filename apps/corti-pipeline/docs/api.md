# Corti pipeline HTTP contract

Default development base URL: `http://127.0.0.1:8787`.

Every response includes `x-correlation-id`. The caller may supply a safe ID in
that header to correlate UI, agent, ledger, and pipeline activity. Error bodies
have a stable `code`, user-safe `message`, `retryable` flag, and correlation ID.

## Health

`GET /health`

Works without Corti credentials. It reports whether Corti-backed routes are
available and names missing environment variables without returning any values.

## Ambient

### Create interaction and scoped session

`POST /api/corti/ambient/session`

```json
{ "encounterIdentifier": "karen-demo" }
```

Returns the Corti `interactionId`, a short-lived `streams`-scoped token, token
lifetime, tenant/environment identifiers, and configured languages. The browser
adapter uses these values to connect directly to Corti. It never receives the
client secret.

### Refresh scoped token

`POST /api/corti/ambient/token`

Returns a new `streams`-scoped token. It does not create an interaction.

### Browser adapter

Import `AmbientCapture`, `startAmbientSession`, and `refreshAmbientToken` from
the package's `./browser` entry. `AmbientCapture.start()`:

1. Chooses a supported Opus format.
2. Connects with facts mode, single-mic diarization, and no transcript/fact
   retention.
3. Waits for Corti to accept the configuration.
4. Requests the microphone and starts recording.
5. Emits normalized transcript and usage events.

`stop()` stops the recorder, drains queued audio, sends the end frame, waits for
`ENDED`, then releases the socket and microphone. The UI must always show a
recording/consent indicator even though the rail otherwise stays quiet.

## Dictation

### Scoped token

`POST /api/corti/dictation/token`

Returns a short-lived `transcribe`-scoped token. This is deliberately separate
from Ambient.

### Browser component binding

`bindCortiDictation` configures the official `<corti-dictation>` component with:

- `authConfig`, including refresh callback
- Interim results
- Automatic punctuation
- Numerals above nine
- Abbreviated measurements

It emits `dictation.interim`, `dictation.final`, `usage.updated`, and safe error
events. A final transcript is still only input for a preview.

### Revision preview

`POST /api/corti/dictation/revision-preview`

```json
{
  "taskId": "task-karen-bp",
  "transcript": "Route to district nursing within 48 hours and mark urgent.",
  "recipientTeams": [
    {
      "id": "district-nursing",
      "label": "District Nursing Team",
      "aliases": ["district nursing"]
    }
  ],
  "owners": []
}
```

Only allow-listed team/owner labels become IDs. The deterministic prototype
parser supports:

- `assign to …` or `route to …`
- `owner is …`
- `within 1–168 hours`
- `mark urgent` or `mark routine`
- `change the action to …` or `action is …`
- trailing `because …` rationale

The response always has `requiresConfirmation: true`. Developer 2's ledger must
not accept this preview until the clinician confirms it.

## Candidate extraction

`POST /api/corti/candidates/generate`

Accepts `patientId`, `interactionId`, and normalized transcript `segments`.
Guided Documents returns at most three conservative candidate items with an
exact quote. The pipeline drops every generated item whose quote cannot be found
exactly within one final transcript segment. It does not assign an owner,
deadline, diagnosis, referral, or clinical plan. Developer 2 still checks the
record and ledger before proposing a thread.

## Supporting document

`POST /api/corti/documents/generate`

```json
{
  "approvalId": "approval-karen-1",
  "approvedClinicalText": "Clinician-approved context and action…",
  "documentType": "receiving-team-handoff"
}
```

Allowed document types:

- `clinical-note`
- `receiving-team-handoff`
- `patient-receipt`

Only clinician-approved text is accepted by contract. Output is always labeled
`draft`; the generator is instructed to omit missing information and never add a
diagnosis, owner, deadline, assurance, or completion status.

## Medical coding

`POST /api/corti/coding/predict`

```json
{
  "approvalId": "approval-karen-1",
  "approvedClinicalText": "Clinician-approved clinical prose…",
  "system": "icd10int-outpatient"
}
```

Allowed systems are the four identifiers verified by the installed SDK and
official coding skill:

- `icd10int-outpatient`
- `icd10int-inpatient`
- `icd10cm-outpatient`
- `icd10cm-inpatient`

The configured default is `icd10int-outpatient`. Confirm tenant entitlement
before the demo. The response preserves Corti's ordering and keeps `codes` and
`candidates` separate. Evidence is retained only when its context index and
inclusive/exclusive offsets reproduce the returned evidence text exactly.

## Ledger boundary

This service never emits committed lifecycle claims such as `thread.approved`,
`action.routed`, `action.accepted`, `action.completion_reported`,
`action.verified`, or `action.escalated`. Those belong to Developer 2. Pipeline
errors leave committed ledger state unchanged.
