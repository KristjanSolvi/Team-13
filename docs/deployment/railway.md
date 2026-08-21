# Railway deployment

Fluence deploys as six backend services from `KristjanSolvi/Team-13` plus
the separately managed Lovable UI. Keeping the current service boundaries
avoids moving secrets into the browser and lets the Agentic ledger retain its
SQLite ownership model for the hackathon.

## Service map

| Railway service   | Root directory          | Config file                          | Public domain        | Port   |
| ----------------- | ----------------------- | ------------------------------------ | -------------------- | ------ |
| `agentic`         | `/`                     | `/railway.toml`                      | Yes, for Corti MCP   | `3000` |
| `corti-pipeline`  | `/apps/corti-pipeline`  | `/apps/corti-pipeline/railway.toml`  | No                   | `8787` |
| `integration-api` | `/apps/integration-api` | `/apps/integration-api/railway.toml` | Yes, for the browser | `8790` |
| `patient-profile` | `/apps/patient-profile` | `/apps/patient-profile/railway.toml` | No                   | `8791` |
| `downstream-gateway` | `/apps/downstream-gateway` | `/apps/downstream-gateway/railway.toml` | No | `8792` |
| `mock-ehr`        | `/apps/mock-ehr`        | `/apps/mock-ehr/railway.toml`       | No                   | `8793` |
| `ward-ui`         | UI team's Lovable repository | UI team's deployment config      | Yes                  | `8080` |

Create the six backend services from the `KristjanSolvi/Team-13` repository and
use the root directories above. The checked-in `railway.toml` files define each
backend service's immutable build, start, health-check, and restart settings.
The UI team owns the separate Lovable repository and should point it only at
the browser-facing Integration API.

## Continuous deployment from `main`

For each of the six services, open **Settings → Source** and connect
`KristjanSolvi/Team-13` with `main` as the deployment branch. Enable automatic
deployments. A successful push to `main` will then replace the running version
behind the same Railway domain; a new domain is not created for every deploy.

At the time of this setup, the backend services were deployed successfully but
their Railway sources were still unconnected: Railway reported that the
connected account did not have access to the repository. Grant the Railway
GitHub App access to `KristjanSolvi/Team-13`, then complete this step for each
backend service. Until then, merges to `main` do not redeploy automatically.

The repository's `.github/workflows/ci.yml` checks every deployable service on
pushes and pull requests. In each Railway service, enable **Wait for CI** so a
failed GitHub check is skipped instead of being promoted. No Railway token is
needed in GitHub because Railway receives the push through its GitHub App.

The checked-in watch patterns limit automatic builds to the services affected
by a commit. Railway evaluates these patterns from the repository root even
when a service has a different root directory.

This setup requires one project member to connect a GitHub account with write
access to the repository and to grant the Railway GitHub App access to it. If
automatic deploy is unavailable, refresh or reconnect the repository after
accepting any pending GitHub App permission update.

## Networking

Set these fixed ports and bind hosts in the corresponding service variables:

```text
agentic:          PORT=3000  HOST=0.0.0.0
corti-pipeline:   PORT=8787  HOST=0.0.0.0
integration-api: PORT=8790  HOST=0.0.0.0
patient-profile: PORT=8791 HOST=0.0.0.0 PATIENT_PROFILE_PORT=8791 PATIENT_PROFILE_HOST=0.0.0.0
downstream-gateway: PORT=8792 HOST=0.0.0.0 DOWNSTREAM_PORT=8792 DOWNSTREAM_HOST=0.0.0.0
mock-ehr:        PORT=8793 HOST=0.0.0.0 MOCK_EHR_PORT=8793 MOCK_EHR_HOST=0.0.0.0
ward-ui:          PORT=8080  HOST=0.0.0.0
```

For the three custom-port services, keep the generic Railway `PORT`/`HOST`
values aligned with the application-specific variables. Railway uses the
generic values for platform port discovery, while each application reads its
own namespaced values.

The patient-profile, downstream-gateway, and mock-EHR services are exposed to
the UI only through the Integration API. Do not give them public domains or
send their private bearer tokens to the browser.

Only `agentic`, `integration-api`, and `ward-ui` need generated Railway
domains. Keep the pipeline, patient-profile, downstream-gateway, and mock-EHR
services private. Configure the
integration API with:

