# Integration contract fixtures

These fixtures are display-safe, synthetic examples for UI adapters, contract
tests, and demo fallback states. They are not authoritative runtime data.

The Ward Companion projection was aligned with
`YaldesDev/ward-companion@fee200b` (`src/data/ward.ts`).

- `candidate-karen.json`: normalized Corti pipeline candidate accepted by
  `POST /api/candidates/investigate`.
- `patient-overview-karen.json`: representative response from
  `GET /api/patients/synthetic-karen/overview`.
- `ward-companion-overview-karen.json`: exact projection returned by
  `GET /api/patients/synthetic-karen/companion` for the current Ward Companion
  `Thread` model.
- `events-karen.sse`: representative resumable domain events.

Consumers must ignore additive fields and must not convert an absence of tracked
threads into a clinical discharge decision.
