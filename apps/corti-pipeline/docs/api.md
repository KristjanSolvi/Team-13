# Corti pipeline HTTP contract

Default development base URL: `http://127.0.0.1:8787`.

Every response includes `x-correlation-id`. The caller may supply a safe ID in
that header to correlate UI, agent, ledger, and pipeline activity. Error bodies
have a stable `code`, user-safe `message`, `retryable` flag, and correlation ID.
Normalized pipeline events include `schemaVersion: "1"` and a unique `eventId`.

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
3. Enables Corti audio-quality events and a small reviewed keyterm list.
4. Waits for Corti to accept the configuration.
5. Requests the selected microphone with every supported browser speech-audio
   control: echo cancellation, noise suppression, automatic gain control, and
   mono capture.
6. Emits normalized transcript, quality, and usage events.

Speech-quality issue windows mark overlapping transcript segments
`audioQuality: "uncertain"`. Candidate extraction may retain those words for
review, but must not turn them into an Agentic signal.

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
- Corti audio-quality events
- A small reviewed keyterm list
- Numerals above nine
- Abbreviated measurements

It emits `dictation.interim`, `dictation.final`, `usage.updated`, and safe error
events. A final transcript is still only input for a preview.

### Revision preview

`POST /api/corti/dictation/revision-preview`

```json
{
  "taskId": "task-karen-bp",
  "expectedVersion": 1,
  "idempotencyKey": "correct-karen-001",
  "transcript": "Route to district nursing within 48 hours and mark medium.",
  "recipientTeams": [
    {
      "id": "district-nursing",
      "label": "District Nursing Team",
      "aliases": ["district nursing"]
    }
  ]
}
```

Only allow-listed receiving-team labels become IDs. Named ownership is not a
pre-publication Dictation field: the team receives the task first, then one
eligible person accepts it. The deterministic prototype parser supports:

- `assign to …` or `route to …`
- `within 1–168 hours`
- `mark high`, `mark medium`, or `mark routine`; natural `mark urgent` maps to
  `high`
- `change the action to …` or `action is …`
- trailing `because …` rationale

The patch uses Developer 2's field names directly: `summary`, `targetTeamId`,
`clinicalUrgency`, and `dueInMs`. The response always has
`requiresConfirmation: true`. Developer 2's ledger must not accept this preview
until the clinician confirms it.

## Candidate extraction

`POST /api/corti/candidates/generate`

Accepts `patientId`, `interactionId`, and normalized transcript `segments`.
Guided Documents returns at most one consolidated, conservative candidate with
an exact quote. The pipeline drops every generated item whose quote cannot be found
exactly within one final transcript segment or whose span overlaps a Corti
speech-quality issue. It does not assign an owner,
deadline, diagnosis, referral, or clinical plan. Developer 2 still checks the
record and ledger before proposing a thread.

Each retained evidence item carries the exact quote, `segmentKey`, timestamps,
speaker when available, and audio-quality state. The pipeline does not invent a
second opaque evidence identifier; the integration service owns any mapping
needed by the internal Agentic/MCP contract.

## Integration API handoff

`buildIntegrationCandidateRequest(candidate)` validates the final handoff and
returns the body and correlation ID for:

```text
POST http://<integration-api>/api/candidates/investigate
x-correlation-id: corr-karen-1
body: FollowThroughCandidate
```

`investigateCandidate` performs that browser call. The integration API validates
the candidate, creates the internal Agentic signal shape, and keeps the Agentic
application bearer out of the browser. The pipeline must not call
`POST /api/signals` directly.

`buildTaskCorrectionCommand(preview.draft)` flattens a preview into the exact
body accepted by the integration API. Only after the clinician confirms it,
`submitConfirmedTaskCorrection` sends it to
`POST /api/tasks/:taskId/correct` with `x-actor-id` and the shared
`x-correlation-id`. The integration and Agentic services own the mutation.

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
The pipeline also rejects a generated draft that implies an unapproved lifecycle
state such as created, sent, assigned, accepted, completed, or verified.

The browser package exports `generateSupportingDocument`. It requires the same
explicit `approvalId`, approved text, document type, and end-to-end correlation
ID. The developer evaluator uses a visibly synthetic approval ID; the integrated
product must use the stable identifier returned by the Agentic approval record.

## Grounded patient handover renderer

`POST /api/corti/handovers/render`

