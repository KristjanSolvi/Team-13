# Corti skill sources

These files are unmodified snapshots of Corti's official Agent Skills. They are
kept in the repository so every team member and coding agent works from the same
API guidance during the hackathon.

- Publisher: Corti
- Published skill version: `2.6.2`
- Retrieved: `2026-08-20` (Europe/Copenhagen)
- Declared license: `ISC` (in each upstream `SKILL.md` frontmatter)

| Local snapshot | Upstream source | SHA-256 |
|---|---|---|
| `corti-ambient-scribe/SKILL.md` | <https://docs.corti.ai/.well-known/agent-skills/corti-ambient-scribe/SKILL.md> | `a011a1031c78c8154b17689d482c0783515b18c6e39904107b207b343b58db11` |
| `corti-dictation/SKILL.md` | <https://docs.corti.ai/.well-known/agent-skills/corti-dictation/SKILL.md> | `4348865fcafa4f652c337f88707ec184e706b3a274be86f63043a444453ce5c0` |
| `corti-medical-coding/SKILL.md` | <https://docs.corti.ai/.well-known/agent-skills/corti-medical-coding/SKILL.md> | `dc64e2782c446f7d04d626c67f3d3ccfe73561c81b1a63885ad994c4bcbc048a` |
| `corti-agentic-assistant/SKILL.md` | <https://docs.corti.ai/.well-known/agent-skills/corti-agentic-assistant/SKILL.md> | `37ac7a81343e6dadedb67fb203d8221c96f6472459ebe37123d21b297ff7d29b` |

Verify the snapshots from the repository root:

```bash
shasum -a 256 .agents/skills/corti-*/SKILL.md
```

When refreshing a snapshot, download the full raw upstream file, re-run the
skill validator, update the date and checksum here, and commit the refresh
separately from product code.
