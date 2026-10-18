# 30 — Design

Status: **Draft** · Last updated: 2026-10-18

This document grows as the design firms up. It currently covers the **Task Flow Model**,
which is needed first by the [Proof of Technology](10-pot.md), the **visual standard** for
error flows, and the first **API** notes.

## Task Flow Model

The Task Flow Model is the core artefact (D-006): Claude produces it, the API validates
and stores it, and renderers draw it.

- **Schema:** [`schemas/task-flow.schema.json`](../schemas/task-flow.schema.json) (JSON Schema 2020-12)
- **Worked example:** [`schemas/examples/checkout.flow.json`](../schemas/examples/checkout.flow.json)
- **Version:** `0.1.0` (`schemaVersion`). Breaking changes bump the minor version until 1.0.

### Document structure

| Part | Produced by | Contents |
|---|---|---|
| `source` | API | **Fully qualified path** to the VTT file, its SHA-256 at extraction time, cue count, duration (D-015) |
| `extraction` | API | Route (provider or MCP), provider or MCP client, model (D-024, D-026), timestamp, options (`mainSpeaker`, `interviewers`) |
| `cues` | API (VTT parser) | Timing index: cue ID, start, end, speaker. **No text**: the text stays in the VTT file at `source.path` |
| `flow` | **Claude** | The extracted task flow; `$defs/flow` is the structured-output schema |

The SHA-256 lets the API detect that the VTT file has changed since extraction, in which
case cue references may no longer match.

### `flow` contents

