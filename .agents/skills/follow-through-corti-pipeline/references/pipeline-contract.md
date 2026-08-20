# Corti pipeline contract

This document is the Developer 1 integration boundary. It describes stable
domain data passed to the agent/ledger and UI; it is not a database schema and
does not grant the pipeline authority to commit clinical tasks.

## Ownership boundary

| Concern | Owner | Pipeline responsibility |
|---|---|---|
| Corti credentials and interaction lifecycle | Developer 1 | Implement server-side authentication, scoped browser tokens, creation, streaming, stop, and cleanup |
| Ambient and Dictation STT | Developer 1 | Normalize transcript events and preserve provenance |
| Text Generation and Medical Coding | Developer 1 | Produce reviewable drafts and evidence-linked suggestions |
| Thread investigation and MCP calls | Developer 2 | Consume candidates; check record and ledger context |
| Draft/committed task state, assignment, verification, escalation | Developer 2 | Own the state machine and all writes |
| Rail, board, detail, and editing UI | Developer 3 | Consume normalized events and call documented commands |
| Clinical wording and scope decisions | Clinical/product lead | Approve templates, fixtures, and claims |

The pipeline may propose. Only the clinician-controlled ledger boundary may
commit. A successful transcript or model response must never imply that a task
was created, assigned, completed, or verified.

## End-to-end shape

```text
Browser microphone
  → scoped Ambient stream
  → canonical transcript segments
  → conservative candidate draft
  → Developer 2 context and ledger checks
  → clinician review
  → optional scoped Dictation revision
  → structured revision preview
  → clinician confirmation
  → Developer 2 ledger commit
  → approved documentation and coding support
```

## Authentication and lifecycle

- Create the full Corti client only on the server.
- Keep Corti client credentials and full access tokens out of browser bundles,
  logs, screenshots, and error payloads.
- Provide separate backend token routes for the minimum browser scopes:
  `streams` for Ambient and `transcribe` for Dictation.
- Create and retain the Corti Ambient `interactionId` server-side. Map it to the
  application patient/session identifier without conflating it with Agentic
  `contextId`.
- Wait for the stream configuration to be accepted before recording.
- On stop, stop the recorder, signal end, wait for the stream's terminal event,
  then close and release media resources. Preserve the last final segment.
- Surface token refresh and expiration as recoverable events; never silently
  switch to a broader token.

## Ambient transcript normalization

Corti stream transcript messages contain an array. Every transcript item in an
interaction can share the interaction ID, so it is not a unique segment key.
Normalize and merge by time and stable content, tolerate reordering, and do not
append the whole array on every event.

```ts
type TranscriptSegment = {
  interactionId: string;
  segmentKey: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  speakerId?: number;
  isFinal: boolean;
  audioQuality?: "clear" | "uncertain";
};

type EvidenceReference = {
  interactionId: string;
  segmentKey: string;
  sourceQuote: string;
  startSeconds: number;
  endSeconds: number;
  speakerId?: number;
  audioQuality: "clear" | "uncertain";
};
```

`segmentKey` is an application key derived deterministically from the canonical
segment fields; it is not a Corti identifier. The canonical transcript is the
ordered set of final normalized segments retained by the backend.

Before showing an evidence quote:

1. Resolve the referenced interaction and time window.
2. Exact-match `sourceQuote` against canonical transcript text.
3. If there is no exact match, omit the quote or mark evidence unavailable.
4. Never replace a failed match with a plausible paraphrase.

Enable Corti audio-quality events. Mark final segments that overlap a detected
speech-quality issue `uncertain`; retain them as visible transcript but do not
use them as evidence for an Agentic signal. Browser noise suppression and key
terms improve recognition but never replace this fail-closed rule.

## Candidate handoff

Text Generation can help structure a conservative candidate after the live
transcript is stable. This is a draft for Developer 2's context checks, not a
thread, diagnosis, referral, or instruction.

```ts
type FollowThroughCandidate = {
  schemaVersion: "1";
  candidateId: string;
  correlationId: string;
  interactionId: string;
  patientId: string;
  category:
    | "symptom"
    | "medication-concern"
    | "investigation"
    | "referral"
    | "follow-up"
    | "social-barrier";
  summary: string;
  evidence: EvidenceReference[];
  status: "candidate";
};
```

Rules:

