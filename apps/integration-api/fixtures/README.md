# Integration contract fixtures

These fixtures are display-safe, synthetic examples for UI adapters, contract
tests, and demo fallback states. They are not authoritative runtime data.

- `candidate-karen.json`: normalized Corti pipeline candidate accepted by
  `POST /api/candidates/investigate`.
- `patient-overview-karen.json`: representative response from
  `GET /api/patients/synthetic-karen/overview`.
- `events-karen.sse`: representative resumable domain events.

Consumers must ignore additive fields and must not convert an absence of tracked
threads into a clinical discharge decision.
