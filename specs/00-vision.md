# 00 — Vision

Status: **Draft** · Last updated: 2026-10-18

## Problem

User research produces recordings of people describing how they do a task. Turning
those transcripts into a task-flow diagram is slow, manual, and inconsistent: an analyst
re-reads the transcript, picks out the steps, decides who does what, notices where the
flow branches, and redraws it by hand. Detail such as how often a step happens, how hard
it is, or the side remarks a participant makes often gets lost.

## Vision

Give the tool a WebVTT transcript of someone describing a task and get back an SVG task-flow
diagram that a researcher would recognise as a faithful picture of what was said, with
every element traceable to the moment in the transcript it came from.

## Users

| User | Need |
|---|---|
| **UX researcher / analyst** (primary) | Turn interview transcripts into task flows quickly and consistently |
| **Product / service designer** | See where a task branches, stalls or is hard, to target improvements |
| **Developer integrating the tool** | Call the same capability from scripts or other services |

## What the diagram captures

| Concept | Meaning | Shown as |
|---|---|---|
| **Actor** | Who performs a step (the participant, a colleague, a system) | A lane per actor |
| **Goal** | What the task is for, in the participant's terms | Diagram title / goal banner |
| **Step** | One thing an actor does | Node |
| **Step properties** | Attributes and state of a step, including **frequency** and **difficulty** (see [Measures](#measures-frequency-and-difficulty)) | Text and styling within the node |
| **Flow** | The order steps happen in | Arrows between nodes |
| **Conditionality** | Points where the path depends on a condition ("if it's out of stock…") | Decision node with labelled branches |
| **Completion metrics** | All of: **outcome** (success / failure / abandonment, and how often each happens), **time on task**, **number of attempts**, **error and recovery points** | Outcome nodes and metric labels |
| **Repetition** | **Repeats**: steps done a known number of times (*"each of our five sites"*) or once per item (*"for each receipt"*). **Iterations**: steps repeated until a check passes, with known pass/fail criteria, typical number of passes and any limit | A loop marker on a dashed loop-back edge: **↻ × 5**, **↻ for each receipt**, or **↻ until …** (see [design](30-design.md#loops)) |
| **Error flows** | What happens when something goes wrong, and whether the task continues afterwards | A **separate diagram** per error flow, with standard link-out and return connectors (see [design](30-design.md#error-flows)) |
| **Annotations** | Other meta notes: hesitations, workarounds, opinions, quotes, **alternative views** | Note shapes attached to the relevant node |
| **Evidence** | Which transcript cue(s) and timestamp(s) each element came from | Cue references in the model (and, optionally, the SVG) |

## Transcript interpretation rules

### Speakers

- VTT files will usually carry speaker labels (`<v Name>`). Some labels will cover
  **several people sharing one connection** (e.g. a meeting room), so one label does not
  always mean one person.
- **Interviewer questions are not part of the diagram.** They are still read as context,
  for example to understand an answer to a scale question (see below), but nothing in
  the flow is derived from a question alone.

### Consensus and divergence

When more than one participant describes the task:

- **Clear consensus:** use the agreed flow.
- **Differences in approach or view:** follow the **main speaker's** approach in the
  flow, and add an **annotation** on the affected step that records the alternative view
  and its **timestamp** (and speaker, where known).

### Non-linear accounts

Real interviews are not told in order. Participants jump forward and back between parts
of the flow, add detail to steps they described earlier, and correct themselves.

- **The flow follows the task, not the telling.** Steps are ordered by when they happen,
  whatever order they were described in.
- **Later detail enriches the existing step.** It doesn't create a duplicate step; the step
  cites every cue that describes it, wherever those cues are in the transcript.
- **Corrections win.** When a participant corrects themselves ("actually, no, I do that
  first"), the corrected version is used, and a **correction** annotation records what
  changed and where, so a reviewer can check it. A correction is one speaker revising
  their own account; a disagreement between participants is a divergence (see above).
- **Unresolved contradictions:** when a participant contradicts themselves without a
  clear correction, the later statement is used and a correction annotation flags the
  contradiction for review.

### Repetition

- **Repeats** have a count: a number when one is given (*"each of our five sites"*), or
  just the participant's words when the count varies (*"for each receipt"*). Nobody makes
  a decision each time, so a repeat has no decision step.
- **Iterations** repeat until a check passes. The check is a real decision step whose
  branches give the pass and fail criteria. The typical number of passes (*"usually two
  goes"*) and any limit (*"after three rejections I ring the helpdesk"*) are recorded.
- **Running out of tries is an error.** An iteration's limit triggers an error flow, drawn
  like any other.
- Loops can sit inside one another (*"at each site, for each extinguisher…"*).

### Measures (frequency and difficulty)

- Participants may give these in **free text** ("every morning", "a real pain") or on a
  **scale**. Interviewers may sometimes ask for a scale ("on 1–5, how hard is that?").
- The model holds **both forms**: the scale value (when available) and the supporting
  quote.
- **When both exist for the same item, the scale value is preferred** for display and
  styling; the quote is kept as evidence.
- Free-text-only measures are kept as spoken and may be mapped to a suggested scale
  value, clearly marked as inferred.
- Participants often speak in **binary** terms relative to a tolerance of their own:
  *"not often enough to bother me"* versus *"way too often"*. The threshold is vague, but
  which side of it something falls on is recorded: **above the threshold is a frustration
  signal**.

## How it works (in outline)

```
.vtt ──► parse cues ──► Claude: semantic extraction ──► Task Flow Model (JSON)
                                                          │
                                       validate against schema
                                                          │
                                  compile to Mermaid flowchart ──► pele ──► .svg
```

1. **Parse** the WebVTT file into cues (timestamps, speaker, text).
2. **Extract** with Claude: the cues are sent to the Claude API, which returns a
   **Task Flow Model**, i.e. JSON that has to match a schema we define, with each element citing
   the cue IDs it was derived from.
3. **Validate** the model (schema, references resolve, flow is connected).
4. **Compile** the model to a Mermaid `flowchart` deterministically. Claude does not write
   Mermaid directly.
5. **Render** to SVG with pele.

The Task Flow Model is the core artefact. The SVG is just one view of it. Keeping
these separate means extraction quality and rendering can be tested independently, and
the model can be saved, reviewed and edited.

## Delivery shape

**The API is the canonical implementation.**

- The API is specified as an **OpenAPI** contract: the source of truth for its operations,
  inputs, outputs and the Task Flow Model schema.
- All behaviour lives behind the API. It is implemented once.
- **CLI, HTTP server and any other interface are thin adapters** that use the API. They
  translate their own input/output (arguments, files, HTTP requests) to API calls and
  contain no business logic of their own.
- The **CLI is the first adapter**, e.g. `journey extract interview.vtt -o flow.json`,
  `journey render flow.json -o flow.svg`, or both in one step. An HTTP adapter follows.
- Tests run against the API directly. Adapter tests only check the translation.

```
           ┌──────────┐  ┌───────────┐  ┌─────────┐
           │   CLI    │  │   HTTP    │  │ other … │   adapters (no logic)
           └────┬─────┘  └─────┬─────┘  └────┬────┘
                └──────────────┼─────────────┘
                     ┌─────────▼──────────┐
                     │  Journey API       │   canonical implementation,
                     │  (OpenAPI contract)│   defined by openapi.yaml
                     └─────────┬──────────┘
                 ┌─────────────┼─────────────┐
            VTT parser   Claude extraction   pele renderer
```

## Proof of Technology vs Proof of Concept

| | Question | Covered by |
|---|---|---|
| **PoT** | Can pele render a task flow with lanes, decisions, properties and notes legibly? Can Claude extract a faithful, schema-valid Task Flow Model from a real VTT? | [`10-pot.md`](10-pot.md) |
| **PoC** | Do researchers find the generated diagrams accurate and useful enough to adopt? | `20-requirements.md` onwards |

## Success / exit criteria (proposed)

The PoC succeeds if, on a set of **5–10 real task-description transcripts**:

1. **Coverage:** the diagram includes ≥ 90% of the steps a human reviewer identifies.
2. **Faithfulness:** no invented steps; every node, branch and annotation cites at least
   one transcript cue that supports it.
3. **Structure:** actors, goal, decisions and outcomes are correct in ≥ 80% of
   transcripts, as judged by a reviewer.
4. **Divergence:** every reviewer-identified difference of approach between participants
   appears as an annotation with a timestamp.
5. **Legibility:** a reviewer can read the SVG without the transcript and describe the task.
6. **Practicality:** one transcript (≤ 60 min) is processed end-to-end in under 3 minutes,
   at a cost per transcript recorded and judged acceptable.

**Timebox (proposed):** 2 weeks. PoT in the first 2–3 days, with a go / no-go on pele.

## Non-goals (for this increment)

- Audio/video transcription; input is an existing `.vtt` file
- A graphical editor or web UI
- Merging multiple transcripts into one composite journey
- Representing more than one alternative flow as full branches (alternative views are annotations for now)
- Hosting, authentication, multi-user features
- Non-English transcripts
- Pixel-perfect or brand-themed styling

## Constraints & assumptions

- **Runtime:** Node.js (v25), ES modules; tests with Playwright (`unit` + Firefox `e2e`).
- **Rendering:** pele 1.6.0, pinned. It's very new (first release October 2026), so it sits
  behind our own small interface so it can be replaced.
- **LLM:** Claude API via the official Anthropic TypeScript/JS SDK, default model
  `claude-opus-5-5`, with schema-constrained JSON output (structured outputs).
- **Data:** transcripts may contain personal data and are sent to the Anthropic API.
  Use transcripts you're allowed to process; consider redaction before sending.
- **Credentials:** API key / profile from the environment; never committed.
- **Sample transcripts:** real samples will come later. Until then, PoT and tests use
  **synthetic transcripts** written to exercise each rule above (shared connection,
  consensus, divergence, scale vs free text, interviewer questions).

### Main speaker and interviewer

- The **main speaker** is the participant who contributes most of the task description,
  measured by speaking time. It can be overridden with a `mainSpeaker` option. On a shared
  connection it may have to be inferred from the content.
- **Interviewers** are named with an `interviewers` option (their speaker labels). If it
  isn't given, they are inferred from who asks the questions.

### Scales

All scaled measures use a **5-point Likert scale** with labels suited to the question:

| Measure | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **Difficulty** | Very easy | Easy | Neither easy nor hard | Hard | Very hard |
| **Frequency** | Rarely | Monthly | Weekly | Daily | Multiple times a day |

Further measures follow the same pattern: 5 points, each with a label suited to the question.

### Time on task

Time on task comes from what participants **say** ("takes about 10 minutes"), not from
the length of the recording.

## Open questions

None at present.

## Decisions

See [decisions.md](decisions.md) (D-001 to D-019).
