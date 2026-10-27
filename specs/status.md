# Status

Last updated: 2026-10-27 · Update this file whenever a step lands or priorities change.

The detailed results of each check are in the [PoT results table](10-pot.md#results); this
file is the short version: where we are, what's next and what's left loose.

## Where we are

Phase: **Proof of Technology** (see [vision](00-vision.md#proof-of-technology-vs-proof-of-concept)).

| Area | State |
|---|---|
| Specs | Vision, PoT, design, decisions D-001 to D-027 drafted. `20-requirements.md` and `40-tasks.md` not yet written (they follow a PoT go) |
| VTT parser | Done (VT-01..08) |
| Task Flow Model schema and validator | Done, schema `0.1.0` (DS-10..22) |
| Fixtures | Synthetic F1–F9 with expected flows, in `tests/fixtures/` |
| Compiler and renderer | Done: Mermaid `swimlane-beta` via pele 1.6.0, Carbon CSS theme, error-flow connectors, loops |
| LLM provider layer | Done: model profiles, Anthropic default (`claude-opus-5-5`), credentials by reference |
| Extraction | Provider route and MCP route implemented (D-026); **not yet run against a real model** |
| API | `src/api/index.js`; no `openapi.yaml` yet (planned for the PoC) |
| Adapters | MCP adapter done (IBM Bob / Claude Code, see [docs/mcp.md](../docs/mcp.md)). CLI not started |
| Rendering checks | PT-02, 04, 10, 11, 15, 16, 17 pass. PT-01, 03, 05, 06, 09 await human review. PT-08, 13, 14 partial. PT-07, 12 not started |
| Extraction checks | PE-01 to PE-09 pending: need API credentials (or a qualified MCP client) |
| Phase 2 (aggregation) | Specified, not started (PA-01 to PA-10). Includes quirks, workarounds and a findings report (D-028, D-029) |
| Live mode | Aspiration only, not scheduled ([50-live.md](50-live.md), D-027) |

## First real study: making tea or coffee

- The team has been asked to describe how they make a cup of tea or coffee. **Deadline:
  Friday 2026-10-30.** Received so far: 1 (coffee).
- It is the first real data: for the extraction checks (PE) on real transcripts, and a
  natural first aggregation study (common flow, tea/coffee variants, quirks).
- Keep the transcripts in `studies/hot-drinks/` locally. `/studies/` is git-ignored because
  the repository is **public**; never commit real transcripts.
- Check that contributors agree to their transcript being sent to the model provider.

## Next

1. **Run the extraction checks PE-01 to PE-09** against the default profile. They decide the
   go / no-go on extraction and are the main gap.
2. **Human review** of PT-01, 03, 05, 06, 09: render with
   `npm run render:fixtures -- --screenshots` and inspect `out/fixtures/`.
3. Close the partial rendering checks: PT-08 (F6 layout is very wide: try TB direction or a
   summary detail level), PT-14 (Chrome, Inkscape), then PT-07 and PT-12.
4. After a PoT go: `20-requirements.md`, `openapi.yaml`, the CLI adapter.

## Loose ends

- `.bob/mcp.json` holds absolute paths for this checkout (`/home/greg/Development/Journey`);
  edit them on other machines.
- Live mode open questions (scope of "no cloud", number of speakers, who watches) are
  unanswered; see [50-live.md](50-live.md#open-questions).
