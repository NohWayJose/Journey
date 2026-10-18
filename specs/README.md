# Specifications

The specs in this folder are the source of truth for the Journey PoC/PoT.
Change the spec first, then the code.

| File | Purpose |
|---|---|
| `00-vision.md` | Problem, users, non-goals, timebox and exit criteria |
| `10-pot.md` | Proof of Technology: rendering (pele) and extraction (Claude) checks, with pass/fail criteria |
| `20-requirements.md` | User stories with numbered, testable acceptance criteria (`R-01`, `R-01a`, …) |
| `30-design.md` | Architecture, data model and key design decisions |
| `40-tasks.md` | Ordered implementation tasks, each linked to requirement IDs |
| `decisions.md` | Decision log: what was decided, when, why, and the alternatives |

Tests are named after the acceptance criteria they verify, e.g. `test('R-03a: …')`.
