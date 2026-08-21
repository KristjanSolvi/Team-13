# Final demo readiness

Updated 2026-08-21. This file records the evidence standard for the demo; it is
not a substitute for the live preflight.

## Corti product story

| Product | Demonstrated value | Runtime evidence |
| --- | --- | --- |
| Ambient | Captures the ward conversation, final transcript, audio quality, and usage | Live strip plus activity receipt |
| FactsR | Pulls structured facts from the same live interaction without turning them into actions | Fact chips plus activity receipt |
| Text Generation | Reviews possible wording mismatches, extracts grounded candidates, and drafts clinician-reviewed documents/patient instructions | Credits and activity receipt |
| Agentic Framework | Checks the patient record and open work before proposing follow-through | Candidate context state and activity receipt |
| Remote MCP connector | Gives Agentic narrow patient-scoped record/ledger tools operated by this team | Agentic result and authoritative ledger activity |
| Dictation | Lets the clinician correct task routing by voice, with typed fallback and a preview before mutation | Explicit task correction step and activity receipt |
| Medical Coding | Returns evidence-linked codes/candidates for an explicit accept/reject review | Record closure, persisted EHR version, and activity receipt |

## UI wiring map

The live demo path has one visible surface for every qualifying Corti product
and each authoritative workflow boundary:

| Runtime capability | UI surface |
| --- | --- |
| Ambient, FactsR, transcript review and task-agent investigation | Activity → live Corti strip |
| Clinician task approval and the authoritative ledger lifecycle | Activity → expanded backend task |
| Availability-, capability-, and workload-aware owner selection | Expanded offered task → Demo smart assignment → durable decision receipt |
| Dictation correction with preview-before-mutation | Expanded backend task → correction panel |
| Grounded handover Agentic/MCP run plus Text Generation | Agent and record tools → grounded handover |
| Source-revision dependencies | Agent and record tools → Change Radar |
| Text Generation, Medical Coding, EHR versioning and explicit filing | Nervecentre → Notes → record closure |
| Ward-meeting Agentic reconciliation and audience assignment | Fluence → Demo Studio |
| Pipeline, Agentic, profile, EHR and downstream reachability | Agent and record tools → system wiring |

The ward roster is synthetic. Every displayed patient is seeded into the
patient-scoped Agentic record and profile services, while only Karen's task
list replaces the local presentation fixtures with authoritative ledger work.
This keeps the visual scenario rich without allowing fixture tasks to
masquerade as backend state.

The activity receipt is intentionally event-backed. A product remains **Not
run** until this browser sees a real SDK event or API result. It stores only
product, safe action label, status, time, and optional credits; no clinical
text, credential, or hidden model content is stored.

## MCP disclosure

The submission uses team-operated remote Streamable HTTP MCP servers connected
through Corti Agentic. It does not add an external registry MCP or a third-party
clinical data connector. The task, handover, and meeting agents each receive a
separate least-authority tool surface, while the same private bearer mechanism
protects every mount. This matches Corti's remote connector model and keeps the
novel value in our patient-scoped follow-through ledger.

Reference: [Corti Agentic connectors](https://docs.corti.ai/agentic/connectors).

## Agentic v1/v2 decision

The repository currently uses the SDK 5 Agentic v1 resource shape
(`client.agents.*` and `mcpServers`). V1 is deprecated, while v2 is the current
migration target. For the hackathon demo we keep the already tested v1 path
until a paid live smoke proves it is rejected or Corti explicitly directs the
team to migrate. A pre-demo speculative migration would change agent
provisioning, task/context calls, and remote-connector bearer handling at once.

Migration trigger:

1. Run the v1 preflight with the final tenant, agent IDs, MCP URL, and bearer.
2. Keep v1 if the agent reaches the authenticated MCP server and returns a
   completed/retained safe result.
3. Migrate to v2 only if v1 fails because the API surface is unavailable, or
   the Corti team confirms v2 is required for judging.
4. If triggered, follow Corti's migration guide and repeat MCP auth, context
   isolation, tool-activity, idempotency, and read-after-write tests before the
   demo.

References: [Corti v1-to-v2 migration guide](https://docs.corti.ai/agentic/guides/migrate-v1-to-v2),
[Corti API documentation](https://docs.corti.ai/).

## Live preflight

Never print or commit credential values. With ignored `.env` files restored,
run:

```bash
source /Users/solvisantos/corti-hackathon-2026-research/hackathon-kit/activate
npm run dev
npm run smoke:corti
```

Then exercise the browser path and confirm:

1. readiness reports `liveCortiReady: true`;
2. Ambient produces final transcript and FactsR evidence;
3. a suspicious phrase blocks downstream work until explicitly decided;
4. a confirmed interpretation, not the immutable raw transcript, grounds the
   candidate;
5. Agentic visibly reaches the authenticated patient-scoped MCP tools;
6. task correction exposes Corti Dictation and requires preview plus explicit
   apply;
7. an offered Karen task shows **Smart assignment is armed**; triggering the
   demo selects an eligible authoritative roster member and displays the five
   routing checks, workload ranking, and durable receipt;
8. Medical Coding requires accept/reject and the saved EHR history retains the
   attributed outcome; and
9. the live receipt reflects only the products actually exercised.

Current local limitation: the clean finalization worktree has no restored
Corti, Agentic, MCP, integration, or ngrok environment values, so the paid v1
smoke cannot be claimed as complete from this worktree yet.
