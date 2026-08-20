# Authenticated Agent Context Warm-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate Corti's data-free context warm-up without sending patient or clinical data before local context mapping.

**Architecture:** Keep `AgentRunner.ensureContext` and the existing two-message ordering. Add the configured MCP token to the warm-up gateway input so `CortiSdkGateway` emits Corti's dedicated token data part; all patient-scoped fields remain exclusive to the second message.

**Tech Stack:** TypeScript, Node.js 24, Node test runner, Corti SDK, SQLite.

---

### Task 1: Add the warm-up authentication regression

**Files:**
- Modify: `test/agent-runner.test.ts:49-99`
- Test: `test/agent-runner.test.ts`

- [ ] **Step 1: Write the failing test expectation**

In `first investigation completes data-free warmup and maps context before scoped data`, replace the first-call `input.data` assertion with the exact token-only contract and explicit clinical-field exclusions:

```ts
assert.equal(input.contextId, undefined);
assert.deepEqual(input.data, { mcpToken: "mcp-secret" });
assert.equal(input.data?.patientId, undefined);
assert.equal(input.data?.interactionId, undefined);
assert.equal(input.data?.signalText, undefined);
assert.equal(input.data?.evidenceRefs, undefined);
assert.doesNotMatch(input.text, /karen|patient|interaction/i);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
export PATH=/Users/solvisantos/corti-hackathon-2026-research/hackathon-kit/.tools/node-v24.19.0-darwin-arm64/bin:$PATH
npm run build && node --test build/test/agent-runner.test.js
```

Expected: the warm-up test fails because actual `input.data` is `undefined` instead of `{ mcpToken: "mcp-secret" }`.

### Task 2: Authenticate the data-free warm-up

**Files:**
- Modify: `src/agent/runner.ts:68`
- Test: `test/agent-runner.test.ts`

- [ ] **Step 1: Implement the minimal production change**

Replace the warm-up send with:

```ts
const submitted = await this.gateway.send({
  text: WARMUP_PROMPT,
  data: { mcpToken: this.mcpToken },
});
```

Do not add patient, interaction, signal, or evidence fields to this call.

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```bash
export PATH=/Users/solvisantos/corti-hackathon-2026-research/hackathon-kit/.tools/node-v24.19.0-darwin-arm64/bin:$PATH
npm run build && node --test build/test/agent-runner.test.js
```

Expected: all AgentRunner tests pass.

- [ ] **Step 3: Run complete backend verification**

Run:

```bash
export PATH=/Users/solvisantos/corti-hackathon-2026-research/hackathon-kit/.tools/node-v24.19.0-darwin-arm64/bin:$PATH
npm run lint
npm test
git diff --check
```

Expected: lint passes, all root backend tests pass, and `git diff --check` reports no errors.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/agent/runner.ts test/agent-runner.test.ts
git commit -m "fix: authenticate Corti agent warmup"
```

### Task 3: Publish and verify the fix

**Files:**
- No source changes expected.

- [ ] **Step 1: Push the isolated branch**

```bash
git push -u origin fix/agent-warmup-auth
```

Expected: the remote branch is created without changing `main` or the concurrent feature branch.

- [ ] **Step 2: Open a pull request**

Create a PR targeting `main` that records the live `auth-required` reproduction, the token-only warm-up fix, and local verification results.

- [ ] **Step 3: Verify after deployment**

After the PR is merged and the Agentic Railway service is deployed from the merged commit:

```bash
curl -sS https://agentic-production-6705.up.railway.app/healthz
curl -sS -o /dev/null -w '%{http_code}\n' https://agentic-production-6705.up.railway.app/mcp
```

Expected: `/healthz` returns `{ "ok": true }`; unauthenticated `/mcp` remains `401`. Then submit one synthetic candidate through the public Integration API and require a completed Corti result plus a consistent ledger readback.