```text
AGENTIC_BASE_URL=http://agentic.railway.internal:3000
PIPELINE_BASE_URL=http://corti-pipeline.railway.internal:8787
PATIENT_PROFILE_BASE_URL=http://patient-profile.railway.internal:8791
DOWNSTREAM_BASE_URL=http://downstream-gateway.railway.internal:8792
MOCK_EHR_BASE_URL=http://mock-ehr.railway.internal:8793
```

After generating the public domains, set:

```text
agentic:
  UI_ORIGIN=https://<ward-ui-domain>
  MCP_PUBLIC_URL=https://<agentic-domain>/mcp

integration-api:
  UI_ORIGINS=https://<ward-ui-domain>

ward-ui:
  INTEGRATION_API_URL=http://integration-api.railway.internal:8790
  INTEGRATION_API_BEARER_TOKEN=${{integration-api.INTEGRATION_API_BEARER_TOKEN}}
```

The UI proxies `/follow-through-api` on the server, so the Integration API
location and privileged handover bearer are never embedded in the browser
bundle. Never put Corti credentials or bearer tokens in a `VITE_*` variable.

## Secrets and service variables

Copy values from the matching `.env.example` into Railway, but never commit
the real values. The important cross-service relationships are:

- `AGENTIC_APP_BEARER_TOKEN` on `integration-api` must equal
  `APP_BEARER_TOKEN` on `agentic`.
- `CORTI_TENANT_NAME`, `CORTI_CLIENT_ID`, `CORTI_CLIENT_SECRET`, and
  `CORTI_ENVIRONMENT` are required on both `agentic` and `corti-pipeline`.
- `APP_BEARER_TOKEN`, `MCP_BEARER_TOKEN`, and `APPROVAL_HMAC_SECRET` must be
  separate random values. The HMAC secret must contain at least 32 characters.
- `PATIENT_PROFILE_BEARER_TOKEN` must match on `patient-profile` and
  `integration-api` and must never be sent to the browser.
- `DOWNSTREAM_BEARER_TOKEN` must match on `downstream-gateway` and
  `integration-api` and must never be sent to the browser.
- `MOCK_EHR_BEARER_TOKEN` must match on `mock-ehr` and `integration-api` and
  must never be sent to the browser.
- Keep `DEMO_MODE=true` and use only the disclosed synthetic demo patients.

Attach a Railway volume to `agentic` at `/app/data` and set:

```text
DATABASE_PATH=/app/data/follow-through.sqlite
```

Do not scale `agentic` beyond one replica while SQLite is the ledger.

Attach a separate Railway volume to `patient-profile` at `/app/data` and set:

```text
PATIENT_PROFILE_DATABASE_PATH=/app/data/patient-profiles.sqlite
PATIENT_PROFILE_SEED_SYNTHETIC_KAREN=true
```

Do not scale `patient-profile` beyond one replica while it uses SQLite.

Attach a separate Railway volume to `downstream-gateway` at `/app/data` and
set:

```text
DOWNSTREAM_DATABASE_PATH=/app/data/downstream.sqlite
DOWNSTREAM_SIMULATION_ENABLED=true
```

Do not scale `downstream-gateway` beyond one replica while it uses SQLite.

Attach another Railway volume to `mock-ehr` at `/app/data` and set:

```text
MOCK_EHR_DATABASE_PATH=/app/data/mock-ehr.sqlite
```

Do not scale `mock-ehr` beyond one replica while it uses SQLite.

## Bring-up order

1. Deploy `agentic` with `CORTI_AGENT_ID` blank and attach its volume.
2. Generate its public domain and set `MCP_PUBLIC_URL` to that domain plus
   `/mcp`.
3. Provision the Corti agent once using `npm run agent:provision`, save the
   returned ID as `CORTI_AGENT_ID`, and redeploy `agentic`.
4. Deploy `corti-pipeline` and confirm `/health` is healthy.
5. Deploy `patient-profile` with its private token and attached volume.
6. Deploy `downstream-gateway` with its distinct private token and attached
   volume.
7. Deploy `mock-ehr` with its distinct private token and attached volume.
8. Deploy `integration-api`; `/readyz` should report all five upstreams ready.
9. Generate the integration domain, set the ward UI URL and matching CORS
   origins, then deploy `ward-ui` last.

## Verification

Check these endpoints without sending patient data:

```text
https://<agentic-domain>/healthz
https://<integration-api-domain>/healthz
https://<integration-api-domain>/readyz
https://<ward-ui-domain>/
```

The pipeline stays private; its `/health` endpoint is checked by Railway and
through the integration API readiness response. Run the demo only with
synthetic data. Preloaded artifacts remain the fallback if any external Corti
call is unavailable during judging.
