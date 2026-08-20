# Ward Companion

design a calm, minimal web app for hospital ward clinicians & nurses. It's a demo using mock data, no backend needed 

Concept: it sits beside a hospital's EHR and tracks things said in conversation (a symptom, a promised referral) through to verified completion, not just documentation. Each tracked item ("thread") has a status: pending (needs a clinician's yes/no), tracking (confirmed, in progress), verified (done), or escalated (missed deadline).

with 2 views

Two views, toggled:

A background hovering sidebar that can list patients with an active thread, using agentic system (just simulate this) to suggest what was said, why it matters, whats the next action the agent suggests (and allow people to manually input new tasks), offer the action to the right group of people involved who are free, allow people to take on the action/who's assigned, an activity trail with timestamps, then simple actions as one tap buttons, and edit options or write updates to an activity

Ward board — a gallery of beds, grouped into bays, showing every patient (not just active threads), a status count summary at top, and small clickable chips for each open item. A patient with nothing outstanding shows a calm "clear for discharge" line. Never blame a clinician for a delay — just show what's outstanding and who can help. Who's planned for home next day, what are people waiting for, what's happening today for each patient (eg. CT scan at 12pm)

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3d2ceb31-d443-4d7a-88dc-c45c4b094061).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
