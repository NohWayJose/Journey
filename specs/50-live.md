# 50 — Live mode (aspiration)

Status: **Aspiration, not scheduled** · Last updated: 2026-10-18 · Decision: D-027

Live mode is a **parallel aspiration**, not part of phase 1 or phase 2. Nothing here is built
until extraction has passed its PoT checks (PE-01 to PE-09) and live mode is promoted to a
phase. Until then this spec records the intent, the expected shape and the risks, so current
work doesn't close the door on it.

## Aspiration

During an interview, transcribe speech **locally** with faster-whisper and show a task-flow
diagram that **updates as the participant talks**: new steps appear, later detail fills in
existing steps, and when the participant reorders or corrects their account, the diagram
follows.

## Why it fits the current design

- **Non-linear accounts are already handled.** The flow follows the order of the task, not
  the telling, later detail enriches existing steps, and corrections win (D-016). If each
  update extracts from **the whole transcript so far**, order changes and corrections need
  no new logic. This also keeps to "extraction sees the whole transcript": no chunking.
- **Evidence still works.** Transcription emits cues only once their text is final, so cues
  are append-only, cue IDs stay stable and citations stay valid.
- **The pipeline after extraction is unchanged:** validate, compile, render.
- **The API stays canonical** (D-001): live mode is a new API operation (a live session)
  plus a streaming adapter. Transcription is an input source, not business logic.

## Expected shape

```
mic ─► faster-whisper (local, Python sidecar) ─► committed cues ─► live session (API)
                                                                     │  debounced re-extract
                                                                     ▼
                         browser (pele mount) ◄── SSE ◄── validate ─► compile ─► render
```

| Part | Outline |
|---|---|
| **Transcriber** | faster-whisper in a Python sidecar (it is Python-only). CPU int8 with `small`, `medium` or `distil-large-v3` is expected to keep up on the development machine (32 cores, no NVIDIA GPU), 2–5 s behind speech. Hypotheses are committed only once stable (e.g. the LocalAgreement approach from whisper_streaming), then emitted as cues. |
| **Live session (API)** | Append cues; hold the transcript so far and the latest valid model; trigger re-extraction; report what changed. |
| **Re-extraction** | Triggered by a pause or a change of speaker, at most one in flight; cues that arrive meanwhile are folded into the next run. Sends the whole transcript so far, with prompt caching on the stable prefix. The previous model is supplied so step IDs stay stable between runs. Only a validated model replaces the current one. |
| **Viewer** | A browser page that renders with pele `mount()` (see PT-12), receives updates over SSE, and marks new, changed and moved steps. |
| **Recording** | At the end of a session, the cues are saved as a `.vtt` file, so the normal batch extraction and aggregation can run on it. |

## Risks

| Risk | Note |
|---|---|
| **Extraction leaves the machine** | "Local, no cloud" holds for audio and transcription only, while extraction uses the default Claude profile. A fully local setup needs a local model profile (D-024) that passes the PE checks; local models are much weaker at large structured outputs. |
| **Update latency and cost** | A full extraction takes tens of seconds, so the diagram updates in steps, not continuously. Expect about 60–120 extractions per hour-long session over a growing transcript. Prompt caching is essential. |
| **Layout jumps** | pele lays out the whole diagram again on every update, so nodes move. Mitigations: stable IDs, change highlighting, top-to-bottom direction. |
| **Speakers** | Whisper does not separate speakers. Real-time local diarisation (e.g. pyannote) is slow and unreliable on CPU. A first version assumes one participant, or labels the interviewer manually. |
| **Transcription quality** | Domain jargon and the smaller models' accuracy are untested. Compare against the batch VTT of the same recording. |

## Proof of Technology (when promoted)

Checks are `PL-xx`; they are added to [`10-pot.md`](10-pot.md) when live mode is scheduled.

| ID | Question | Pass when (proposed) |
|---|---|---|
| PL-01 | Does replaying a fixture cue by cue (mock clock, no audio) converge on the batch result? | The final live model matches a batch extraction of the same transcript to PE-05 consistency |
| PL-02 | Do corrections and reorderings show up live? | F8 replayed: each correction shows in the next update after it is spoken |
| PL-03 | Is the diagram stable enough to follow? | Step IDs persist across updates; unchanged steps keep their IDs |
| PL-04 | Is update latency acceptable? | Median time from end of utterance to updated diagram recorded, and judged acceptable by a reviewer |
| PL-05 | Does local transcription keep up? | faster-whisper on CPU stays within 5 s of speech for a 60-minute session |
| PL-06 | Is the cost acceptable? | Cost per hour-long session recorded, and judged acceptable |

Suggested order: PL-01 to PL-04 first, using fixture replay without audio, then add
faster-whisper (PL-05).

## Open questions

1. **How far does "no cloud" go?** Does it cover audio and transcription only, or extraction
   as well (which would require a local model profile)?
2. **Speakers:** a single participant, or several people at once (which needs diarisation)?
3. **Who watches the diagram live?** The interviewer only, or the participant too? This
   affects how much churn is acceptable.
