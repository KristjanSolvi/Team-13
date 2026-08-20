# Follow-Through demo flow

The demo tells one patient story through one underlying ledger. The rail and ward
board are two views of the same state, not separate products.

## Clinical fixtures

Use fictional or organizer-approved synthetic details and minimize identifiers
in source, logs, screenshots, and public builds.

- **Karen:** live success branch. During a discharge-focused ward round, she
  mentions dizziness since a medication change and uncertainty about who will
  check her blood pressure.
- **Ib Sørensen:** preloaded failure branch. A callback about scan results was
  promised for “tomorrow,” but the simulated downstream call log still has no
  completion three days later.
- Other ward rows are compact fixtures used only to show the board roll-up.

## Karen success branch

1. **Quiet capture.** Start Corti Ambient and show a persistent recording and
   consent indicator. Do not require the clinician to operate the rail during
   the conversation.
2. **Conservative detection.** The pipeline retains Karen's exact sentence and
   timestamp. Developer 2's agent checks the synthetic record and ledger for an
   existing owner before proposing anything.
3. **Light human review.** At a natural pause, the rail shows one dotted-grey
   `awaiting review` item with exact evidence and a proposal from an approved
   template: district-nursing blood-pressure check within 48 hours.
4. **Approve or correct.** The fast path is one-tap approval. To demonstrate
   Corti Dictation, choose `edit by dictation`, say a substantive owner or
   deadline correction, inspect the structured preview, then confirm.
5. **Route and accept.** The mock District Nursing Team receives the task.
   Several eligible people may be notified; one accepts and becomes the single
   accountable owner. The ring becomes part-filled blue and says `tracking`.
6. **Simulated time jump.** Advance the fixture 48 hours. The mock downstream
   system reports completion; the agent reads it back, and the ledger records
   verified downstream status. The ring closes green with a check.

Say “verified downstream system status,” not “verified the real-world outcome.”
Clearly label the task system and time jump as simulated.

## Ib escalation branch

1. Open Ib's preloaded callback thread.
2. Show the original promise, deadline, accountable owner, and activity history.
3. Advance to three days after the promised callback.
4. The agent checks the simulated call log and finds no completion record.
5. The ledger appends an overdue/escalated event; the ring becomes broken red
   with an exclamation mark.
6. Use one visible action: reassign and reopen. If Dictation was not shown in
   Karen's branch, demonstrate it here with a substantive revision.

This is the strongest reveal: the system catches its own recorded workflow
failure instead of merely claiming that a task was created.

## Ward board

Show the same ledger rolled up by bed:

- Escalated or blocked threads sort first.
- Awaiting review, tracking, and verified states use the same icon, word, and
  ring grammar as the bedside rail.
- Multiple thread chips remain separate; the row summary reflects the
  highest-priority unresolved state.
- Use “No tracked follow-through blockers,” never “ready” or “clear for
  discharge.” The board supports, but does not make, the discharge decision.

## Five-minute run of show

| Time | Beat | Corti/product proof |
|---|---|---|
| 0:00–0:25 | Problem and promise | A sentence can be documented yet still not happen |
| 0:25–1:05 | Karen live ward-round snippet | Ambient STT and exact evidence |
| 1:05–1:45 | Candidate and context check | Conservative proposal, not an autonomous action |
| 1:45–2:20 | Human authority | One-tap approval or separate Dictation correction with preview |
| 2:20–2:55 | Route and accept | Team notification, one accountable owner, shared ledger update |
| 2:55–3:25 | Karen time jump | Simulated completion and verified downstream status |
| 3:25–4:15 | Ib failure branch | Missed deadline, automatic check, visible escalation and reopen |
| 4:15–4:40 | Ward board | Same state summarized across six beds |
| 4:40–5:00 | Close | “Other systems remember what was said. Follow-Through remembers what still needs to happen.” |

Text Generation and Medical Coding are supporting proof points after clinician
approval. Do not let either interrupt the central action-and-verification story.

## Demo resilience

- Live-show Ambient and Dictation functioning.
- Preload the longer transcript and downstream artifacts as disclosed fallback
  fixtures.
- Do not wait for a live FactsR event.
- Keep one correlation ID through pipeline, agent, ledger, and UI logs.
- Rehearse expired token, microphone denial, malformed generated output, coding
  unavailable, duplicate task, and simulated downstream timeout.
- A fallback artifact is visibly labeled `preloaded demo fallback`; it is never
  presented as a successful live call.