- Require at least one validated evidence reference.
- Keep `summary` factual and close to the patient's words.
- Candidate generation does not select an action, team, owner, deadline, or
  urgency. Developer 2's context-checking agent owns the non-actionable task
  proposal.
- Developer 2 checks whether the concern is already covered, contradicted,
  assigned, or open before anything appears as a proposed thread.
- Rejecting a candidate has no ledger side effect.

The browser/UI sends the complete normalized candidate to the integration API:

```text
POST /api/candidates/investigate
x-correlation-id: <candidate correlationId>
body: FollowThroughCandidate
```

The integration service owns mapping this candidate to Developer 2's internal
`POST /api/signals` command and owns the Agentic bearer token. The pipeline must
not call Agentic directly. Keep the complete evidence object in the candidate;
the integration service may derive opaque internal evidence references, but the
pipeline must not invent a competing identifier or flatten away the quote,
segment key, timestamps, speaker, or audio-quality state.

## Dictation normalization

Dictation is a separate, intentional correction channel. Read component event
payloads from `event.detail.data`, distinguish interim from final results, and
use `authConfig` with a refresh function as required by the official skill.

```ts
type TaskRevisionDraft = {
  taskId: string;
  expectedVersion: number;
  idempotencyKey: string;
  inputMethod: "typed" | "dictated";
  transcript?: string;
  patch: {
    summary?: string;
    targetTeamId?: string;
    clinicalUrgency?: "high" | "medium" | "routine";
    dueInMs?: number;
  };
  reason?: string;
};
```

The pipeline parses a final dictation into this constrained patch, returns both
the transcript and preview, and waits. The UI must request explicit clinician
confirmation before sending the patch to Developer 2's ledger command.

After confirmation, send the flattened patch through the integration API at
`POST /api/tasks/:taskId/correct`, with the clinician identity in `x-actor-id`
and the same end-to-end correlation ID in `x-correlation-id`. The pipeline must
not call the Agentic task route directly.

The task is offered to `targetTeamId` first. Dictation must not name an
individual owner before publication; one eligible team member becomes the
accountable owner by accepting, or through Developer 2's deterministic timeout
policy.

## Text Generation

- Run server-side and send only the context needed for the requested output.
- Prefer schema-constrained, short outputs over free-form clinical prose.
- Generate supporting content only from approved inputs: concise explanation,
  handoff wording, patient wording, or note section.
- Mark model output as draft until approved.
- Do not require live FactsR events for the demo; they can arrive too slowly for
  the five-minute path.
- Keep a disclosed preloaded output for demo recovery, while still showing live
  STT functioning.

## Medical Coding

Call coding on approved clinical prose, not raw conversational noise or rejected
candidates. Keep these response concepts separate:

- `codes`: supported suggestions
- `candidates`: items requiring human review
- `evidence`: returned text spans
- `alternatives`: possible alternatives, not selected truth

Treat evidence offsets as `start` inclusive and `end` exclusive, validate them
against the exact submitted text, and fail closed when they do not align. Select
only a coding system proven to be enabled in the hackathon tenant; do not invent
or promise Danish SKS, SNOMED CT, or another system before the entitlement smoke
test.

## Normalized events

Developer 3 should consume a stable envelope rather than raw SDK messages:

```ts
type PipelineEvent<T> = {
  schemaVersion: "1";
  eventId: string;
  type:
    | "ambient.started"
    | "transcript.interim"
    | "transcript.final"
    | "ambient.ended"
    | "audio.quality_changed"
    | "candidate.proposed"
    | "candidate.rejected"
    | "dictation.interim"
    | "dictation.final"
    | "document.generated"
    | "coding.completed"
    | "usage.updated"
    | "pipeline.error";
  occurredAt: string;
  correlationId: string;
  interactionId?: string;
  payload: T;
};
```

Developer 2 owns ledger lifecycle events such as `thread.approved`,
`action.routed`, `action.accepted`, `action.completion_reported`,
`action.verified`, and `action.escalated`. The pipeline may relay them for a
shared transport but must not fabricate them.

## Failure semantics

- A pipeline error leaves committed ledger state unchanged.
- Every error contains a safe code, correlation ID, retryability flag, and
  user-safe message; it never contains credentials or raw tokens.
- Retrying candidate generation or coding must be idempotent from the UI's point
  of view.
- If an API is unavailable during the demo, disclose and load the matching
  precomputed artifact. Never present cached output as a live call.
