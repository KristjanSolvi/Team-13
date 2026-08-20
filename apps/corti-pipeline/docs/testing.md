# Corti pipeline test runbook

This runbook tests Developer 1's four Corti areas without claiming that the
Agentic ledger lifecycle is complete. Use only the synthetic Karen wording
shown in the harness.

## Start the two local processes

Terminal 1:

```bash
cd apps/corti-pipeline
npm run dev
```

Terminal 2:

```bash
cd apps/corti-pipeline
npm run dev:harness
```

Open these pages in a normal Chrome window:

- Microphone lab: <http://127.0.0.1:5173/>
- Karen evaluation: <http://127.0.0.1:5173/evaluation.html>

Both headers must say `Pipeline live · Corti configured`. Never paste Corti
credentials into the browser, source code, screenshots, or this runbook.

## Test 1: Ambient in a quiet room

1. Open the microphone lab and allow microphone access.
2. Select the closest real microphone. A headset or lapel microphone 15–30 cm
   from the speaker is preferable to a laptop microphone across the room.
3. Click **Start ambient**.
4. Say the displayed synthetic Karen phrase naturally, with a short sentence
   before and after it.
5. Click **Stop** and wait for `Ended cleanly`.

Pass when:

- at least one final transcript segment appears;
- the dizziness/medication/blood-pressure wording is recognisable;
- stopping retains the last final words;
- the browser never receives the Corti client secret;
- the recording and consent state remains visible while the mic is active.

## Test 2: Ambient with background noise

Repeat Test 1 while playing ward/café ambience from a second device at normal
conversation volume. Do not place the noise source directly beside the mic.

Pass when either:

- the exact final phrase remains usable; or
- Corti reports unclear speech and the affected evidence is visibly withheld
  from candidate handoff.

Noise suppression, echo cancellation, automatic gain control, a close mic, and
reviewed keyterms improve capture. They do not make an uncertain transcript
safe. Moving closer or repeating the phrase is the correct recovery.

## Test 3: intentional Dictation correction

1. Use the separate Corti Dictation control.
2. Say: `Route to district nursing within 48 hours and mark medium because
   Karen needs a blood pressure check.`
3. Stop Dictation and confirm the final words appear.
4. Click **Build preview**.

Pass when the preview contains:

- receiving team `district-nursing`;
- deadline `48 hours`;
- urgency `medium`;
- the dictated rationale;
- `explicit clinician confirmation is still required`.

Repeat with corridor noise. If voice is poor, type the same correction. Typed
editing is an intentional safety fallback, not a failed demo.

## Test 4: source-grounded Text Generation

1. Open the Karen evaluation page.
2. Confirm every transcript row says `preloaded demo fallback`.
3. Click **Run live Text Generation**.

Pass when:

- the result is explicitly labelled `live Corti Text Generation`;
- exactly one consolidated conservative candidate appears for the Karen case;
- every displayed quote is copied exactly from one final transcript segment;
- the candidate itself does not select an action, team, owner, deadline,
  diagnosis, or referral;
- the candidate and evidence checks are green.

If the live call is unavailable, click **Load disclosed candidate fallback**.
That proves UI recovery and evidence validation only. It must not be described
as a successful live Text Generation call.

## Test 5: approved document and Medical Coding

1. Read the fixed synthetic action beside the approval checkbox.
2. Tick **Confirm synthetic clinician approval**.
3. Click **Generate approved document + coding**.

Pass when:

- no downstream button is enabled before confirmation;
- the handoff output says `draft` and contains no invented diagnosis, owner,
  deadline, task-creation, assignment, completion, or verification claim;
- Coding shows `Codes` and `Review candidates` separately;
- every retained coding evidence span reproduces the approved input exactly;
- one failed call leaves the successful parallel result visible;
- unavailable Coding produces no fabricated fallback code.

The evaluation page uses a clearly named synthetic approval ID. The integrated
product must replace it with the Agentic service's stable `taskId` and signed
`approvalProof`, plus the exact approved clinical text/version. That contract
now exists, but this evaluator does not perform the BFF orchestration; it proves
the Corti boundary, not an authoritative clinical commit.

## Record one rehearsal result

Record these values after a complete run:

| Check | Record |
|---|---|
| Ambient quiet | pass/fail and transcript quality |
| Ambient noisy | pass/fail, mic used, any unclear-audio event |
| Dictation quiet/noisy | pass/fail and whether typed fallback was needed |
| Candidate Text Generation | live/fallback, latency, credits, candidate count |
| Exact candidate evidence | pass/fail |
| Supporting document | live/unavailable, latency, credits |
| Medical Coding | live/unavailable, system, latency, credits |
| Coding evidence validation | pass/fail |

Do not call the pipeline ready because the individual calls pass. Final product
readiness still requires candidate → Agentic context check → clinician approval
or confirmed correction → ledger commit → team acceptance → completion report
→ independent verification → matching rail and board state.
