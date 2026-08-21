# Fluence — Team Context and Build Brief

> **Team 13 single source of truth**  
> Corti Hack for Health, Copenhagen · 20–21 August 2026  
> Prepared before the official build start as documentation only.

## Current boundary

- **No solution code, scaffolding, or commits before 10:00 Copenhagen time on Thursday 20 August**, or a later organizer announcement if the countdown is delayed.
- This file may be prepared locally now and committed after the permitted start.
- Nothing in this document is previously built product code.
- Do not copy archived/pre-challenge concepts or code into the submission.
- Do not commit credentials, tokens, `.env` files, patient-like raw data, or generated transcripts containing realistic identifiers.

---

## Team and project access

### Team

- **Four team members total.**
- **Three developers.**
- One clinical/product lead, ideally the NHS doctor on the team.
- Team number: **13**.

### Corti Console

- Project: **Hackathon CPH 2026 – Team 13**
- Project slug: `hackathon-cph-2026-team-13`
- Console: [Team 13 Corti project](https://console.corti.app/project/0f1a064c-c75f-4f9e-9dfb-53171ff0c701)
- Available project credit observed on 20 August: **$150.00**
- Credit consumed when this brief was prepared: **$0.00**

The project UI currently exposes:

- Agents
- Ambient Speech-to-text
- Dictation Speech-to-text
- Pre-recorded Speech-to-text
- Text Generation
- Fact Extraction
- Medical Coding
- Embedded Assistant
- API Clients, Billing, Usage, Templates, and Team management

### Credential policy

- Obtain credentials through the Corti Console after the official start.
- Keep `CORTI_CLIENT_ID` and `CORTI_CLIENT_SECRET` server-side only.
- Use `.env.example` for variable names and placeholders; never commit `.env`.
- Never paste credentials into chat, issues, screenshots, Markdown, demo recordings, or frontend code.
- Use narrowly scoped, short-lived browser tokens only where Corti officially requires them.
- Monitor the Console **Usage** page during development so accidental loops do not consume the shared credit.
- Prefer one clearly owned demo API client; if separate development clients are created, name them by function so usage remains attributable.

---

## Official challenge

> **Build something that makes clinical conversations more useful: for the clinician, the patient, or the people coordinating care around them.**

Official materials:

- [Participant Brief](https://cortihome.notion.site/Participant-Brief-367bef65b3ab8092827be8ababd64986)
- [Schedule](https://cortihome.notion.site/Schedule-of-Activities-Shared-3bfbef65b3ab80ffb0e8df04fdf1dd06)
- [Datasets](https://drive.google.com/drive/folders/1k1GgiVBbL3KoXqlMQFCOsg1PVTmei8bW?usp=sharing)
- [Corti API documentation](https://docs.corti.ai/)
- [Official Corti examples](https://github.com/corticph/corti-examples)

### Suggested “where to build” territories

1. In-encounter intelligence
2. Documentation and coding
3. Patient understanding and follow-through
4. Population and longitudinal insight
5. Care coordination and handoffs
6. Something else entirely

### Required Corti product areas

The prototype must use at least four of five. We intend to use **all five**, each for a distinct reason:

1. Ambient Speech-to-text
2. Dictation Speech-to-text
3. Text Generation
4. Agentic Framework
5. Medical Coding

Ambient and Dictation are separate checklist items. Do not assume one Speech-to-text integration satisfies both.

### Judging criteria

The five criteria are evenly weighted:

1. Clinical Relevance
2. Use of the Corti API
3. Working Prototype
4. Insight and Ambition
5. Crowd Voting

### Superlatives

- Best Commercial Idea
- Best UX
- Best Use of Agentic Framework
- Mystery Superlative

### Important rules

- Maximum team size is four.
- No previously built solution code.
- Open-source software and public packages are allowed.
- No AI API other than Corti.
- TTS and OCR are allowed exceptions.
- MCP connections are allowed when connected through Corti Agentic.
- The submission repository must disclose all other products and datasets used.
- Every team member must introduce themselves, the team name, and team number.
- Presentation is a maximum of five minutes plus roughly two minutes of questions.
- A full transcript may be prepared in advance, but Speech-to-text must be demonstrated working.

### Key times

- **Thursday 20 August, 10:00:** conservative build/commit start boundary unless organizers explicitly announce otherwise.
- **Friday 21 August, 14:00:** code freeze and GitHub submission deadline.

---

## Product decision

### Product name

**Fluence**

### Tagline

> **Nothing a patient tells their care team should get lost—and nothing they are promised should go unkept.**

### Naming hierarchy

```text
Fluence                   User-facing product
└── Clinical Thread Ledger       Persistent accountability layer
    └── Thread Resolution Agent  Detects, checks, proposes, acts, and verifies
```

### One-sentence pitch

> Fluence is an EHR companion that converts clinical conversations into tracked, clinician-approved, and verified work—at the bedside, across the ward, and throughout the patient journey.

### Memorable closing line

> **Other systems remember what was said. Fluence remembers what still needs to happen.**

---

## The problem

Clinical documentation does not guarantee clinical follow-through.

Important information can be:

- Mentioned but never explored.
- Promised but never assigned.
- Documented but buried inside a note.
- Assigned verbally but never written to the receiving system.
- Sent downstream but never completed.
- Lost when care moves between teams.
- Omitted from the note, problem list, or coding even though it affected the conversation.

On a ward, the same failure appears at two levels:

### Patient level

A symptom, referral, investigation, medication concern, social risk, or follow-up commitment has exactly one moment of attention. If nobody turns it into owned work, it can silently disappear.

### Ward level

Charge nurses, ward clinicians, and bed managers need to know what is blocking each patient's progress. That picture is frequently rebuilt from memory, phone calls, notes, task lists, and whiteboards.

Both failures have the same root cause:

> The conversation where the commitment originated has no persistent action memory of its own.

Fluence gives it one.

---

## Who it is for

### Daily users

- Ward clinicians—the source of clinical authority and required approval step.
- Charge nurses and bed managers—the ward/flow view.
- Receiving teams such as GPs, pharmacy, physiotherapy, social work, and community services.
- Patients and caregivers receiving a clear follow-up plan.

### Economic buyer hypothesis

- Primary: hospital patient-flow or bed-management function.
- Secondary: quality, safety, clinical operations, and digital transformation teams.
- Partner route: EHR, ambient-scribe, and care-coordination vendors.

The commercial hypothesis is that patient flow offers an immediate operational budget and measurable workflow value, while safety and documentation completeness strengthen the longer-term case. We should present this as a hypothesis to validate, not a proven purchasing decision.

### Initial market wedge

One ward and one discharge-related workflow:

- Medication review
- Pending investigation/result
- Referral or booking
- Pharmacy action
- Therapy/social-work assessment
- Community or primary-care follow-up

The product is **vendor-neutral** and should be described as an additional intelligence layer beside or within the hospital's existing EHR workflow—not as a replacement EHR and not as a Denmark-only product.

---

## What Fluence does

### Detects

Ambient capture of rounds, handoffs, and discharge conversations proposes significant commitments or concerns when they are spoken.

### Checks

The Thread Resolution Agent retrieves relevant longitudinal context and checks whether the commitment is new, already covered, contradicted, assigned, or still open.

### Asks once

At a natural pause, the clinician approves or dismisses with one tap, or uses
intentional Dictation to correct the proposed action, receiving team, deadline,
or urgency before confirming.

### Acts

After approval, the agent creates the action in the workflow the receiving team already uses. In the prototype this is an honest, fully controlled mock downstream system.

### Verifies

The agent reads the action back and later checks its recorded status. If it is not completed by its deadline, the thread escalates rather than silently expiring.

Prototype language must be precise: we verify the status reported by the simulated downstream system, not the true real-world clinical outcome.

### Communicates

The same approved thread can generate:

- Clinician documentation
- Patient instructions
- Receiving-team handoff
- Evidence-linked coding candidates

### Shows the ward

Threads roll up by bed into a live board showing tracked blockers, items awaiting review, active work, verified work, and escalations.

---

## Clinical thread lifecycle

The same underlying thread is used by the bedside rail, ward board, documentation, coding, and downstream actions.

Conceptual states:

```text
Detected → Awaiting clinician review → Confirmed → Action created
        → Verified complete
        → Escalated / overdue
        → Dismissed or closed with evidence
```

Every thread should retain:

- What triggered it
- Transcript timestamp/evidence
- Relevant record evidence
- Why it is being tracked
- Clinician decision
- Owner
- Deadline
- Downstream action identifier
- Current status
- Activity history
- Verification or escalation evidence

This is a conceptual product model, not an implementation schema.

---

## UX decision

Fluence has **two screens, one visual language, and one underlying object**.

### The rail—at the bedside

A slim companion column next to the EHR rather than another destination clinicians must remember to open.

Default state:

- Quiet and minimally populated.
- Only patients with active or newly proposed threads are prominent.
- Name/bed, one-line preview, and a status ring.
- Detail panel opens on demand.

Thread detail:

- Exact triggering sentence and timestamp
- Relevant record evidence
- Why the thread is being tracked
- Receiving team, deadline, and owner once accepted
- Agent activity trail
- Approve with one tap, correct via Dictation, or dismiss as already covered

### The board—at board round

A full-width ward view with one row per bed:

- Patient and bed
- Short clinical context
- Plain-language status
- One chip per open thread
- Same detail panel as the rail
- Summary counts for waiting, active, verified, and escalated threads

### Critical safety language

Never display:

> “Clear for discharge.”

Display:

> **“No tracked follow-through blockers.”**

The board supports the existing clinical/operational decision. It does not decide medical discharge readiness.

### Status-ring visual grammar

Color is always paired with an icon and word:

- Dotted grey: awaiting clinician review
- Part-filled blue: confirmed and being tracked
- Closed green with check: verified
- Broken red with exclamation: escalated

If a patient has several threads, the row must not imply that a single green thread closes every other blocker. The row summary should reflect the highest-priority outstanding state, while individual chips preserve each thread's status.

### Design character

- Calm and quiet rather than alarm-heavy
- System font and generous whitespace
- No vanity dashboards
- Evidence available but collapsed by default
- Draft, committed, failed, verified, and escalated states visually distinct
- Nothing important depends on color alone

---

## Vendor-neutral overlay architecture

Fluence is a companion/intelligence layer over existing hospital systems:

```text
Existing hospital systems
EHR · referrals · pharmacy · task queues · scheduling · messaging
                              ↕
                    MCP integration adapters
                              ↕
                   Clinical Thread Ledger
                              ↕
                    Thread Resolution Agent
                              ↕
           Bedside Rail · Ward Board · Handoff Views
```

For the hackathon:

- The patient record comes from organizer-supplied synthetic data.
- The downstream task/referral system is a small mock owned by the team.
- The core must work locally and deterministically.
- FHIR, Epic, NHS, or regional validation is optional stretch work.
- Never claim integration with a real provider when using a sandbox or public standard.

Long-term adapters can connect to different EHR and operational systems without changing the Clinical Thread Ledger or user experience.

---

## Agentic workflow

The agent is not a chat window. Its visible resolution loop is the central product behavior:

1. Ambient STT captures the conversation.
2. The application maps the Corti Ambient `interactionId` to an Agentic `contextId` and synthetic patient ID.
3. Relevant facts enter the agent context as structured data.
4. The agent calls the Record MCP for patient-scoped context.
5. It checks existing actions and open threads.
6. It creates a draft proposal with evidence.
7. The clinician approves with one authenticated action or corrects it through
   Dictation, previews the structured change, and then confirms.
8. Only an approved action may be committed through the Ledger MCP.
9. The agent reads the action back to verify successful creation.
10. It later checks status and either verifies completion or escalates.
11. Text Generation and Coding create aligned supporting outputs.

The UI shows a concise activity trail, not hidden chain-of-thought:

```text
Detected medication-related concern
→ Retrieved recent medication history
→ Checked for an existing follow-up: none found
→ Created draft thread
→ Requested clinician approval
→ Created approved action
→ Verified downstream action ID and status
```

### Why this is genuinely agentic

- Multi-step planning
- Tool selection and MCP use
- Patient-scoped retrieval
- Persistent state transitions
- Human authority at the action boundary
- Read-after-write verification
- Failure recovery
- Longitudinal memory outside the chat context
- Visible audit trail

---

## MCP plan

Use a small number of meaningful tools rather than many integrations for spectacle.

### Record MCP—read-only

- Search synthetic longitudinal records
- Retrieve medications, allergies, conditions, results, encounters, and earlier decisions
- Label every result with source and patient scope
- Deny access when the patient scope is absent

The official Corti Search Documents example demonstrates patient-scoped MCP retrieval. It currently uses a local embedding model; confirm that this is allowed or replace it with deterministic full-text search.

### Ledger MCP—stateful and narrow

- List open threads for the active patient
- Create/edit a draft thread
- Draft an assignment, task, handoff, or referral
- Commit only with valid clinician approval
- Retrieve committed actions for verification
- Update simulated downstream status
- List de-identified counts of overdue, ownerless, or escalated threads

### Safety controls

- No generic delete tool
- No unrestricted database/EHR update
- Patient- and clinician-scoped authorization
- Explicit draft versus approved states
- Idempotency to prevent duplicate actions
- Immutable conversation and record provenance
- Read-after-write verification
- Failed tools leave threads open

### Optional FHIR bridge

The staged WSO2 FHIR MCP can connect through Streamable HTTP to a local HAPI FHIR store or an Epic test server. Use it read-only or behind the narrow Ledger MCP; do not expose arbitrary FHIR create/update/delete operations to the clinical agent.

---

## Use of all five Corti areas

| Corti area | Fluence role |
|---|---|
| Ambient Speech-to-text | Passive capture of rounds, handoffs, and discharge conversations; supplies timestamped evidence |
| Dictation Speech-to-text | Intentional clinician channel for correcting the action, receiving team, deadline, urgency, dismissal rationale, or closure wording |
| Agentic Framework | Checks context, selects MCP tools, proposes, waits for approval, acts, verifies, and escalates |
| Text Generation | Produces concise, evidence-grounded proposal explanations, patient instructions, and handoff wording |
| Medical Coding | Checks whether a confirmed concern is represented in supported coding/problem concepts and shows evidence-linked candidates |

Ambient is observational; one-tap approval and Dictation are intentional.
Neither speech transcript writes by itself: only an authenticated clinician
confirmation may authorize an action.

Coding is supportive, not a separate product. Avoid making reimbursement leakage the primary story, particularly in a vendor-neutral or European demonstration.

---

## MVP and expansion

### The non-negotiable MVP

> One patient, one complete thread lifecycle, one clinician approval, one verified downstream action, and the same state updating both rail and board.

Required demonstration:

- One six-bed synthetic ward
- Five preloaded patients establishing ward context
- One patient demonstrated live end to end
- One short live Ambient segment
- One clinically meaningful proposed thread
- One Record MCP retrieval
- One clinician Dictation approval/correction
- One Ledger MCP commit
- One read-after-write verification or escalation
- Rail and ward board update from the same thread
- One patient/handoff output
- One evidence-linked coding response

### Extension modules sharing the same ledger

1. Discharge blockers and ward flow
2. Referral and investigation follow-through
3. Medication and pharmacy actions
4. Conversation-versus-note completeness
5. Coding/problem-list completeness
6. Patient understanding and follow-through
7. Cross-team handoffs
8. Multi-encounter and hospital-level operational insight

### Stretch features, in order

1. A second encounter that closes the original thread
2. Simulated downstream failure and escalation
3. Conversation-versus-note completeness check
4. Two users demonstrating patient-scoped access
5. FHIR-backed record/task objects
6. Epic sandbox read-only retrieval
7. MedCom-, NHS-, or other standards-shaped output validation

### Cut first if integration slips

- Real scheduling
- Real patient-message delivery
- More than one regional localization
- Broad analytics
- Multiple agents without a necessary workflow role
- Autonomous clinical orders or referrals
- Production identity/provider integration

Go big in the product vision, but protect the one complete vertical slice.

---

## Synthetic ward and data

The organizer dataset contains:

- 24 English audio files
- 11 synthetic longitudinal patient folders
- 113 Markdown files
- 25 encounters
- Scenarios including geriatrics, heart failure, STEMI/discharge/cardiology, oncology, psychiatry, diabetes, pediatrics, and primary care

Strong live-patient candidates:

- **Harold Mitchell:** geriatric, functional, and caregiver context; well suited to home-care and cross-team discharge.
- **Robert Okafor:** STEMI, discharge, and cardiology timeline; well suited to medication and follow-up commitments.

Decision still required: select one main patient and one exact downstream action.

The other five ward rows can be preloaded with compact, synthetic tracked blockers derived from other organizer patients. Do not claim that organizer audio files map to these patient folders unless the organizers explicitly confirm it.

Although synthetic, the records contain realistic-looking names, MRNs, contact details, and insurance information. Treat them as sensitive test data and minimize raw copying into logs, screenshots, public deployments, and Git.

---

## Team split after the official start

### Developer 1—Corti pipeline

- Corti authentication and interaction lifecycle
- Ambient STT
- Dictation STT
- Text Generation
- Medical Coding
- Normalized event/output interface for the rest of the team

### Developer 2—Agent and MCP

- Thread Resolution Agent
- Record MCP
- Ledger MCP
- Persistent thread state
- Mock EHR/task/referral backend
- Approval, commit, verification, and escalation

### Developer 3—Product UI

- Bedside rail
- Six-bed ward board
- Ring/status visual language
- Thread detail and activity trail
- Live backend updates
- Demo-safe loading/error/fallback states

### Member 4—Clinical and product lead

- Validate the ward and discharge workflow
- Select/adapt the synthetic patient story
- Define which proposed threads are useful versus noisy
- Review clinical and patient language
- Maintain safety and claim boundaries
- Continuously test integrated slices
- Protect scope and manage demo readiness
- Own the commercial narrative, five-minute presentation, and questions
- Operate the clinician side of the live demo

### First shared task at build start

Before separating, agree on:

1. Exact patient story and trigger sentence
2. Thread states and minimum shared interface
3. One downstream action type
4. Mock API behavior, including failure/verification
5. Rail and board event contract
6. Five-minute demo sequence
7. Cut line if integration falls behind

Then work in parallel against the same contract and integrate continuously rather than merging four disconnected products at the end.

---

## Official examples and build starting points

### Primary foundation

`ambient/typescript/basic-example`

- Live Ambient transcription
- Single-microphone and split-channel modes
- Fact events
- End-of-encounter documentation

### Agentic/MCP reference

`agents/typescript/search-documents-mcp` and `agents/react/search-documents-ui`

- Corti-provisioned orchestrator
- Streamable HTTP MCP
- Patient-scoped retrieval
- Short-lived signed authorization pattern

Limitations:

- Only one read-only search tool currently
- Documents require ingestion/reindexing
- Optional ingest route is unauthenticated when enabled
- Uses a local embedding model
- Current dependency audit contains advisories and must be updated/rechecked before tunnelling

### Dictation reference

`dictation/typescript/basic-example`

- Intentional clinician Dictation channel
- Interim/final text and command patterns

### Fallback

`embedded-assistant/react/basic-example`

- Fast session/recording/documentation UI
- Useful if custom Ambient plumbing fails
- Does not automatically provide Agentic, Dictation, or Coding
- Less suitable for the differentiated rail/board experience

### Reuse/license question

The official examples are public and intended as integration references. The repository has no root license file; some package manifests declare MIT and others do not. Confirm with organizers whether code may be copied from every example, or use the examples as patterns and public-package references.

---

## Why this meets every “where to build” area

| Territory | Fluence contribution |
|---|---|
| In-encounter intelligence | Surfaces a potentially missed commitment before the encounter ends |
| Documentation and coding | Checks that the approved concern reaches documentation and supported coding concepts |
| Patient understanding and follow-through | Makes owner, action, deadline, and escalation instruction explicit |
| Population and longitudinal insight | Shows ownerless, overdue, failed, recurring, and closed threads across encounters |
| Care coordination and handoffs | Preserves conversational evidence, rationale, responsibility, and status across teams |
| Something else | Creates an observability layer for what clinical conversations cause—or fail to cause |

---

## Judging and winning strategy

### Clinical Relevance

- Use a plausible ward/discharge failure mode.
- Have the clinician approve every action.
- Show downstream ownership and patient/receiving-team value.
- Never imply the board makes a discharge decision.

### Use of the Corti API

- Show all five areas doing distinct jobs.
- Make Ambient and Dictation visibly different.
- Make the agent's MCP activity and verification visible.
- Connect Coding evidence to the same confirmed thread.

### Working Prototype

- Demonstrate one complete lifecycle rather than many partial features.
- Run the core locally with a mock downstream system.
- Prepare preloaded data and deterministic fallback states.
- Still show a short live Speech-to-text segment.

### Insight and Ambition

- Reframe clinical AI output from prose to accountable state transitions.
- Show the same object solving bedside and ward-level visibility.
- Explain extension to longitudinal and cross-system coordination.

### Crowd Voting

- Begin with a human sentence that almost disappears.
- Show the ring move visibly from proposed to verified/escalated.
- Let the ward board update automatically.
- Keep the technical explanation subordinate to the patient story.

### Best Commercial Idea

- Clear buyer: flow/bed management and clinical operations.
- Clear wedge: discharge-related tracked blockers.
- Clear procurement hypothesis: per ward, bed, organization, or usage.
- Clear expansion: other workflows and embedded vendor partnerships.

### Best Use of Agentic Framework

- Agent retrieves, reconciles, proposes, pauses, commits, verifies, and escalates.
- Tools are necessary and visible.
- Human authority is designed into the workflow.
- Failure is handled honestly.

### Best UX

- Rail and board share one visual grammar.
- Quiet by default.
- Evidence without clutter.
- Status never depends on color alone.
- No new notification channel for receiving teams.

---

## Marketability

### Positioning

> **A conversation-to-action and verification layer for clinical workflows.**

Fluence complements rather than replaces:

- EHRs
- Ambient scribes
- Task and inbox systems
- Referral and scheduling platforms
- Patient messaging systems
- Care-coordination software

### Buyer value

- Current view of tracked ward blockers
- Less manual reconstruction during board rounds
- Evidence-linked ownership and deadlines
- Visible failed or overdue downstream work
- Better alignment between conversation, task, handoff, and patient plan
- Auditable agent and clinician actions

### Business-model hypotheses

- Enterprise licensing by ward, bed, site, or organization
- Usage pricing by processed encounter or tracked thread
- Embedded API/SDK licensing to EHR, ambient, or care-platform vendors
- Paid workflow/localization adapters

Do not invent a price during the hackathon. Validate the buyer, budget, measurable value, and purchasing model first.

### Early measurable outcomes

- Percentage of confirmed threads with an owner
- Time from conversation to assignment
- Percentage of actions successfully created and verified
- Ownerless or overdue thread count
- Clinician time spent manually creating actions/board updates
- User approval, correction, and dismissal rates
- Thread closure rate with evidence

Avoid claiming reduced readmissions, prevented adverse events, released bed-days, or recovered reimbursement without evaluation.

### Defensibility

- Evidence-linked thread lifecycle
- Integrations into real operational workflows
- Regional/vendor adapters
- Clinician feedback on accepted, corrected, and dismissed threads
- Audit trail from conversation to downstream completion
- Operational benchmarks for unresolved work

---

## Five-minute demonstration

### 0:00–0:30—problem

Patient mentions a concern or commitment that could disappear.

> “This can be perfectly transcribed and documented—and still never happen.”

### 0:30–1:15—Ambient encounter

Show a short live conversation and the relevant transcript/fact evidence.

### 1:15–2:05—agent investigates

Show the activity trail retrieving record context, checking existing work, and creating a draft thread.

### 2:05–2:40—clinician authority

Clinician uses Dictation to correct the receiving team, deadline, or urgency,
previews the structured change, and confirms it.

### 2:40–3:25—act and verify

Agent commits through MCP, reads the action back, and the ring changes state.

### 3:25–4:10—same state, several views

Show rail, board update, patient/handoff wording, and coding evidence.

### 4:10–4:40—ward and commercial view

Show six beds and tracked blockers; explain the operational buyer and expansion.

### 4:40–5:00—close

> “Other systems remember what was said. Fluence remembers what still needs to happen.”

---

## Words and claims to avoid

Do not say:

- “Clear for discharge”
- “The AI decides discharge readiness”
- “Integrated with a real hospital” when using a mock or sandbox
- “Verified in the real world” when checking simulated status
- “Feature switch-on” unless integration is actually that simple
- “Prevents readmissions or missed diagnoses”
- “Recovers reimbursement” as a proven outcome
- “Autonomously coordinates care”
- “Compliant” or “production ready”

Prefer:

- “No tracked follow-through blockers”
- “Supports the existing board-round and discharge decision”
- “Standards-grounded simulation”
- “Clinician-controlled agent”
- “Verified downstream system status”
- “Workflow prototype”
- “Commercial and clinical hypothesis to validate”

---

## Known technical constraints and questions

1. Corti Ambient `interactionId` and Agentic `contextId` are separate and must be mapped by our application.
2. Agent contexts are isolated; longitudinal ledger state must live in our own store/MCP.
3. Corti's Agent/MCP example requires a publicly reachable HTTPS Streamable HTTP endpoint; confirm tunnel guidance.
4. Confirm that the hackathon tenant allows orchestrator creation, MCP attachment, and bearer forwarding.
5. Confirm which medical coding systems are enabled; do not promise Danish SKS or another unavailable system.
6. Confirm whether the Search Documents local embedding model complies with the rule, or use deterministic retrieval.
7. Confirm whether all official Corti example code may be copied.
8. Confirm how organizers verify separate Ambient and Dictation use.
9. Confirm the required filename/format for the products and datasets disclosure.

---

## Decisions already made

- Product name: **Fluence**
- Underlying system: **Clinical Thread Ledger**
- Engine: **Thread Resolution Agent**
- Vendor-neutral EHR companion/overlay, not a replacement EHR
- One ward and six synthetic beds
- One live end-to-end thread lifecycle
- Bedside rail plus ward board using the same data
- Phrase: **“No tracked follow-through blockers”**
- One mock downstream system for the reliable live path
- All five Corti areas
- Three developers plus one clinical/product lead
- Big extensible vision, protected vertical-slice MVP

## Decisions still required

- Harold Mitchell or Robert Okafor as the main live patient
- Exact trigger sentence and clinical commitment
- Exact downstream action: medication review, referral, pharmacy, result check, or community follow-up
- Final thread states and shared interface after build start
- Deterministic search versus local embeddings
- Whether optional FHIR/Epic/standards validation fits after the core works
- Enabled medical coding system
- Final presentation team-name wording

---

## Definition of done

The prototype is ready when the team can demonstrate, reliably and within five minutes:

1. A real Corti Ambient transcript segment creates evidence.
2. The agent retrieves scoped record context through MCP.
3. It proposes one useful thread without taking autonomous action.
4. The clinician intentionally approves with one tap or corrects through Corti
   Dictation and then confirms the preview.
5. The agent commits to the mock downstream system.
6. It reads back and verifies the recorded status.
7. The rail and ward board update from the same thread.
8. Text Generation and Medical Coding add aligned supporting outputs.
9. The team can explain the buyer, commercial wedge, safety boundary, and expansion path.
10. The demo works without depending on a real hospital, Epic, NHS, MedCom, or live external sandbox.

---

## Submission hygiene

After the official start:

- Commit this file without secrets.
- Keep real `.env` files ignored.
- Add a disclosure file listing Corti, organizer datasets, public packages, examples, MCP servers, and any other product used.
- Do not commit downloaded organizer datasets unless explicitly permitted.
- Do not expose realistic-looking synthetic identifiers in public screenshots or logs unless necessary and reviewed.
- Keep the submission repo focused; do not commit the broad preparation toolbox.
- Review the final Git diff before every commit.

Example documentation-only commit message:

```text
docs: add Fluence team context
```

Keep this context synchronized with the implemented cross-service contracts.
