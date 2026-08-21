# Synthetic mock EHR service

Private backend for the Nervecentre-shaped demo UI. It persists synthetic
clinical documents and their audit history; it does not emulate a vendor API,
claim FHIR compatibility, or connect to a production EHR.

Patient demographics and coordination details remain in the versioned
`patient-profile` service. The browser-facing Integration API composes that
single live profile with this service's documents. This avoids maintaining two
patient copies while still giving the UI an EHR-shaped record boundary.

## Document lifecycle

- A document starts as an attributed `draft` in the `medical` or `discharge`
  category.
- Draft revisions require the expected version, an idempotency key, and a
  human-readable reason.
- Filing requires an attributed explicit command and creates a final version.
- A filed document cannot be revised. A correction must be represented by a
  new document rather than rewriting history.
- `source` records whether content originated from a `clinician`, `agent`, or
  `scribe`; it never replaces clinician attribution or approval.
- An optional Medical Coding review is stored on the same version. The server
  attributes accepted, rejected, no-suggestion, or unavailable outcomes to the
  actor and records the selected code and evidence snapshot only when accepted.
- Changing the coding decision creates a new draft version; filing freezes it
  together with the clinical document.

## Private endpoints

- `GET /healthz` and `GET /openapi.json` are public and contain no patient data.
- `POST /api/patients/:patientId/documents` creates a draft.
- `GET /api/patients/:patientId/documents` lists current documents.
- `GET /api/documents/:documentId` reads one current document.
- `PATCH /api/documents/:documentId` creates a new draft version.
- `POST /api/documents/:documentId/file` files the reviewed version.
- `GET /api/documents/:documentId/history` returns every immutable version.

All `/api` requests require the private bearer token. Writes also require an
`x-actor-id`. The browser must use the Integration API's `/api/ehr/*` routes
and must never receive this credential.

## Local run

```bash
cp .env.example .env
npm ci
npm test
npm run dev
```

The service binds to loopback on port `8793` by default. SQLite data is stored
under `data/`, which is ignored by Git.
