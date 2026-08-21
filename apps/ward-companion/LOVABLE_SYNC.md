# Lovable UI synchronization

The Lovable repository and Team-13 have unrelated Git histories. Team-13 must
not merge `ward-ui/main` directly. Instead, Lovable owns presentation while the
Team-13 runtime owns state and integrations.

## Ownership boundary

- `src/components/ui`, `src/styles.css`, and visual ward/EHR components are the
  Lovable design surface.
- `src/features/ward-runtime` owns persisted ward state and translates UI
  commands into Team-13 behavior.
- `src/lib/follow-through-api.ts`, `src/lib/ward-persistence.ts`, Corti capture,
  transcript review, task correction, record closure, and backend-aware panels
  are Team-13 integration code.
- `src/data/demo-threads.ts` contains removable demo fixtures. Backend threads
  have backend references and replace demo data per patient when available.

The route is the composition root. It may change visually, but network calls,
ledger rules, backend IDs, and persistence belong in the runtime or integration
layer rather than in the route.

## Repeatable sync

From `apps/ward-companion`:

```sh
git fetch ward-ui main
npm run sync:lovable
npm run sync:lovable:safe
```

The report divides upstream changes into:

- **Safe to copy:** generic design-system/public files that can be imported
  mechanically.
- **Manual UI review:** product UI whose props or domain assumptions may have
  changed.
- **Team-13 protected:** files that must never replace live integrations.

Safe sync deliberately refuses upstream deletions. After manually porting and
reviewing the remaining UI, record the inspected upstream SHA with:

```sh
npm run sync:lovable:mark
```

Then run `npm run typecheck`, `npm run lint`, and `npm run build` before a
descriptive Team-13 commit. A successful build does not waive the manual check
that demo fixtures cannot overwrite persisted or authoritative backend data.
