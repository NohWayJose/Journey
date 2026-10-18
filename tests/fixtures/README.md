# Test fixtures

Synthetic transcripts for the Proof of Technology ([specs/10-pot.md](../../specs/10-pot.md#fixtures)).
Real transcripts will be added when available.

Each `F<n>-<name>/` folder holds:

- `transcript.vtt`: the interview. Cue identifiers match the parser's IDs (`3` → `c3`) to
  make the expected result easy to check by eye; the parser ignores them (VT-06).
- `expected.flow.json`: the `flow` part of a Task Flow Document, i.e. what a perfect
  extraction would return. Unit tests check it against the schema and semantic rules.

| Fixture | Cues | Steps | Actors | Error flows | Exercises |
|---|---|---|---|---|---|
| F1 meeting room | 11 | 8 | 2 | 0 | Baseline: actor, goal, linear flow, task frequency and difficulty, time on task |
| F2 expense claim | 17 | 12 | 4 | 2 | Decisions; error flow that returns; error flow that can end in abandonment; attempts; outcome frequency; `above`/`below` thresholds; requested scale |
| F3 laptop setup | 15 | 10 | 4 | 0 | Two people on one connection (`Meeting Room 2`) in agreement |
| F4 stock count | 17 | 8 | 3 | 0 | Divergence: main speaker's flow, timestamped alternative views (approach, difficulty, time) |
| F5 repeat prescription | 17 | 9 | 3 | 0 | Requested scale, spontaneous scale, inferred value, text-only measure; interviewer questions that must not become steps (c11–c12) |
| F6 ward discharge | 48 | 33 | 5 | 2 | Size and legibility; second participant's alternative views; hesitation, workaround, notes; failure outcome |
| F7 lab order | 8 | 9 | 2 | 0 | Escaping: quotes, brackets, `\|`, `#`, `%%`, `&`, `<…>`, backticks, emoji, accented names; Zoom-style speakers |

`checkout.journey.js` is the small Mermaid sample used by the pele smoke tests.
