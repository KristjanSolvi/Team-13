<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Lovable sync boundary

The canonical Lovable source for this UI is
`https://github.com/YaldesDev/remix-of-ward-companion.git`. It is a standalone
repository, while this application is embedded at `apps/ward-companion` in the
Team-13 repository. Fetch it through the `ward-ui` remote and port changes into
this directory path-by-path; do not merge its unrelated root history directly
into Team-13.

Lovable is the source for visual design and interaction changes, not runtime
ward data. Every sync must preserve these product boundaries:

- `initialThreads` starts empty. Never import seeded tasks, checkpoints, or
  activity trails into the Ward Threads overlay.
- Do not import hardcoded staff availability, assignment rosters, discharge
  readiness, expected-discharge dates, latest-plan text, or similar operational
  claims into Ward Threads.
- Keep persisted live work and the v2-or-newer storage migration that removes
  the old v1 fixture state.
- Keep the EHR shell fixtures and the patient roster, names, beds, and EHR notes;
  those are intentional demo context until the product team says otherwise.
- Preserve Team-13 integrations such as the follow-through API, Corti pipeline,
  task correction flow, record closure, Railway configuration, and environment
  handling when porting Lovable UI changes.

After each sync, audit `src/data/ward.ts`, `src/components/ward`, and
`src/routes/index.tsx` for reintroduced fixture work, then run typecheck, lint,
and the production build before committing.
