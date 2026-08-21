# Patient profile service

Private backend service for editable Fluence patient details and safe
referral automation inputs.

This is a mutable coordination profile, not a replacement for the EHR. Every
change is attributed, reasoned, version-checked, idempotent, and retained in a
complete history. A future EHR connector can use the same update contract with
an attributed system actor.

## Why referral snapshots exist

Creating a referral snapshot freezes the exact patient profile version used by
the referral automation. Later profile edits do not rewrite that snapshot.
Reads return both `profileVersion` and `currentProfileVersion`, plus
`profileChanged`, so the UI can offer an explicit regenerate/amend action.

## Data model

The current profile contains:

- display name and record identifiers;
- date of birth and pronouns;
- bed, bay, today's schedule, current wait, and home-tomorrow flag;
- contact details;
- referral-relevant language, interpreter, mobility, transport, home-support,
  and additional details.

Empty optional values are represented as `null`, not empty strings. PATCH
requests send `expectedVersion`, an idempotency key, a human-readable reason,
and only the changed nested fields.

## Endpoints

- `GET /healthz` and `GET /openapi.json` are public and contain no patient data.
- `POST /api/patients/:patientId/profile` creates the first profile version.
- `GET /api/patients/:patientId/profile` reads the current version.
- `PATCH /api/patients/:patientId/profile` applies a manual update.
- `GET /api/patients/:patientId/profile/history` reads every version.
- `POST /api/patients/:patientId/referral-snapshots` freezes referral input.
- `GET /api/patients/:patientId/referral-snapshots` lists the patient's
  snapshots and whether the live profile has changed.
- `GET /api/referral-snapshots/:referralId` reads one immutable snapshot.

All `/api` requests require the private bearer token. Writes also require an
`x-actor-id`; the browser must eventually reach these routes through the
Integration API, never directly.

## Local run

```bash
cp .env.example .env
npm ci
npm test
npm run dev
```

The service binds to loopback on port `8791` by default. Its SQLite database is
stored under `data/`, which is ignored by Git.
