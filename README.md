# Journey

Turns WebVTT interview transcripts into SVG task-flow diagrams. An LLM (Claude by default)
extracts a schema-validated Task Flow Model, which is compiled to Mermaid and rendered with
pele.

- What and why: [specs/00-vision.md](specs/00-vision.md)
- Where things stand and what's next: [specs/status.md](specs/status.md)
- All specs: [specs/](specs/README.md)

## Setting up a new machine

Requires Node 25.

```sh
git clone https://github.com/NohWayJose/Journey.git
cd Journey
npm install
npx playwright install firefox     # for the e2e tests
npm run test:unit                  # Node only, no browser
npm run test:e2e                   # Firefox
```

Things that are deliberately **not** in the repository:

| What | How to get it back |
|---|---|
| LLM credentials (D-025) | `ant auth login`, or a git-ignored `.env` with the variable named in `journey.config.json` (run with `node --env-file=.env`) |
| Rendered output (`out/`) | `npm run render:fixtures -- --screenshots` |
| Paths in `.bob/mcp.json` | Edit them to match this checkout (see [docs/mcp.md](docs/mcp.md)) |

## Using it

- From an MCP client such as IBM Bob or Claude Code: [docs/mcp.md](docs/mcp.md)
- Model profiles and credentials: [specs/30-design.md](specs/30-design.md#model-providers)
