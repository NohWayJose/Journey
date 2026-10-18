#!/usr/bin/env node
// MCP adapter (D-026): lets MCP clients such as IBM Bob use Journey. The client's own model does the
// extraction; these tools supply the instructions, validation, saving and rendering.
// Rules MC-01 to MC-04 in specs/30-design.md#mcp-adapter. No business logic here (MC-01).

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as api from '../../api/index.js';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

const SERVER_INSTRUCTIONS = `Journey turns interview transcripts (WebVTT) into task-flow diagrams.
Workflow: 1) get_extraction_instructions once; 2) parse_vtt for the transcript; 3) write the Task Flow Model JSON
following the instructions and schema; 4) validate_task_flow and fix every error it reports, repeating until valid;
5) save_task_flow; 6) render_task_flow. Cite cues only by their IDs.`;

class PathError extends Error {}

/** MC-02: allowed directories from JOURNEY_ALLOWED_DIRS (path-separated), defaulting to the working directory. */
export function allowedDirectories(env = process.env, cwd = process.cwd()) {
  const dirs = env.JOURNEY_ALLOWED_DIRS ? env.JOURNEY_ALLOWED_DIRS.split(delimiter).filter(Boolean) : [cwd];
  return dirs.map((d) => realpathSync(resolve(cwd, d)));
}

/** Resolves a path (following symlinks where it exists) and refuses it unless it's inside an allowed directory. */
function guard(allowed, path) {
  const abs = resolve(path);
  let probe = abs;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const real = resolve(realpathSync(probe), abs.slice(probe.length).replace(/^[/\\]/, ''));
  if (!allowed.some((d) => real === d || real.startsWith(d + sep))) {
    throw new PathError(`Path is outside the allowed directories: ${path}`);
  }
  return real;
}

/** Flows may arrive as objects or as JSON text, depending on the client. */
const flowArg = z.union([z.record(z.string(), z.any()), z.string()]).describe('The Task Flow Model (the `flow` object), as JSON');
const parseFlow = (flow) => (typeof flow === 'string' ? JSON.parse(flow) : flow);

/** MC-03: errors become readable tool results, including validation errors one per line. */
function toolError(error) {
  const details = error.errors?.length ? `\n${error.errors.map((e) => `- [${e.rule}] ${e.message}`).join('\n')}` : '';
  return { isError: true, content: [{ type: 'text', text: `${error.message}${details}` }] };
}
const text = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });

export function createServer({ allowedDirs = allowedDirectories() } = {}) {
  const server = new McpServer({ name: 'journey', version }, { instructions: SERVER_INSTRUCTIONS });
  const tool = (name, config, fn) => server.registerTool(name, config, async (args) => {
    try {
      return text(await fn(args ?? {}));
    } catch (error) {
      return toolError(error);
    }
  });
  const clientName = () => {
    const c = server.server.getClientVersion();
    return c ? `${c.name} ${c.version}`.trim() : null;
  };

  tool('get_extraction_instructions', {
    title: 'Get extraction instructions',
    description: 'Returns the rules for turning a transcript into a Task Flow Model, and the JSON Schema the model must match. Read these before writing a flow.',
  }, () => {
    const { instructions, schema } = api.extractionGuide();
    return `${instructions}\n\n# JSON Schema for the Task Flow Model\n${JSON.stringify(schema)}`;
  });

  tool('parse_vtt', {
    title: 'Parse a transcript',
    description: 'Parses a WebVTT transcript and returns a speaker summary and every cue as "[cue-id hh:mm:ss speaker] text". Use the cue IDs as evidence.',
    inputSchema: {
      path: z.string().describe('Path to the .vtt file'),
      mainSpeaker: z.string().optional().describe('Speaker label of the main speaker, if known'),
      interviewers: z.array(z.string()).optional().describe('Speaker labels of the interviewers, if known'),
    },
  }, ({ path, mainSpeaker, interviewers }) => api.transcriptPrompt(api.loadTranscript(guard(allowedDirs, path)), { mainSpeaker, interviewers }));

  tool('validate_task_flow', {
    title: 'Validate a task flow',
    description: 'Checks a Task Flow Model against the schema and all rules for the given transcript. Returns the errors to fix (an empty list means valid).',
    inputSchema: { path: z.string().describe('Path to the .vtt file the flow was extracted from'), flow: flowArg },
  }, ({ path, flow }) => {
    const errors = api.validate(api.loadTranscript(guard(allowedDirs, path)), parseFlow(flow));
    return { valid: errors.length === 0, errors };
  });

  tool('save_task_flow', {
    title: 'Save a task flow',
    description: 'Validates the flow and saves it as a Task Flow Document (JSON), recording that it was produced through MCP and by which model.',
    inputSchema: {
      path: z.string().describe('Path to the .vtt file the flow was extracted from'),
      flow: flowArg,
      outFile: z.string().describe('Where to write the document, e.g. interview-03.flow.json'),
      model: z.string().optional().describe('The model you are running as, if you know it'),
    },
  }, ({ path, flow, outFile, model }) => {
    const doc = api.documentFromClient(guard(allowedDirs, path), parseFlow(flow), { client: clientName(), model: model ?? 'unknown' });
    return { saved: api.saveDocument(doc, guard(allowedDirs, outFile)) };
  });

  tool('render_task_flow', {
    title: 'Render a task flow',
    description: 'Renders a saved Task Flow Document to SVG diagrams (the main flow plus one per error flow) in one directory.',
    inputSchema: {
      file: z.string().describe('Path to a saved Task Flow Document (.flow.json)'),
      outDir: z.string().describe('Directory to write the SVG files to'),
    },
  }, ({ file, outDir }) => ({ files: api.renderToDirectory(api.loadDocument(guard(allowedDirs, file)), guard(allowedDirs, outDir)) }));

  tool('get_source_path', {
    title: 'Get source transcript path',
    description: 'Returns the fully qualified path of the transcript a saved Task Flow Document was extracted from.',
    inputSchema: { file: z.string().describe('Path to a saved Task Flow Document (.flow.json)') },
  }, ({ file }) => ({ path: api.sourcePath(api.loadDocument(guard(allowedDirs, file))) }));

  return server;
}

// MC-04: run over stdio when executed directly (also via a symlinked npm bin)
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await createServer().connect(new StdioServerTransport());
}