| Element | Maps to vision concept | Notes |
|---|---|---|
| `title`, `goal` | Goal | |
| `frequency`, `difficulty` | Step properties (for the whole task) | `measure`s for the task as a whole, e.g. *"a couple of times a week"* |
| `participants` | Speakers | How each VTT speaker label was interpreted: interviewer / participant, main speaker, shared connection, people heard under the label |
| `actors` | Actor | Anyone who performs a step, including organisations and systems that are only talked about. Linked to speaker labels where they spoke. Shared by the main flow and error flows |
| `steps` | Step, Conditionality, Outcomes | `kind`: `action`, `decision` (label is the question), `outcome` (`outcome`: success / failure / abandonment), or `return` (error flows only) |
| `steps[].frequency`, `.difficulty` | Step properties | `measure` (see below). On an outcome, `frequency` is how often the task ends that way |
| `steps[].attributes`, `.states` | Step properties | Name/value pairs. **Attributes** describe the step (*Tool: Supplier website*); **states** describe the condition of something at that step (*Payment: Declined*) (D-012) |
| `steps[].metrics`, `flow.metrics` | Completion metrics | `timeOnTask` (as stated, in minutes + quote) and `attempts`, per step and for the whole task |
| `transitions` | Flow, Conditionality | `condition` labels branches out of decisions |
| `errorFlows` | Completion metrics (errors and recovery) | Separate flows followed when something goes wrong (see [Error flows](#error-flows)) |
| `annotations` | Annotations | `kind`: note, hesitation, workaround, opinion, quote, `alternativeView` (D-004), `correction` (D-016). Attached to any step, transition, actor or error flow, or to the whole task (`targetId: null`) |
| every `evidence` | Evidence | Cue IDs that support the element |

IDs are unique across the whole document, including error flows, so any element can be
referenced unambiguously.

### Measures

```json
{ "value": 4, "basis": "scale", "threshold": null, "text": "I'd say a four, it's a real pain", "evidence": ["c8", "c9"] }
```

| `basis` | Meaning | `value` | Display |
|---|---|---|---|
| `scale` | Participant gave a scale value, spontaneously or when asked | 1–5 | Label + value, e.g. *Difficulty: Hard (4)* |
| `inferred` | Free text only; the extractor mapped it to the scale | 1–5 | Label + value, marked as inferred, e.g. *Difficulty: Easy (2)\** |
| `text` | Free text that can't be sensibly mapped | `null` | The quote |

When a participant gives both a scale value and free text for the same item, `basis` is
`scale` and `text` keeps the free text (D-003). **Labels are not stored**: they are derived
from `value` using the scales in the [vision](00-vision.md#scales), so they can't drift.

#### Threshold judgements

Participants often judge frequency or difficulty in **binary** terms against a tolerance
of their own that they rarely state: *"it doesn't happen often enough to bother me"* versus
*"it happens way too often"*. The threshold itself is vague; which side of it the
participant puts something on is the useful signal (D-014).

| `threshold` | Meaning | Display |
|---|---|---|
| `above` | Beyond the participant's tolerance: a **frustration signal** | Frustration marker on the element |
| `below` | Within tolerance: not a concern | Shown only in detail views |
| `null` | No binary judgement was expressed | — |

`threshold` is independent of `value`: a measure can have a scale value, a threshold
judgement, both, or neither (text only).

### Error flows

Errors are modelled as **separate flows**, each rendered as **its own diagram** (D-013).

```
main flow                                      error flow E1 ("Card declined")
─────────                                      ───────────────────────────────
[Authorise card] ┄┄► ⬡ ⚠ Card declined  ──────► ⬡ ⚠ From main flow: Authorise card
                       → Error flow E1                       │
                                                     [Re-enter card details]
       ▲                                                     │
       ┆                                                     ▼
   ◎ ↩ from E1  ◄──────────────────────────────── ◎ ↩ Back to main flow: Authorise card
```

- An error flow has one or more **triggers**: the main-flow step where the error occurs,
  what goes wrong (`condition`), and how often (`frequency`, including `threshold`).
- It has its own steps and transitions, starting at `startStepId`.
- It ends in **outcomes** (the task ends there) and/or **return steps**. A return step's
  `returnToStepId` names the main-flow step where the task continues.
- Error flows can't trigger other error flows in this version (keeps the schema
  non-recursive and the diagrams one level deep).

### Loops

Each flow (main and error) has a `loops` list (D-019). A loop refers to steps by ID, so the
schema stays non-recursive. Its **body** is every step on a path from `firstStepId` to
`lastStepId`.

| Field | Repeat | Iterate |
|---|---|---|
| `kind` | `repeat` | `iterate` |
| `firstStepId`, `lastStepId` | First and last step of the repeated span (may be the same step) | First step of the span; `lastStepId` is the **decision** that checks the criteria |
| `count` | `{ value, text, evidence }`: `value` is a number, or `null` when the count varies (*"for each receipt"*) | `null` |
| `pass`, `fail` | `null` | The `condition` labels of the decision's exit branch and loop-back branch |
| `iterations` | `null` | Typical passes as stated (`attempts` shape: `count` + quote), or `null` |
| `limit` | `null` | `{ count, text, errorFlowId, evidence }`, or `null`. Running out of tries triggers error flow `errorFlowId` (from the decision step) |

- A **repeat has no back transition** in the model: the loop itself says the span repeats.
- An **iteration's back transition is a real transition** (decision → `firstStepId`, labelled
  with `fail`); the loop record explains it.
- Annotations can target a loop (e.g. a correction to its count).

Worked example: fixture F9 (site safety inspections): a repeat × 5 containing a
"for each extinguisher" repeat, and an iteration with a limit that triggers an error flow.

### Visual standard for error links

| Element | Appears on | Shape | Content | Style | Link |
|---|---|---|---|---|---|
| **Error link-out** | Main diagram, next to the trigger step | Hexagon | `⚠ <condition>` / `→ Error flow <id>` | Red border, light red fill; dashed red edge from the step | Opens the error flow's diagram |
| **Error entry** | Error diagram, at the start | Hexagon (same as link-out) | `⚠ From main flow: <trigger step label>` | Same as link-out | Opens the main diagram |
| **Error return** | Error diagram, at each return step | Double circle | `↩ Back to main flow: <target step label>` | Red double border, white fill | Opens the main diagram |
| **Error re-entry** | Main diagram, next to the step it comes back in to | Double circle (same as return) | `↩ from <error flow id>` | Same as return; dashed red edge **into the target step** | Opens the error flow's diagram |

Rules:

- Connector nodes sit in the **same lane** as the step they attach to.
- Pairs use the same shape on both diagrams (hexagon for out/entry, double circle for
  return/re-entry), so the reader can match them up.
- The hexagon and double-circle shapes are reserved for error links; annotations use the
  flag shape.

Initial rendering of this standard (see PT-15):

| Main diagram | Error flow diagram |
|---|---|
| ![main](evidence/pot/2026-10-18-error-link-main.png) | ![error flow](evidence/pot/2026-10-18-error-flow.png) |

### Output files

Rendering produces one SVG for the main flow and one per error flow, **always written to
the same directory**:

| File | Contents |
|---|---|
| `<name>.svg` | Main flow |
| `<name>.error-<id>.svg` | Error flow `<id>`, e.g. `checkout.error-E1.svg` |

Because they share a directory, the connector links are **relative file names**
(e.g. `href="checkout.error-E1.svg"`). pele passes relative links through unchanged
(checked 2026-10-18).

### Evidence and timestamps

- The VTT parser gives every cue a stable ID (`c1`, `c2`, …) and sends Claude the cues as
  `[c12 00:04:12 Sam] text`.
- Claude cites cue IDs only. **Timestamps are always looked up from `cues` by our code**,
  so the model can't invent a timestamp.
- Every element must cite at least one cue (PE-02).
- Because accounts are non-linear ([vision](00-vision.md#non-linear-accounts)), a step's
  evidence often cites cues far apart in the transcript, e.g. where it was first
  described and where a detail or correction was added later.

### Extraction sees the whole transcript

Extraction sends the **whole transcript in one request**, never in sequential chunks
(D-016). Participants jump back and forth and correct themselves, so the meaning of a
cue can depend on something said much earlier or later. A 60-minute interview is about
20k tokens, well within the model's context window.

If a transcript is ever too long for one request, the fallback is a two-pass approach
(extract per section, then reconcile across the whole), not independent chunks.

### Structured-output constraints

`$defs/flow` is sent to the Claude API as the structured-output schema, so the schema
keeps to what structured outputs support:

- `additionalProperties: false` on every object, and every property listed in `required`.
  Optional values are `anyOf: [<type>, null]`, not omitted.
- No recursion: flows are flat graphs of steps and transitions linked by ID, and error
  flows don't nest.
- No `minimum` / `maximum` / `minLength` / `pattern`: Likert values are `enum: [1, 2, 3, 4, 5]`.
  Other constraints are checked by the semantic rules below.

Unit tests check these constraints (`DS-01` to `DS-03`).

### Semantic rules

JSON Schema can't express everything. After schema validation, the API checks:

| ID | Rule |
|---|---|
| DS-10 | All IDs (actors, steps, transitions, error flows, annotations) are unique across the document |
| DS-11 | Every `actorId`, `from`, `to`, `targetId`, `startStepId`, `fromStepId` and `returnToStepId` refers to an existing element |
| DS-12 | Every `evidence` list is non-empty and every cue ID exists in `cues` |
| DS-13 | A `decision` has at least two outgoing transitions, each with a `condition` |
| DS-14 | Only `decision` steps have more than one outgoing transition |
| DS-15 | An `outcome` step has an `outcome` value and no outgoing transitions; other steps have `outcome: null` |
| DS-16 | Every flow (main and error) has at least one end (outcome or return), and every step is reachable from its flow's `startStepId` |
| DS-17 | `return` steps appear only in error flows, have no outgoing transitions, and their `returnToStepId` is a **main-flow** step; other steps have `returnToStepId: null` |
| DS-18 | A `measure` with `basis` `scale` or `inferred` has a `value`; with `basis` `text` it has `value: null` and non-null `text` |
| DS-19 | Exactly one `participant` is the main speaker, and none of the `interviewer` participants is |
| DS-20 | No step's evidence consists only of interviewer cues (D-005) |
| DS-21 | Every error flow has at least one trigger, and every trigger's `fromStepId` is a main-flow step |
| DS-22 | Transitions connect steps within the same flow (main-to-error links happen only through triggers and returns) |
| DS-23 | A loop's `firstStepId` and `lastStepId` are steps in the loop's own flow, and `lastStepId` is reachable from `firstStepId` |
| DS-24 | An `iterate` loop: `lastStepId` is a decision with a transition back to `firstStepId` labelled `fail` and another labelled `pass`; `count` is `null` |
| DS-25 | A `repeat` loop has a `count` and no `pass`, `fail`, `iterations` or `limit`, and nothing in its body transitions back to `firstStepId` |
| DS-26 | **Every cycle is a declared iteration:** with each `iterate` loop's back transition removed, every flow is acyclic |
| DS-27 | Loops nest cleanly: any two loop bodies are either disjoint or one contains the other |
| DS-28 | An iteration's `limit.errorFlowId`, when set, names an error flow with a trigger from the loop's decision step |

## Compiling to diagrams

`compileTaskFlow(flow, cues, options)` turns a Task Flow Model into Mermaid text: one
diagram for the main flow and one per error flow. `renderTaskFlow` passes each to pele
and returns the SVGs with their [file names](#output-files). Compilation is deterministic
and never calls Claude (D-006).

| ID | Rule |
|---|---|
| CM-01 | Diagrams use `swimlane-beta` (direction `LR` by default). The title is set with front matter; error diagrams are titled *<task> — Error flow <id>: <title>* |
| CM-02 | One lane per actor with at least one node in that diagram, in `actors` order. **Every node is declared inside a lane**, including connectors and annotations (they take the lane of the step they attach to). The main diagram ends with a `Task` lane holding a summary node (goal, task frequency and difficulty, time on task, attempts) and task-level annotations |
| CM-03 | Node IDs are the model IDs with a prefix (`n_s1`, `x_out_E1_1`, …), so reserved words like `end` can never clash |
| CM-04 | Shapes: action = rectangle; decision = diamond; outcome = stadium; annotation = flag; error link-out/entry = hexagon; error return/re-entry = double circle (D-013) |
| CM-05 | Node text: the label, then (detail `full`, the default) one short line per property: frequency and difficulty as *Label (value)*, `*` if inferred, the quote if text-only; attributes as *name: value*; states as *name: value (state)*; *Time:* and *Attempts:*. Text wrapping is left to pele. Detail `summary` shows only the label and measures |
| CM-06 | A measure with `threshold: above` adds **▲** to its line and the `frustration` class to its node. `below` is not shown |
| CM-07 | Difficulty values 1–5 set classes `difficulty-1` … `difficulty-5`. Outcomes set `outcome-success`, `outcome-failure` or `outcome-abandonment`. Error connectors set `errOut` / `errRet`; annotations `annotation`; the task summary `summary`. **The Mermaid text contains class names only, never colours or line styles** (see [Styling](#styling)) |
| CM-08 | Error links follow the [visual standard](#visual-standard-for-error-links): link-out hexagon per trigger, in the trigger step's lane, dashed red edge from the step, linking to the error diagram; re-entry double circle per (error flow, target step), dashed red edge into the target, linking to the error diagram; on the error diagram, an entry hexagon per trigger into its start step, and each return step drawn as a return double circle; both link to the main diagram |
| CM-09 | Annotations are flags joined to their target by an undirected dotted line, prefixed by kind (*Note*, *Hesitation*, *Workaround*, *Opinion*, *Quote*, *Alternative view*, *Correction*). Alternative views and corrections show the speaker and the timestamp of their first cue. An annotation on a transition attaches to its source step; on an error flow, to its link-out (main) and entry (error diagram) |
| CM-10 | All model text is escaped with Mermaid entity codes (`#quot;`, `#lt;`, `#gt;`, `#amp;`, `#35;`), so text appears exactly as written and can't inject markup or syntax |
| CM-11 | Decision branches are labelled with their `condition` (`-->\|"…"\|`) |
| CM-12 | Each loop is drawn as a **loop marker** (rounded node, classes `loop` and `loop-repeat` / `loop-iterate`) in the lane of its first step, on a dashed loop-back path: repeat = last step ⇢ marker ⇢ first step, text **↻ × n** (+ the quote) or **↻ \<quote\>** when the count varies; iterate = decision ⇢ (labelled `fail`) ⇢ marker ⇢ first step, replacing the direct back edge, text **↻ until \<decision\> is \<pass\>**, plus *Usually: …* and *Limit: … → Error flow \<id\>* |

### Styling

All visual styling comes from **CSS**, so one corporate stylesheet can style every
diagram the tool produces (D-017).

- **Semantic hooks only.** The compiler attaches class names (CM-07); it never emits
  `classDef`, `style` or `linkStyle`, which pele would turn into inline styles that a
  stylesheet can't override.
- **What a stylesheet can target:**

  | Target | Selector |
  |---|---|
  | Colours and fonts for everything | `--pele-*` variables on `.pele` (e.g. `--pele-bg`, `--pele-fg`, `--pele-border`, `--pele-accent`, `--pele-font`) |
  | Node types | `.pele-node.difficulty-1` … `.difficulty-5`, `.frustration`, `.outcome-success` / `-failure` / `-abandonment`, `.errOut`, `.errRet`, `.annotation`, `.summary` |
  | Node shapes | `.pele-shape-*` (e.g. `.pele-shape-hexagon`) |
  | Error edges | `.pele-edge[data-id*="_x_"]` (every edge touching an error connector) |
  | Annotation edges | `.pele-edge[data-id^="L_a_"]` |
  | Loop markers | `.pele-node.loop`, `.loop-repeat`, `.loop-iterate` |
  | Loop-back edges | `.pele-edge[data-id*="_l_"]` (every edge touching a loop marker) |

- **Default theme:** [`styles/journey.css`](../styles/journey.css), based on IBM Carbon (D-018), implements the
  [visual standard](#visual-standard-for-error-links). It uses `:where()` selectors
  (zero specificity), so any corporate rule overrides it regardless of load order.
- **Attaching stylesheets** (`renderTaskFlow` options):

  | Option | Output | Use |
  |---|---|---|
  | `stylesheets.embed` (default: the default theme) | `<style>` inside each SVG | Self-contained files (PT-14) |
  | `stylesheets.link` (hrefs) | `<?xml-stylesheet href="…"?>` before the `<svg>` | One shared corporate stylesheet across all output |
  | `defaultTheme: false` | Default theme left out | Corporate stylesheet takes over entirely |

  When an SVG is embedded inline in a web page, the page's own stylesheets also apply.
- **Dependency on pele's markup:** edge selectors rely on pele's `data-id` format for
  edges. That is recorded as a replaceability risk under PT-13.

| ID | Rule |
|---|---|
| ST-01 | Compiled Mermaid never contains `classDef`, `style` or `linkStyle` |
| ST-02 | The default theme is embedded unless `defaultTheme: false`; extra embedded stylesheets come after it |
| ST-03 | Linked stylesheets appear as `<?xml-stylesheet?>` processing instructions before the `<svg>`, in the order given |
| ST-04 | Any corporate rule overrides the default theme, whatever its specificity or load order (default selectors are all `:where()`) |

## VTT parsing

The parser turns a WebVTT file into cues: `{ id, startMs, endMs, speaker, text }`.

| ID | Rule |
|---|---|
| VT-01 | The file must start with `WEBVTT` (an optional BOM is allowed); otherwise it's rejected |
| VT-02 | A cue is an optional identifier line, a timing line `start --> end` (`hh:mm:ss.mmm` or `mm:ss.mmm`, optional cue settings after), then text lines up to a blank line. CRLF and LF line endings are both accepted |
| VT-03 | `NOTE`, `STYLE` and `REGION` blocks are ignored |
| VT-04 | The speaker is taken from the first voice tag (`<v Name>` or `<v.class Name>`). If there is none and the text starts with `Name: ` (Zoom style; name up to 40 characters, no digits-only names), that prefix is the speaker and is removed from the text. Otherwise the speaker is `null` |
| VT-05 | All other tags are removed (`<c>`, `<i>`, `<b>`, `<u>`, `<lang>`, `<ruby>`, inline timestamps) and entities decoded (`&amp;` `&lt;` `&gt;` `&nbsp;` `&lrm;` `&rlm;`). Text lines are joined with a space |
| VT-06 | Cues get IDs `c1`, `c2`, … in file order, ignoring the file's own identifiers. Cues whose text is empty after VT-05 are dropped before numbering |
| VT-07 | A malformed timing line, or an end time before its start time, is an error that reports the line number |
| VT-08 | Duration is the latest cue end time |

## Code layout

| Path | Contents |
|---|---|
| `src/vtt/` | VTT parser (VT-xx) |
| `src/model/` | Task Flow Model validation: schema (Ajv) and semantic rules (DS-xx); Likert scales |
| `src/extract/` | Shared extraction instructions and transcript formatting (EX-xx) |
| `src/api/` | The API: canonical operations called by every adapter (D-001) |
| `src/llm/` | Model provider layer (LL-xx); the only code that uses a provider SDK |
| `src/adapters/mcp/` | MCP adapter (MC-xx); setup in `docs/mcp.md` |
| `src/render/` | Compiler to Mermaid (CM-xx) and renderer (pele + stylesheets, ST-xx). The only code that uses pele |
| `styles/journey.css` | Default Carbon-based theme |
| `scripts/render-fixtures.mjs` | Renders all fixtures to `out/fixtures/` (git-ignored) for visual review, optionally with light/dark screenshots |
| `tests/fixtures/<ID>-<name>/` | `transcript.vtt` and `expected.flow.json` (the `flow` part only: what a perfect extraction would return) |

## Aggregation (phase 2, initial design)

See the [vision](00-vision.md#aggregating-interviews-phase-2) for the purpose and
definitions. This section will become detailed rules when phase 2 starts.

### Aggregate Model (outline)

| Part | Produced by | Contents |
|---|---|---|
| `study` | API | Study name, the interviews (VTT path, SHA-256, Task Flow Model reference), options (thresholds), attribute file path |
| `canonicalSteps` | **Claude** (align) | `{ id, label, kind, members: [{ interviewId, stepId }] }`. Error flows and loops are aligned the same way (`canonicalErrorFlows`, `canonicalLoops`) |
| `paths` | Code | Per interview: its main-speaker flow as canonical steps and transitions |
| `groups` | Code (+ Claude names) | `{ id, kind: common \| variant \| outlier, interviews, distinctiveSteps, distinctiveTransitions, name, description }` |
| `support` | Code | Per canonical step and transition: interviews containing it, count, percentage |
| `measures` | Code | Per canonical step: median difficulty and frequency (scale values only; inferred ones counted separately), frustration count, error-flow and loop occurrence |
| `attributePatterns` | Code | Per group: attribute values over-represented relative to the study (count in group vs count in study) |
| `alternativeViews` | Code | Within-interview alternative views mapped to canonical steps (reported, not counted as paths, D-021) |

Every canonical element keeps its `members`, so any figure can be traced to interviews,
their steps and, through them, the transcript cues.

### Alignment (Claude)

- Input: every interview's Task Flow Model (labels, descriptions, actors, order), **not**
  the transcripts, so the request stays small even for large studies, and **not**
  participant attributes (D-023).
- Output (structured output): canonical steps and the mapping of each interview step to one
  canonical step. A step that matches nothing becomes its own canonical step with a single
  member, which is how outliers' unusual steps survive.
- Validated like the Task Flow Model: every interview step mapped exactly once, members
  refer to existing steps, canonical labels unique.

### Grouping (code)

- Each path is reduced to a set of canonical transitions (plus step presence).
- Similarity between interviews: candidates to evaluate in PoT Part C are Jaccard
  similarity on transitions, and sequence alignment of ordered steps.
- Groups: hierarchical clustering with a cut-off, then the thresholds (D-022) decide
  common / significant variant / outlier. The **common flow** is the set of steps and
  transitions with support ≥ 60%, regardless of group.
- Deterministic: same input, same groups (ties broken by interview order).

### Participant attributes CSV

```csv
file,role,site,experience
interview-01.vtt,Night shift,Leeds,5+ years
interview-02.vtt,Day shift,York,1-2 years
```

- Header row required; first column `file` matches the VTT file name; any number of
  attribute columns; empty cells mean unknown.
- An attribute value is reported for a group when it is over-represented, e.g.
  *5 of 6 in Variant A vs 8 of 24 in the study*. Descriptive only.

### Caching and incremental runs

Each interview's Task Flow Model is cached, keyed by the VTT's SHA-256, the model and the
schema version. Adding an interview extracts only that interview; alignment and grouping
are re-run over all models (cheap: they work on models, not transcripts).

### Output files

All in one directory (as with error flows): `<study>.svg` (aggregate), one
`<interview>.svg` per interview (plus its `<interview>.error-<id>.svg`), linked both ways.

### API

| Operation | Purpose |
|---|---|
| `aggregate` (e.g. `POST /studies/{studyId}/aggregate`) | Input: VTT paths (or existing Task Flow Documents), optional attribute CSV path, thresholds. Output: Aggregate Model + diagrams |

## Extraction

`extract(vttPath, { llm, mainSpeaker, interviewers })` turns a transcript into a validated
Task Flow Document. Two routes share everything except who runs the model (D-026):

| | Provider route | MCP route |
|---|---|---|
| Who runs the model | Journey, through a model profile (Claude by default) | The MCP client's own model (e.g. IBM Bob, Claude Code) |
| Instructions | The shared extraction instructions, as the system prompt | The same instructions, served by an MCP tool |
| Output constraint | Structured outputs where the provider supports them | None: the validator is the guarantee |
| Fix-ups | Automatic retry with validation errors (EX-05) | The client fixes and resubmits |
| Provenance | `route: provider`, provider and serving model | `route: mcp`, client name as reported, model as reported (or `unknown`) |

### Shared extraction instructions

The interpretation rules (speakers, consensus and divergence, non-linear accounts,
repetition, measures, scales, evidence) are written **once**, in `src/extract/instructions.js`,
and used by both routes. They restate the [vision's rules](00-vision.md#transcript-interpretation-rules)
for the model; when a rule changes in the vision, the instructions change with it.

### Prompt

- The transcript is sent whole (D-016), one cue per line: `[c12 00:04:12 Sam] text`.
- A **speaker summary** computed by our code comes first: each label's speaking time and
  cue count, plus any `mainSpeaker` / `interviewers` options. The model decides roles from
  this and the content (D-008, D-009).

| ID | Rule |
|---|---|
| EX-01 | The VTT is parsed (VT-xx); a file with no cues is rejected before any model call |
| EX-02 | The prompt contains the speaker summary, then every cue in order, each with its ID, timestamp and speaker |
| EX-03 | The model is asked for `$defs/flow` as a standalone JSON Schema (the flow plus all definitions it uses) |
| EX-04 | Every result is validated (schema + DS rules) against the parsed cues |
| EX-05 | Provider route: if validation fails, the request is repeated up to **2** more times with the validation errors appended; after that, extraction fails with the errors. Nothing invalid is ever returned or saved |
| EX-06 | The document is assembled by code: `source` (fully qualified VTT path, SHA-256, cue count, duration), `extraction` (route, provider, client, model, timestamp, options), `cues` (timing index, no text) and the validated `flow` |
| EX-07 | The recorded model is the one that **served** the final request (LL-05) |

## MCP adapter

An MCP server (`src/adapters/mcp/`) exposes the API to MCP clients such as IBM Bob, so a
client's own model can do extraction while Journey supplies the rules, validation and
rendering (D-026). Like every adapter it contains no business logic.

| Tool | Does |
|---|---|
| `parse_vtt(path)` | Parses the transcript; returns the speaker summary and the numbered cues, formatted as in the prompt |
| `get_extraction_instructions()` | Returns the shared instructions and the flow JSON Schema |
| `validate_task_flow(path, flow)` | Validates a flow against that transcript; returns the errors (empty if valid) |
| `save_task_flow(path, flow, outFile, model?)` | Validates, assembles the document (route `mcp`, client name from the MCP connection, model as reported) and writes it |
| `render_task_flow(file, outDir)` | Renders a saved Task Flow Document to SVGs (main + error flows) |
| `get_source_path(file)` | Returns the fully qualified VTT path of a saved document (as `GET /flows/{flowId}/path`) |

| ID | Rule |
|---|---|
| MC-01 | Tools call the API functions; no business logic in the adapter |
| MC-02 | File access is limited to **allowed directories**: `JOURNEY_ALLOWED_DIRS` (path-separated), defaulting to the server's working directory. Paths outside them are refused |
| MC-03 | Tool errors (invalid VTT, validation failures, refused paths) are returned as tool errors with readable messages, never crashes |
| MC-04 | Runs locally over stdio; it makes no model calls of its own |

## Model providers

The LLM used for extraction (and, in phase 2, alignment and group naming) is selectable
(D-024). **Claude is the default.**

### Provider interface

All LLM use goes through one small interface in `src/llm/`; nothing else imports a
provider SDK:

```js
generateStructured({ system, prompt, schema, schemaName, maxOutputTokens })
  → { json, usage: { inputTokens, outputTokens }, stopReason, provider, model }
```

- Prompts, schemas and validation are ours and provider-independent. **Validation always
  runs on the result** (D-006), whatever the provider.
- Each provider declares its **capabilities**:

  | Capability | Use |
  |---|---|
  | `structuredOutput`: `native` / `json` / `none` | `native`: schema-constrained output (Claude: `output_config.format`). `json`: JSON mode, then validate, retry up to 2 times with the validation errors. `none`: not supported for extraction |
  | `contextWindow` (tokens) | A transcript that doesn't fit is **rejected with a clear error**, never truncated or chunked (D-016) |
  | `maxOutputTokens` | Request sizing |

- Provider-specific failures (refusals, output cut off at the token limit, rate limits)
  are mapped to common error types; no partial model is ever written (PE-07).

| ID | Rule |
|---|---|
| LL-01 | A request's `llm` selection resolves to a configured profile: none → `defaultProfile`; an unknown profile, or a model not in the profile's `allowedModels`, is an error |
| LL-02 | Credentials resolve per [Credentials](#credentials): `provider-default` passes nothing (the SDK's own chain applies); `env:NAME` reads that variable and errors (naming the variable) if it's unset; `null` uses none; any other scheme is an error |
| LL-03 | Secret values never appear in error messages, results or logs |
| LL-04 | Anthropic requests: the profile's model; streamed; `max_tokens` 64,000; adaptive thinking; `effort` from the profile; `output_config.format` = the JSON Schema; server-side refusal fallbacks (`fallbacks: "default"`) |
| LL-05 | Results: the JSON from the final text block, token usage, stop reason, and the provider and **model that actually served the request** (it can differ after a fallback) |
| LL-06 | A refusal raises `RefusalError` (with its category); output cut off at the token limit raises `TruncatedOutputError`; unparseable output raises `InvalidOutputError` |
| LL-07 | A prompt estimated to exceed the context window (less the output allowance) is checked with the provider's token counter, and if it really doesn't fit raises `ContextTooLongError` **before** any generation request |

### Providers

| Provider | Status | Notes |
|---|---|---|
| `anthropic` | **Default**, PoC | Official Anthropic SDK; `claude-opus-5-5`; structured outputs; adaptive thinking; streaming for long requests |
| `openai-compatible` | Later | Any server with an OpenAI-compatible API, including **local models** (e.g. Ollama, vLLM) that keep transcripts in-house |
| Others (e.g. Bedrock, Vertex, Gemini) | Later | Added as needed behind the same interface |
| IBM Bob | Example only | Bob is an AI IDE; IBM documents no API for external applications (checked 2026-10-18). An unofficial package suggests its gateway is OpenAI-style. An unverified example profile is in `journey.config.example.json`, to complete only from IBM documentation or a Bob administrator, using `openai-compatible` |

### Model profiles

Named profiles live in a **server configuration file** (`journey.config.json`, committed,
no secrets):

```json
{
  "llm": {
    "defaultProfile": "default",
    "profiles": {
      "default": { "provider": "anthropic", "model": "claude-opus-5-5", "effort": "high",
                   "credential": "provider-default" },
      "local":   { "provider": "openai-compatible", "baseUrl": "http://localhost:11434/v1",
                   "model": "my-local-model", "credential": null,
                   "allowedModels": ["my-local-model", "my-other-model"] }
    }
  }
}
```

- **Selecting through the API:** a request's optional `llm` field names a profile, with an
  optional model override if the profile lists it in `allowedModels`:
  `"llm": "local"` or `"llm": { "profile": "default", "model": "claude-opus-5-5" }`.
  Without `llm`, `defaultProfile` is used.
- **Callers can't supply a provider address or credential.** Otherwise a caller could send
  our credentials to a server of their choosing. Only the server operator defines profiles.
- Phase 2 may choose a profile per operation (`extract`, `align`, `name`), defaulting to the
  same one.
- The **provider and model used are recorded** in each Task Flow Document
  (`extraction.provider`, `extraction.model`) and are part of the extraction cache key.
- **Qualifying a model:** before a profile is used for real work, its model runs the
  extraction checks (PE-01 to PE-09) on the fixtures, and its results are recorded.

### Credentials

Profiles **reference** credentials; secrets are never in configuration files, requests,
Task Flow Documents, logs or error messages (D-025).

| `credential` value | Resolved from |
|---|---|
| `provider-default` | The provider SDK's own credential chain. For Anthropic: `ANTHROPIC_API_KEY`, else a profile stored by `ant auth login`, else workload identity federation |
| `env:NAME` | Environment variable `NAME` |
| `null` | No credential (e.g. a local model server) |
| Later: `vault:…`, `aws-sm:…`, `gcp-sm:…`, `azure-kv:…` | A secrets manager |

Recommended practice:

| Where | How |
|---|---|
| Developer machine | Preferably the provider's login (`ant auth login`), so no key sits in the project. Otherwise a git-ignored `.env`, loaded with Node's built-in `node --env-file=.env` |
| CI | CI secret store, injected as environment variables |
| Server | Secrets manager, or keyless workload identity where the provider supports it |
| Everywhere | `.env*` git-ignored; a secret scanner (e.g. gitleaks) as a pre-commit hook is recommended |

## API (initial notes)

The OpenAPI contract comes later (`20-requirements.md`, then `openapi.yaml`). Settled so far:

| Operation | Purpose |
|---|---|
| `GET /flows/{flowId}/path` | Returns the **fully qualified path** of the VTT file the flow was extracted from (`source.path`), e.g. `{ "path": "/home/greg/research/interviews/checkout-interview.vtt" }` (D-015) |

- Paths given to the API (e.g. by the CLI as a relative path) are resolved to a fully
  qualified path at extraction time and stored in that form.

## Open points for review

None at present.
