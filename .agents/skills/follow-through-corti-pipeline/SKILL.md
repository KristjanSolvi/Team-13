---
name: follow-through-corti-pipeline
description: Use when planning, implementing, reviewing, or debugging Developer 1's Corti integration for the Follow-Through hackathon product, including authentication, Ambient STT, intentional Dictation, Text Generation, Medical Coding, and normalized contracts with the agent, ledger, and UI.
---

# Follow-Through Corti pipeline

Build the Corti integration as a narrow, testable adapter. Preserve the product
boundary in `TEAM_CONTEXT.md`: this skill owns Corti authentication and
interaction lifecycle, Ambient STT, Dictation STT, Text Generation, Medical
Coding, and normalized outputs. It does not own the Thread Resolution Agent,
MCPs, committed thread state, downstream task simulation, or product UI.

## Before implementation

1. Read `TEAM_CONTEXT.md`, especially the product lifecycle, team split, safety
   language, technical constraints, and definition of done.
2. Read [pipeline-contract.md](references/pipeline-contract.md) before changing
   any shared type or integration boundary.
3. Read [task-revisions.md](references/task-revisions.md) before implementing
   typed or dictated changes.
4. Read [demo-flow.md](references/demo-flow.md) before changing demo fixtures,
   timing, or fallback behavior.
5. Read the full relevant official skill snapshot; do not rely on a summary:
   - Ambient and Text Generation: `../corti-ambient-scribe/SKILL.md`
   - Dictation: `../corti-dictation/SKILL.md`
   - Medical Coding: `../corti-medical-coding/SKILL.md`
   - Agentic coordination questions: `../corti-agentic-assistant/SKILL.md`
6. Check `.agents/skills/SOURCES.md`. If an official snapshot is refreshed,
   preserve it verbatim and update its checksum and retrieval date.

## Non-negotiable boundaries

- Keep the client secret and full-privilege Corti client on the server.
- Mint short-lived, least-privilege browser tokens separately for `streams` and
  `transcribe`.
- Treat Ambient as observational evidence and Dictation as an intentional edit
  channel. Neither directly commits a task.
- Send only a previewable `TaskRevisionDraft` to the ledger boundary. A human
  must confirm it before Developer 2's ledger changes committed state.
- Validate every displayed transcript quote against the canonical transcript.
  Drop or mark evidence unavailable when validation fails.
- Use only clinician-approved text for coding. Keep returned codes, candidates,
  evidence, and alternatives distinct.
- Do not invent diagnosis, owner, deadline, referral, or clinical plan. Proposed
  actions must remain drafts derived from approved templates and context.
- Do not expose raw Corti SDK response shapes to the UI. Normalize once at the
  pipeline boundary.
- Never log credentials, raw access tokens, or unnecessary realistic synthetic
  identifiers.

## Working sequence

1. Smoke-test authentication and one server-side Corti request.
2. Prove Ambient end to end: create interaction, stream, receive final segments,
   end cleanly, and retain canonical evidence.
3. Prove Dictation as a visibly separate, intentional interaction.
4. Lock normalized event and payload contracts with Developers 2 and 3.
5. Add conservative Text Generation and quote validation.
6. Add Medical Coding only after approved clinical text exists.
7. Add deterministic demo fixtures and clearly disclosed preloaded fallbacks.
8. Test the Karen success branch and Ib overdue branch within the five-minute
   story.

## Review checklist

- Ambient and Dictation are separate qualifying Corti product areas.
- The live path has bounded latency and can survive one disclosed fallback.
- Stop/cleanup does not truncate the final transcript.
- Duplicate or reordered transcript events do not duplicate evidence.
- Dictated revisions require preview and confirmation.
- Invalid quote offsets and evidence spans fail closed.
- Pipeline failures leave the ledger unchanged and produce a useful error event.
- Mock integrations and simulated verification are labeled honestly.
- The UI says “No tracked follow-through blockers,” never “clear for discharge.”