This internal integration boundary accepts only the canonical packet already
validated by the Agentic service. The handover ID must be a UUID and the
snapshot hash must use `sha256:<64 lowercase hex characters>`.

```json
{
  "handoverId": "33333333-3333-4333-8333-333333333333",
  "patientId": "synthetic-karen",
  "sourceSnapshotHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "packet": {
    "situation": [
      {
        "statement": "Karen reports dizziness after the medication change.",
        "sourceRefs": ["encounter:sentence-42"]
      }
    ],
    "background": [
      {
        "statement": "The medication was changed yesterday.",
        "sourceRefs": ["record:medication-1"]
      }
    ],
    "currentConcerns": [],
    "outstandingTasks": [
      {
        "taskId": "11111111-1111-4111-8111-111111111111",
        "threadId": "22222222-2222-4222-8222-222222222222",
        "summary": "Check blood pressure",
        "state": "accepted",
        "targetTeamId": "district-nursing",
        "assignedMemberId": "nurse-7",
        "clinicalUrgency": "medium",
        "acceptBy": "2026-08-20T12:00:00.000Z",
        "dueBy": "2026-08-22T10:00:00.000Z",
        "version": 7,
        "sourceRefs": [
          "task:11111111-1111-4111-8111-111111111111@7",
          "thread:22222222-2222-4222-8222-222222222222@3"
        ]
      }
    ],
    "awaitingVerification": [],
    "escalations": [],
    "unknowns": ["The current medication list is unavailable."]
  }
}
```

Text Generation receives only the three narrative sections and their source
references. The pipeline rejects generated references from a different
narrative section, operational task/version refs used as clinical evidence,
unsupported clinical or lifecycle claims, and malformed or empty generated
output. Task state, team, owner, urgency, acceptance deadline, and due deadline
are appended locally from the packet with no model involvement. Unknowns are
also copied locally and exactly; their empty `sourceRefs` explicitly mean
unavailable input, not evidence for a clinical conclusion.

```json
{
  "title": "Current patient handover",
  "sections": [
    {
      "sectionId": "situation",
      "heading": "Situation",
      "statements": [
        {
          "statement": "Karen reports dizziness after the medication change.",
          "sourceRefs": ["encounter:sentence-42"]
        }
      ]
    },
    {
      "sectionId": "background",
      "heading": "Background",
      "statements": [
        {
          "statement": "The medication was changed yesterday.",
          "sourceRefs": ["record:medication-1"]
        }
      ]
    },
    {
      "sectionId": "outstanding-tasks",
      "heading": "Outstanding tasks",
      "statements": [
        {
          "statement": "Check blood pressure — state: accepted; team: district-nursing; owner: nurse-7; urgency: medium; accept by: 2026-08-20T12:00:00.000Z; due by: 2026-08-22T10:00:00.000Z.",
          "sourceRefs": [
            "task:11111111-1111-4111-8111-111111111111@7",
            "thread:22222222-2222-4222-8222-222222222222@3"
          ]
        }
      ]
    },
    {
      "sectionId": "unknowns",
      "heading": "Unknowns",
      "statements": [
        {
          "statement": "The current medication list is unavailable.",
          "sourceRefs": []
        }
      ]
    }
  ],
  "creditsConsumed": 0.04
}
```

When all three narrative sections are empty, the pipeline does not invoke Text
Generation. It returns only deterministic task and unknown sections and reports
`creditsConsumed: 0`.

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

The browser package exports `predictMedicalCodes`. The Karen evaluator runs it
in parallel with document generation so either call can fail without fabricating
or removing the successful result.

## Developer evaluation

The harness build contains two pages:

- `/`: real Ambient and separate Dictation microphone paths.
- `/evaluation.html`: disclosed Karen transcript fallback, live candidate Text
  Generation, exact-evidence checks, explicit synthetic approval, supporting
  document, and Medical Coding review.

The evaluator is a boundary test, not a substitute for the Agentic lifecycle.
It exposes no ledger mutation route. See [testing.md](testing.md) for the full
acceptance procedure.

## Ledger boundary

This service never emits committed lifecycle claims such as `thread.approved`,
`action.routed`, `action.accepted`, `action.completion_reported`,
`action.verified`, or `action.escalated`. Those belong to Developer 2. Pipeline
errors leave committed ledger state unchanged.
