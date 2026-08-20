# Products and datasets disclosure

This file records the external products, services, source projects, packages,
and data used by the Follow-Through prototype. Update it before submission when
something is added or removed.

## Products and services

- **Corti API and `@corti/sdk` 5.0.0** — authentication, Ambient speech-to-text,
  Dictation speech-to-text, Text Generation, Agentic Framework integration, and
  Medical Coding. Only enabled and demonstrably working areas should be claimed
  in the final presentation.
- **Lovable** — generated the original Ward Companion visual prototype. Source:
  <https://github.com/YaldesDev/ward-companion>, imported from commit `fee200b`.
- **GitHub** — source control and team collaboration.
- **Nervecentre, GP inbox, district-nursing, EHR, task-system, and call-log
  screens/workflows** — names or visual concepts may appear in the demo, but all
  are simulated fixtures. There is no production integration, endorsement, or
  live clinical data exchange.

## Organizer-provided datasets

- **Corti CPH 2026 Hackathon text samples** — 11 synthetic longitudinal patient
  folders containing 25 encounter notes. When used for evaluation, labels and
  label-bearing filenames/headings are removed from model input, and cases are
  split by patient rather than encounter. Results are a demo benchmark, not
  clinical validation.
- **Corti CPH 2026 Hackathon audio samples** — 24 English-labelled M4A/WAV files.
  They have no linked ground-truth transcripts or longitudinal patient mapping,
  so they are used only for ingestion/transcription demonstrations or fallback,
  not accuracy claims.
- **Ward Companion UI fixtures** — fictional patient, bed, staffing, note, and
  task data inherited from the Lovable prototype and adapted locally. No real
  patient information is included.

## Open-source packages

The exact dependency and version lists are in `package-lock.json`,
`apps/corti-pipeline/package-lock.json`, `apps/integration-api/package-lock.json`,
and `apps/ward-companion/bun.lock`. Major components include React, TanStack
Router/Start, Vite, TypeScript, Express, Zod, the Model Context Protocol SDK,
Tailwind CSS, Lucide, and Vitest.

