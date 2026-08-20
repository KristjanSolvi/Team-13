# Backend delivery and referral integration

## Outcome

The Integration API remains the UI's only backend. It composes four independent
owners without copying their state:

- Agentic owns tasks, threads, approval, and verification;
- patient-profile owns the mutable patient profile and immutable referral
  snapshots;
- mock-ehr owns draft, filed, and historical documents;
- downstream-gateway owns provider delivery and readback.

## Approval and delivery

An approval first completes the existing Corti/Agentic publication. The
Integration API validates the authoritative returned task and creates one
downstream delivery using `delivery:<taskId>`. A referral may include a snapshot
ID; the BFF confirms that the snapshot belongs to the task's patient before
delivery. A retry repeats the orchestration with the same keys, so neither the
published task nor the provider item is duplicated.

## Readback and verification

The Integration API periodically asks the downstream gateway for pending
readbacks. Submission and acceptance remain non-terminal. A completed provider
readback is eligible only with an outcome reference and attributed
`downstream:` verifier. The reconciler writes that completion to the Agentic
ledger, then acknowledges it in the downstream store. Completed but
unacknowledged records remain pending. This ordering and stable idempotency key
make a crash between stores recoverable.

External verification may move offered, assigned, accepted, completed, or
escalated work directly to verified. It never fabricates a team member's
acceptance or owner-reported completion. Draft and terminal tasks are rejected.

## Demo deployment

The downstream adapter and EHR are explicitly synthetic. All private services
stay on Railway's private network and keep distinct bearer tokens. Agentic,
patient-profile, mock-ehr, and downstream-gateway each use a single replica with
its own persistent SQLite volume. The synthetic Karen profile is seeded only
when `PATIENT_PROFILE_SEED_SYNTHETIC_KAREN=true`; subsequent clinician edits are
never overwritten.
