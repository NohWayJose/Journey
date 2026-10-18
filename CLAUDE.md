# Journey

## MCP adapter — quick start for a new session

The MCP server is configured in **`.bob/mcp.json`** and loads automatically when Bob opens
this folder. The tools (`get_extraction_instructions`, `parse_vtt`, `validate_task_flow`,
`save_task_flow`, `render_task_flow`, `get_source_path`) are described in `docs/mcp.md`.

**Before using the tools on a new machine**, update the absolute paths in `.bob/mcp.json`
to match the local checkout (both the `args` path to `server.js` and `JOURNEY_ALLOWED_DIRS`).

### Workflow to extract and render a task flow from a VTT

1. Call `get_extraction_instructions` and `parse_vtt` in parallel.
2. Build the Task Flow Model JSON from the cues, ordering steps by when they happen in the
   task (not when mentioned). Handle self-corrections, loops and error flows per the rules.
3. Call `validate_task_flow`; fix every reported error before continuing.
4. Call `save_task_flow` (output to `out/<name>.flow.json`).
5. Call `render_task_flow` (output SVGs to `out/<name>/`).

Test fixtures are in `tests/fixtures/` (subdirectories F1–F9). Each has a `transcript.vtt`
and an `expected.flow.json` to validate against. F8-vat-return-nonlinear has been extracted
successfully with this workflow and its output is in `out/`.


Turns WebVTT interview transcripts into SVG task-flow diagrams: Claude extracts a Task Flow
Model (JSON), which is compiled to Mermaid and rendered with pele.

## Spec-driven development

- `specs/` is the source of truth. Read `specs/00-vision.md`, `specs/status.md` (where we
  are, what's next) and the spec relevant to the task before writing code.
- **Change the spec first, then the code.** If implementation shows a spec is wrong, update
  the spec (and `specs/decisions.md` for decisions) before changing code.
- Record decisions in `specs/decisions.md` (next ID, date, reason, alternatives).
- Fill in the results table in `specs/10-pot.md` as PoT checks run.
- Keep `specs/status.md` current: update it in the same commit as any step that changes
  what's done, what's next or what's loose. Anything decided in conversation that a future
  session needs belongs in the specs, not only in chat.

## Architecture rules

- The **API is the canonical implementation** (OpenAPI contract). CLI, HTTP and other
  interfaces are thin adapters with **no business logic** (D-001).
- The LLM (Claude by default) outputs a schema-validated Task Flow Model; it never writes Mermaid (D-006).
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
- LLM access only through `src/llm/` (provider interface, D-024). Default provider: official `@anthropic-ai/sdk`, model `claude-opus-5-5`, structured outputs.
  Credentials are referenced by name (D-025): never committed, logged or sent in requests.
- Commit each green, self-contained step.
