# Journey

Turns WebVTT interview transcripts into SVG task-flow diagrams: Claude extracts a Task Flow
Model (JSON), which is compiled to Mermaid and rendered with pele.

## Spec-driven development

- `specs/` is the source of truth. Read `specs/00-vision.md` and the spec relevant to the
  task before writing code.
- **Change the spec first, then the code.** If implementation shows a spec is wrong, update
  the spec (and `specs/decisions.md` for decisions) before changing code.
- Record decisions in `specs/decisions.md` (next ID, date, reason, alternatives).
- Fill in the results table in `specs/10-pot.md` as PoT checks run.

## Architecture rules

- The **API is the canonical implementation** (OpenAPI contract). CLI, HTTP and other
  interfaces are thin adapters with **no business logic** (D-001).
- Claude outputs a schema-validated Task Flow Model; Claude never writes Mermaid (D-006).
- pele sits behind our own render interface so it can be replaced.
- Timestamps are resolved from cue IDs by our code, never taken from model output.

## Tests

- Playwright is the only runner: `npm run test:unit` (Node, no browser) and
  `npm run test:e2e` (Firefox). Never use the `page` fixture in `tests/unit/`.
- Name tests after the ID they verify: requirement criteria (`R-03a: …`), PoT checks
  (`PT-10: …`, `PE-02: …`) or design rules (`DS-01: …`).
- Fixtures live in `tests/fixtures/`. Transcripts are synthetic until real ones arrive.

## Conventions

- Node 25, ES modules, plain JavaScript for now.
- Pin dependencies to exact versions (`npm install --save-exact`).
- Claude API: official `@anthropic-ai/sdk`, model `claude-opus-5-5`, structured outputs.
  Credentials come from the environment and are never committed.
- Commit each green, self-contained step.
