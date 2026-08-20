# Ward Threads — a standalone clinical workflow layer

Refine the overlay into a self-contained tool that clips onto any EHR (Nervecentre stays the demo host). Fewer surfaces, calmer nordic design, one clear loop: listen → capture → assign → complete → learn.

## The core loop

```text
ambient mic  ->  agent drafts checkpoints  ->  clinician taps accept
                                   |
                          patient activity thread
                       (chronological, newest work at top)
                                   |
                    task owner  ->  done  ->  board + insights update
```

## Surfaces (three, down from a scattered set)

1. **Ward board** — every bed by bay. Per patient: open task count, today's event, what they're waiting for, planned-home flag, or a calm "clear for discharge" line. Inline flow signals in the header: beds occupied, discharges planned today/tomorrow, blocked discharges, staff free right now.
2. **Patient activity** — one thread per patient, no thread-per-task. The ambient round folds in here: a live mic strip at the top streams the transcript and surfaces agent-drafted checkpoints inline; below it, a chronological log of what has happened. Each entry collapses to one line (what, who owns it, when) and expands to its progress trail, an update box, and the actions: claim, offer to someone free, verify done, needs a decision, ask for help. Filing a scribed note to the EHR stays a single button.
3. **Insights** — compact, four blocks only: task completion today (done vs open, average time to close), staff load and who is free, discharge flow (planned, blocked, and what blocks them), and bottlenecks (which task types wait longest). Read-only, no charts library beyond simple bars — never framed as blaming an individual.

## Design direction

Ice & indigo: background `#F6F8FB`, borders `#DDE4ED`, text `#3A4356`, single accent `#3F5B96`. Status colours stay muted and reserved for state only. Generous whitespace, hairline borders, small radii, near-flat surfaces, one weight of shadow. Type set in a quiet grotesk with tabular figures for times and counts. Motion limited to short fades — nothing bounces on a ward.

## EHR-agnostic framing

The panel keeps its own identity and never mimics the host EHR chrome: its own header with patient context read from whatever record is open, a "Connected to: Nervecentre" indicator, and a single "File to record" path out. Patient context syncs both ways — pick a bed on the board and the EHR follows; switch patient in the EHR and the activity thread follows.

## What gets removed

- Per-task thread cards grouped by patient in the old sidebar.
- The separate Live round tab and its duplicate patient header.
- The standing hardcoded suggestion card with the inert Dismiss button.
- "Why it matters" prose blocks and the full candidate roster on every item — the offer action keeps one suggested free person, the rest sit behind a small picker.

## Technical notes

- `src/styles.css`: retune the token palette to the ice & indigo values in OKLCH; keep the existing status token names so components need no colour rewrites.
- `src/data/ward.ts`: keep the current mock shape (threads become "activity items" per patient); add light staff availability and simple derived metrics for Insights.
- `src/components/ward/LiveRound.tsx` folds into a `LiveStrip` rendered inside the activity view; `ThreadSidebar.tsx` becomes `PatientActivity.tsx`.
- New `src/components/ward/Insights.tsx` computing everything from in-memory state — no new data source.
- `src/routes/index.tsx`: tabs become Board / Activity / Insights, arrow keys and double-Shift shortcuts unchanged.
- Still fully client-side mock data, no backend.
