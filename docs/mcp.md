# Using Journey from an MCP client (IBM Bob, Claude Code, …)

Journey's MCP adapter lets an AI assistant you're already signed in to do the extraction with
its own model, while Journey supplies the rules, checks the result and draws the diagrams.
No API keys are needed. Design: [specs/30-design.md](../specs/30-design.md#mcp-adapter).

## Connect IBM Bob

### For this project only (recommended)

Bob reads project-level MCP servers from **`.bob/mcp.json`** in the project root; they take
precedence over your global settings
([Bob docs](https://bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob)). This checkout has
one: open the Journey folder in Bob and the `journey` server is available. It allows reading
`tests/fixtures/` and writing to `out/`.

The file uses absolute paths, because Bob's documentation doesn't say whether relative paths
work. On another machine (e.g. a work laptop), edit the paths to match that checkout.

### Setting up on a Mac

Bob is started from the Dock or Finder, so it doesn't get your terminal's `PATH`. With Node
installed through nvm, `"command": "node"` then fails and the server never starts. Use the
full path to `node`; the script below does this.

1. Install Node 25 (e.g. [nvm](https://github.com/nvm-sh/nvm), then `nvm install 25`).
2. Clone and install:

   ```sh
   mkdir -p ~/Development && cd ~/Development
   git clone https://github.com/NohWayJose/Journey.git
   cd Journey
   npm install
   mkdir -p studies/hot-drinks out
   ```

3. From inside the checkout, write `.bob/mcp.json` for this machine and stop git tracking
   your local version:

   ```sh
   cat > .bob/mcp.json <<EOF
   {
     "mcpServers": {
       "journey": {
         "command": "$(which node)",
         "args": ["$PWD/src/adapters/mcp/server.js"],
         "cwd": "$PWD",
         "env": { "JOURNEY_ALLOWED_DIRS": "$PWD/tests/fixtures:$PWD/studies:$PWD/out" },
         "alwaysAllow": [],
         "disabled": false
       }
     }
   }
   EOF
   git update-index --skip-worktree .bob/mcp.json
   ```

   `command` must be a full path (e.g. `/Users/<you>/.nvm/versions/node/v25.x.x/bin/node`).
   Re-run this step after upgrading Node.
4. Open the folder in Bob and check that `journey` is running in its MCP servers panel.
5. If it doesn't connect, run `"$(which node)" src/adapters/mcp/server.js` in the terminal:
   if it waits silently, the server works and the problem is in Bob's configuration.

Real study transcripts go in `studies/` (git-ignored: the repository is public). Copy them
across by hand, never through git.

### For all projects

Add a `journey` entry to Bob's global MCP settings, using the path to your Journey checkout
and the folders Journey may read and write. Bob's documentation gives the global file as
`~/.bob/settings/mcp.json`; on this PC Bob 1.0.2 created `~/.bob/settings/mcp_settings.json`:

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
