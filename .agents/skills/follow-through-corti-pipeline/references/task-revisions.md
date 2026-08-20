# Task revision and ownership contract

This contract keeps editing convenient without weakening the human authority,
single-owner accountability, or audit trail of the Clinical Thread Ledger.

## Routing and ownership

- A task may be routed to a receiving team and notify several eligible people.
- Exactly one person is the accountable owner after acceptance.
- “Routed” is not “accepted.” “Accepted” is not “completed.” “Completion
  reported” is not “verified.” Keep those states visibly distinct.
- The first valid acceptance wins. A later accepter receives the current owner
  and an “already accepted” response rather than overwriting ownership.
- A receiver can decline with a reason; the task remains unresolved and returns
  to the appropriate queue or escalation path.

Suggested ledger-owned lifecycle:

```text
draft → awaiting clinician approval → routed → accepted
      → completion reported → verified
      → overdue/escalated
      → declined/reassigned/reopened
```

The exact state machine belongs to Developer 2. Developer 1 supplies only
transcript evidence and revision drafts.

## Typed edit

```text
UI edit fields
  → validate locally
  → preview changed fields
  → clinician confirms
  → ledger command
  → ledger appends audit event
```

Typed editing does not call Corti unless the team deliberately requests a
supporting text-generation operation. It is primarily a UI-to-ledger path.

## Dictated edit

```text
Clinician selects “edit by dictation”
  → separate Corti Dictation session starts
  → interim text is displayed but never applied
  → final transcript is parsed into a constrained TaskRevisionDraft
  → UI shows transcript plus field-level preview
  → clinician edits or confirms
  → ledger command
  → ledger appends audit event
```

Dictation must not be the only editing path; ward corridors are noisy and the
default approval path should remain one tap. A final transcript is evidence of
what was intentionally said, not authorization to write by itself.

## What can change

Before approval, the clinician may edit the draft action, receiving team,
deadline, clinical urgency, or rationale. Individual ownership is deliberately
not part of this draft: the task is offered to the team, then one eligible
person accepts it. After routing, changes must append an audit event and preserve
the previous value.

Recommended fields:

- Structured action description
- Receiving team
- Deadline
- Clinical urgency: `high`, `medium`, or `routine`
- Clinical rationale or comment
- Revision reason

Structured fields drive deadlines and escalation. Comments explain decisions but
must not silently override structured values.

After completion is reported, a correction should reopen or create a revision
with a reason. It must not rewrite history. Clinical-plan changes require
clinician confirmation; a receiving team member may propose one but not commit it
as clinical truth.

## Manual additions

Two addition paths are allowed:

1. **Add from conversation:** select a real transcript span. Store the exact
   quote, timestamp, interaction ID, speaker if available, and label the item
   `clinician-added`.
2. **Add manually:** enter a task without conversational evidence. Label it
   `clinician-entered`; never fabricate a quote or timestamp.

The agent may suggest an overlooked item or revision, but it never mutates a
committed task. Every suggestion returns to the same preview and confirmation
boundary.

## Permissions

| Actor | Allowed behavior |
|---|---|
| Clinician | Approve/dismiss, change clinical action, team routing, deadline, urgency, explicitly reassign after publication, and reopen with a reason |
| Receiving team member | Accept/decline, comment, report completion, and propose a clinical change |
| Thread Resolution Agent | Retrieve context, propose drafts, call approved tools after authorization, verify recorded status, and escalate by policy |
| Pipeline | Capture and normalize speech, generate previewable drafts, and provide evidence; never commit ledger state |
| System clock/policy | Derive overdue or verification-failed status from recorded state; never invent completion |

## Karen MVP decision

Use one primary tracked task for the live Karen branch: a district-nursing blood
pressure check with an approved team route and deadline. A district nurse
becomes the single accountable owner only after accepting. A GP message can be a
supporting handoff rather than a second tracked task. This keeps the success
condition clear.

If the product later tracks both actions, the parent thread closes only after
both are independently verified. One green child action must never make the
whole patient row appear resolved while another remains open.
