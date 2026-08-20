# Authenticated Agent Context Warm-up Design

## Problem

The live Agentic investigation fails before patient-scoped investigation begins.
The task agent's initial `Initialize an empty context. Do not call tools.` message
ends in Corti state `auth-required` because that warm-up omits the MCP bearer
token. Corti validates the configured bearer-protected connector even though the
prompt tells the agent not to call tools.

The stable task MCP endpoint is available at
`https://agentic-production-6705.up.railway.app/mcp` and correctly rejects an
unauthenticated request. The existing Corti task agent now points to that stable
endpoint. The failed live signal was retained safely and did not create a task.

## Goals

- Authenticate the data-free warm-up through the existing MCP token mechanism.
- Preserve the rule that no patient identifier, cue, or clinical evidence is
  sent until a Corti context has been created and mapped locally.
- Add a regression test that would fail if warm-up authentication is removed.
- Keep the task agent ID, MCP endpoint authentication, context isolation, and
  investigation/publication behavior unchanged.

## Non-goals

- Do not make either MCP endpoint public or weaken bearer authentication.
- Do not remove the context warm-up or change context-to-patient mapping.
- Do not change handover orchestration or deploy the currently absent public
  `/mcp/handover` route as part of this fix.
- Do not add retries, logging of tokens, or unrelated refactoring.

## Considered Approaches

### 1. Authenticate the existing warm-up (selected)

Send `data: { mcpToken: this.mcpToken }` with the warm-up. The existing
`CortiSdkGateway` removes `mcpToken` from ordinary data and emits it as Corti's
dedicated token data part for the configured MCP server. This is the smallest
change and preserves every existing safety boundary.

### 2. Remove the warm-up

The first patient-scoped message could create a context directly, but patient
data would leave the service before a local context mapping exists. This weakens
the existing ordering guarantee and complicates failure recovery.

### 3. Disable MCP bearer authentication

This would avoid Corti's `auth-required` state but expose patient-scoped tools
without the intended service credential. This is not acceptable.

## Design

`AgentRunner.ensureContext` will continue to send the same data-free warm-up
text, but its gateway input will also include only the MCP token. No patient ID,
interaction ID, signal text, evidence reference, or source quote will be present
in that first call.

`CortiSdkGateway` already converts `mcpToken` into the token data-part format
expected by Corti and prevents it from being copied into the ordinary data part.
No gateway or public API contract needs to change. Existing mapped interactions
will continue to skip warm-up entirely.

If Corti still cannot authenticate or initialize a context, the existing failure
path remains unchanged: the signal is retained, the Integration API returns a
retryable failure, and no task is published.

## Testing

The AgentRunner regression test will assert that the first gateway call:

- contains the existing warm-up text;
- contains the configured MCP token;
- contains no patient or clinical fields; and
- occurs before the patient-scoped investigation call.

The focused test must be observed failing before the production change and
passing afterward. The complete root backend test suite, build, and lint must
then pass.

## Live Verification

After the fixed Agentic service is deployed:

1. Confirm `/healthz` returns `200` and an unauthenticated `/mcp` request still
   returns `401`.
2. Submit one clearly synthetic candidate through the public Integration API.
3. Require a completed Corti agent result rather than only a retained signal.
4. Read the synthetic patient's threads and tasks to confirm the committed
   ledger result and absence of duplicates.

The handover agent remains unchanged until the deployed Agentic service exposes
`/mcp/handover`.
