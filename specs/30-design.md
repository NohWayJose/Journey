# 30 — Design

Status: **Draft** · Last updated: 2026-10-18

This document grows as the design firms up. It currently covers the **Task Flow Model**,
which is needed first by the [Proof of Technology](10-pot.md).

## Task Flow Model

The Task Flow Model is the core artefact (D-006): Claude produces it, the API validates
and stores it, and renderers draw it.

- **Schema:** [`schemas/task-flow.schema.json`](../schemas/task-flow.schema.json) (JSON Schema 2020-12)
- **Worked example:** [`schemas/examples/checkout.flow.json`](../schemas/examples/checkout.flow.json)
- **Version:** `0.1.0` (`schemaVersion`). Breaking changes bump the minor version until 1.0.

### Document structure

| Part | Produced by | Contents |
|---|---|---|
| `source` | API | VTT file name, SHA-256, cue count, duration |
| `extraction` | API | Model used, timestamp, options (`mainSpeaker`, `interviewers`) |
| `cues` | API (VTT parser) | Timing index: cue ID, start, end, speaker. **No text**, to limit personal data at rest |
| `flow` | **Claude** | The extracted task flow; `$defs/flow` is the structured-output schema |

### `flow` contents

| Element | Maps to vision concept | Notes |
|---|---|---|
| `title`, `goal` | Goal | |
| `participants` | Speakers | How each VTT speaker label was interpreted: interviewer / participant, main speaker, shared connection, people heard under the label |
| `actors` | Actor | Anyone who performs a step, including organisations and systems that are only talked about. Linked to speaker labels where they spoke |
| `steps` | Step, Conditionality, Outcomes | `kind`: `action`, `decision` (label is the question) or `outcome` (`outcome`: success / failure / abandonment) |
| `steps[].frequency`, `.difficulty` | Step properties | `measure`: Likert `value` 1–5 + `basis` + supporting `text` (see below) |
| `steps[].attributes`, `.states` | Step properties | Name/value pairs, e.g. *Tool: Supplier website*; *Payment: Declined* |
| `steps[].errorRecovery` | Completion metrics | `error`: something goes wrong here; `recovery`: this step puts it right |
| `steps[].metrics`, `flow.metrics` | Completion metrics | `timeOnTask` (as stated, in minutes + quote) and `attempts`, per step and for the whole task |
| `transitions` | Flow, Conditionality | `condition` labels branches out of decisions; `kind: retry` marks loops back after an error |
| `annotations` | Annotations | `kind`: note, hesitation, workaround, opinion, quote, `alternativeView` (D-004). Attached to a step, transition or actor, or to the whole task (`targetId: null`) |
| every `evidence` | Evidence | Cue IDs that support the element |

### Measures

```json
{ "value": 4, "basis": "scale", "text": "I'd say a four, it's a real pain", "evidence": ["c8", "c9"] }
```

| `basis` | Meaning | `value` | Display |
|---|---|---|---|
| `scale` | Participant gave a scale value, spontaneously or when asked | 1–5 | Label + value, e.g. *Difficulty: Hard (4)* |
| `inferred` | Free text only; the extractor mapped it to the scale | 1–5 | Label + value, marked as inferred, e.g. *Difficulty: Easy (2)\** |
| `text` | Free text that can't be sensibly mapped | `null` | The quote |

When a participant gives both a scale value and free text for the same item, `basis` is
`scale` and `text` keeps the free text (D-003). **Labels are not stored**: they are derived
from `value` using the scales in the [vision](00-vision.md#scales), so they can't drift.

### Evidence and timestamps

- The VTT parser gives every cue a stable ID (`c1`, `c2`, …) and sends Claude the cues as
  `[c12 00:04:12 Sam] text`.
- Claude cites cue IDs only. **Timestamps are always looked up from `cues` by our code**,
  so the model can't invent a timestamp.
- Every element must cite at least one cue (PE-02).

### Structured-output constraints

`$defs/flow` is sent to the Claude API as the structured-output schema, so the schema
keeps to what structured outputs support:

- `additionalProperties: false` on every object, and every property listed in `required`.
  Optional values are `anyOf: [<type>, null]`, not omitted.
- No recursion: the flow is a flat graph of steps and transitions linked by ID.
- No `minimum` / `maximum` / `minLength` / `pattern`: Likert values are `enum: [1, 2, 3, 4, 5]`.
  Other constraints are checked by the semantic rules below.

Unit tests check these constraints (`DS-01` to `DS-03`).

### Semantic rules

JSON Schema can't express everything. After schema validation, the API checks:

| ID | Rule |
|---|---|
| DS-10 | All IDs (actors, steps, transitions, annotations) are unique |
| DS-11 | Every `actorId`, `from`, `to`, `targetId` and `startStepId` refers to an existing element |
| DS-12 | Every `evidence` list is non-empty and every cue ID exists in `cues` |
| DS-13 | A `decision` has at least two outgoing transitions, each with a `condition` |
| DS-14 | Only `decision` steps have more than one outgoing `normal` transition |
| DS-15 | An `outcome` step has an `outcome` value and no outgoing transitions; other steps have `outcome: null` |
| DS-16 | There is at least one `outcome` step, and every step is reachable from `startStepId` |
| DS-17 | `retry` transitions start at a step marked `recovery` or `error`, or at a step reachable from one |
| DS-18 | A `measure` with `basis` `scale` or `inferred` has a `value`; with `basis` `text` it has `value: null` and non-null `text` |
| DS-19 | Exactly one `participant` is the main speaker, and none of the `interviewer` participants is |
| DS-20 | No step's evidence consists only of interviewer cues (D-005) |

## Open points for review

1. **Attributes vs states:** the draft treats both as name/value pairs: *attributes*
   describe the step (tool used, location), *states* describe the condition of something
   at that step (order on hold, payment declined). Is that the distinction you intended?
2. **Error and recovery** are per-step markers plus `retry` transitions. Is that enough, or
   should errors be their own elements (e.g. with a cause and frequency)?
3. **Metrics on outcomes:** should outcomes carry how often they happen
   (e.g. "about one time in five I give up"), as a Likert frequency?
4. **Cue text at rest:** the stored document keeps cue timings but not cue text. Reviewing
   evidence then needs the original VTT. Is that the right trade-off?
