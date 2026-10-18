// The Journey API: the canonical implementation (D-001). Adapters (MCP, CLI, HTTP) call these
// functions and contain no business logic. The OpenAPI contract will describe these operations.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseVtt, VttError } from '../vtt/parse.js';
import { validateDocument, validateFlow } from '../model/validate.js';
import { renderTaskFlow } from '../render/render.js';
import { EXTRACTION_INSTRUCTIONS, extractionSchema } from '../extract/instructions.js';
import { formatTranscript } from '../extract/prompt.js';
import { createLlm } from '../llm/index.js';

export const SCHEMA_VERSION = '0.1.0';
export const MAX_ATTEMPTS = 3; // EX-05: first attempt + 2 retries

export class ExtractionError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ExtractionError';
    this.errors = errors;
  }
}

/** EX-01: reads and parses a transcript. */
export function loadTranscript(vttPath) {
  const path = resolve(vttPath);
  const bytes = readFileSync(path);
  const { cues, durationMs } = parseVtt(bytes.toString('utf8'));
  if (cues.length === 0) throw new VttError('The transcript has no cues');
  return { path, sha256: createHash('sha256').update(bytes).digest('hex'), cues, durationMs };
}

/** The transcript as the model sees it (EX-02); also served by the MCP adapter. */
export function transcriptPrompt(transcript, options = {}) {
  return formatTranscript(transcript.cues, options);
}

export function extractionGuide() {
  return { instructions: EXTRACTION_INSTRUCTIONS, schema: extractionSchema() };
}

/** EX-04: validates a flow against its transcript's cues. */
export function validate(transcript, flow) {
  return validateFlow(flow, transcript.cues);
}

/** EX-06: assembles a Task Flow Document around a validated flow. */
export function buildDocument(transcript, flow, { route, provider = null, client = null, model, mainSpeaker = null, interviewers = [], now = new Date() }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    source: { path: transcript.path, sha256: transcript.sha256, cueCount: transcript.cues.length, durationMs: transcript.durationMs },
    extraction: { route, provider, client, model, createdAt: now.toISOString(), options: { mainSpeaker, interviewers } },
    cues: transcript.cues.map(({ id, startMs, endMs, speaker }) => ({ id, startMs, endMs, speaker })),
    flow,
  };
}

function retryPrompt(prompt, previous, errors) {
  return `${prompt}

# Your previous answer failed validation
Return the complete corrected Task Flow Model. Previous answer:
${JSON.stringify(previous)}

Errors:
${errors.map((e) => `- [${e.rule}] ${e.message}`).join('\n')}`;
}

/**
 * Provider route (D-026): extracts a Task Flow Document from a transcript.
 * @param {string} vttPath
 * @param {{ llm?: string|object, mainSpeaker?: string|null, interviewers?: string[], llmOptions?: object, now?: Date }} [options]
 *        llmOptions is passed to createLlm (config, env, clients) and is injectable for tests
 */
export async function extract(vttPath, { llm: selection, mainSpeaker = null, interviewers = [], llmOptions = {}, now } = {}) {
  const transcript = loadTranscript(vttPath);
  const llm = createLlm(selection, llmOptions);
  const prompt = transcriptPrompt(transcript, { mainSpeaker, interviewers });
  const schema = extractionSchema();

  let current = prompt;
  let errors = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await llm.generateStructured({ system: EXTRACTION_INSTRUCTIONS, prompt: current, schema });
    errors = validate(transcript, result.json);
    if (errors.length === 0) {
      return buildDocument(transcript, result.json, {
        route: 'provider', provider: result.provider, model: result.model, mainSpeaker, interviewers, now,
      });
    }
    current = retryPrompt(prompt, result.json, errors);
  }
  throw new ExtractionError(`Extraction failed validation after ${MAX_ATTEMPTS} attempts`, errors);
}

/** MCP route (D-026): validates a client-produced flow and assembles its document. */
export function documentFromClient(vttPath, flow, { client = null, model = 'unknown', mainSpeaker = null, interviewers = [], now } = {}) {
  const transcript = loadTranscript(vttPath);
  const errors = validate(transcript, flow);
  if (errors.length) throw new ExtractionError('The task flow failed validation', errors);
  return buildDocument(transcript, flow, { route: 'mcp', client, model, mainSpeaker, interviewers, now });
}

export function saveDocument(doc, outFile) {
  const errors = validateDocument(doc);
  if (errors.length) throw new ExtractionError('Refusing to save an invalid document', errors);
  mkdirSync(dirname(resolve(outFile)), { recursive: true });
  writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
  return resolve(outFile);
}

export function loadDocument(file) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const errors = validateDocument(doc);
  if (errors.length) throw new ExtractionError(`${file} is not a valid Task Flow Document`, errors);
  return doc;
}

/** Renders a document's diagrams into one directory (main + error flows, linked by relative names). */
export function renderToDirectory(doc, outDir, { name = basename(doc.source.path).replace(/\.vtt$/i, ''), ...options } = {}) {
  mkdirSync(outDir, { recursive: true });
  return renderTaskFlow(doc.flow, doc.cues, { name, ...options }).map((d) => {
    const file = join(resolve(outDir), d.fileName);
    writeFileSync(file, d.svg);
    return file;
  });
}

/** `GET /flows/{flowId}/path` (D-015): the fully qualified path of the source VTT. */
export const sourcePath = (doc) => doc.source.path;
