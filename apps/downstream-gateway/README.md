# Downstream gateway

Private backend boundary for delivering approved follow-through work to an
external system and independently reading its status back later.

The checked-in adapter is explicitly simulated. It gives the demo a real HTTP
and persistence boundary without claiming access to a GP inbox, district
nursing system, call log, or EHR. A real provider adapter can replace it behind
the same `DownstreamProvider` interface.

## Reliability model

Submission is deliberately split into three steps:

1. persist the delivery intent and its idempotency key;
2. submit to the provider with the stable delivery identifier;
3. persist the provider receipt and external reference.

If the network or process fails between these steps, retrying the same request
reuses the original intent and provider item. A second idempotency key cannot
silently deliver the same task to the same target again.

Provider completion is not inferred from a successful submission. Readback
becomes `independentlyVerifiable: true` only when the provider reports
`completed` with a non-empty outcome reference. The Agentic ledger remains the
owner of task state and decides whether that readback is sufficient to verify
its matching task.

## Endpoints

- `GET /healthz` and `GET /openapi.json` are public and contain no patient data.
- `POST /api/deliveries` records and submits one approved delivery.
- `GET /api/deliveries/:deliveryId` reads the local delivery state.
- `GET /api/tasks/:sourceTaskId/deliveries` finds delivery attempts for a task.
- `GET /api/deliveries/:deliveryId/events` reads its attributed audit trail.
- `GET /api/pending-readbacks` lists non-terminal provider work.
- `POST /api/deliveries/:deliveryId/readback` reads and records provider state.
- `POST /api/simulation/deliveries/:deliveryId/status` changes the simulated
  provider state when simulation is enabled.

All `/api` routes require the private bearer. Submission and simulation writes
require `x-actor-id`; simulation actors must additionally begin with
`downstream:`. The browser must eventually reach these operations through the
Integration API and must never receive the bearer token.

## Provider adapter contract

A real adapter implements two asynchronous operations:

- `submit`: accept the stable delivery ID/idempotency key and return an external
  reference plus provider status;
- `read`: return the authoritative provider status, outcome reference, and
  failure reason for that external reference.

The provider must honor idempotent submission. Logs and error responses must
not expose payload contents or credentials.

## Local run

```bash
cp .env.example .env
npm ci
npm test
npm run dev
```

Set `DOWNSTREAM_SIMULATION_ENABLED=true` only for the disclosed synthetic demo.
With simulation disabled and no real adapter installed, submission fails safely
with `PROVIDER_NOT_CONFIGURED` instead of pretending that work was delivered.
