# Using Journey from an MCP client (IBM Bob, Claude Code, …)

Journey's MCP adapter lets an AI assistant you're already signed in to do the extraction with
its own model, while Journey supplies the rules, checks the result and draws the diagrams.
No API keys are needed. Design: [specs/30-design.md](../specs/30-design.md#mcp-adapter).

## Connect IBM Bob

Add a `journey` entry to Bob's MCP settings (`~/.bob/settings/mcp_settings.json`), using the
path to your Journey checkout and the folders Journey may read and write:

```json
{
  "mcpServers": {
    "journey": {
      "command": "node",
      "args": ["/home/greg/Development/Journey/src/adapters/mcp/server.js"],
      "env": {
        "JOURNEY_ALLOWED_DIRS": "/home/greg/research/interviews"
      }
    }
  }
}
```

- `JOURNEY_ALLOWED_DIRS` lists the folders Journey may access, separated by `:` on Linux and
  macOS (`;` on Windows). Anything outside them is refused. Without it, Journey uses the
  folder it was started in.
- Restart Bob (or reload its MCP servers) after editing.

## Connect Claude Code

```sh
claude mcp add journey --env JOURNEY_ALLOWED_DIRS=/home/greg/research/interviews \
  -- node /home/greg/Development/Journey/src/adapters/mcp/server.js
```

## Use it

Ask the assistant, for example:

> Use Journey to turn `/home/greg/research/interviews/interview-03.vtt` into a task flow, save it
> as `interview-03.flow.json` and render the diagrams into `diagrams/`.

The assistant follows Journey's workflow: read the extraction instructions, parse the
transcript, write the flow, **validate it and fix every reported error**, save, then render.

| Tool | Does |
|---|---|
| `get_extraction_instructions` | The rules and JSON Schema for a Task Flow Model |
| `parse_vtt` | The transcript as numbered cues, with a speaker summary |
| `validate_task_flow` | Checks a flow against all rules; lists errors to fix |
| `save_task_flow` | Saves a valid flow as a Task Flow Document, recording the client and model |
| `render_task_flow` | Writes the SVG diagrams (main flow + error flows) |
| `get_source_path` | The full path of the transcript a document came from |

## Notes

- Saved documents record `route: "mcp"`, the client's name (e.g. `IBM Bob 1.0.2`) and the model
  the assistant reports, or `unknown`.
- Quality depends on the assistant's model. Qualify it on the test fixtures (`tests/fixtures/`)
  before relying on it.
- On an IBM work laptop, check that processing interview data with Bob is approved.
