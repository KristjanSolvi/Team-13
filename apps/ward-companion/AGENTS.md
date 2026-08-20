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

Lovable is the source for visual design, interaction changes, and temporary
hackathon demo fixtures. Every sync must preserve these product boundaries:

- Seeded threads, checkpoints, activity trails, staff availability, operational
  counts, and discharge labels are allowed during the current demo phase. Keep
  them isolated and explicitly identifiable as demo fixtures so they can be
  removed cleanly later.
- Demo fixtures must not carry backend identifiers, masquerade as live data, or
  overwrite non-empty persisted work. Authoritative backend data remains the
  source of truth whenever it is available for a patient.
- Keep persisted live work and the v2-or-newer storage migration that removes
  the old v1 fixture state.
- Keep the EHR shell fixtures and the patient roster, names, beds, and EHR notes;
  those are intentional demo context until the product team says otherwise.
- Preserve Team-13 integrations such as the follow-through API, Corti pipeline,
  task correction flow, record closure, Railway configuration, and environment
  handling when porting Lovable UI changes.

After each sync, audit `src/data/ward.ts`, demo fixture files,
`src/components/ward`, and `src/routes/index.tsx` to keep fixtures separate from
backend state, then run typecheck, lint, and the production build before
committing.
