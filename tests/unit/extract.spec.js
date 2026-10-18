import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extract, documentFromClient, extractionGuide, ExtractionError, MAX_ATTEMPTS, saveDocument, loadDocument, sourcePath } from '../../src/api/index.js';
import { EXTRACTION_INSTRUCTIONS, extractionSchema } from '../../src/extract/instructions.js';
import { validateDocument } from '../../src/model/validate.js';

const F1 = fileURLToPath(new URL('../fixtures/F1-meeting-room/', import.meta.url));
const vtt = `${F1}transcript.vtt`;
const expected = JSON.parse(readFileSync(`${F1}expected.flow.json`, 'utf8'));
const config = { llm: { defaultProfile: 'default', profiles: { default: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', credential: 'provider-default' } } } };

/** Fake Anthropic client returning the given flows in turn. */
function fakeClient(...flows) {
  const calls = [];
  return {
    calls,
    beta: { messages: { stream: (params) => {
      calls.push(params);
      const flow = flows[Math.min(calls.length - 1, flows.length - 1)];
      return { finalMessage: async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(flow) }] }) };
    } } },
    messages: { countTokens: async () => ({ input_tokens: 1 }) },
  };
}
const run = (client, options = {}) => extract(vtt, { llmOptions: { config, clients: { anthropic: client } }, ...options });
const broken = () => { const f = structuredClone(expected); f.goal.evidence = ['c99']; return f; };

test('EX-01: a transcript with no cues is rejected before any model call', async ({}, testInfo) => {
  const empty = testInfo.outputPath('empty.vtt');
  writeFileSync(empty, 'WEBVTT\n\nNOTE nothing said\n');
  const client = fakeClient(expected);
  await expect(extract(empty, { llmOptions: { config, clients: { anthropic: client } } })).rejects.toThrow(/no cues/);
  expect(client.calls).toHaveLength(0);
});

test('EX-02 / EX-03: the request carries the shared instructions, the speaker summary, every cue and the flow schema', async () => {
  const client = fakeClient(expected);
  await run(client, { interviewers: ['Interviewer'] });
  const [req] = client.calls;
  expect(req.system).toBe(EXTRACTION_INSTRUCTIONS);
  const prompt = req.messages[0].content;
  expect(prompt).toContain('- Priya Shah: 91 s speaking, 8 cues');
  expect(prompt).toContain('Configured interviewers: Interviewer');
  expect(prompt).toContain('[c1 00:00:00 Interviewer] Could you talk me through how you book a meeting room?');
  expect(prompt).toContain('[c11 00:01:44 Priya Shah] A couple of times a week.');
  expect(req.output_config.format).toEqual({ type: 'json_schema', schema: extractionSchema() });
  expect(extractionSchema().required).toContain('steps');
  expect(extractionSchema().$defs.step).toBeDefined();
  expect(extractionSchema().$defs.flow).toBeUndefined();
});

test('EX-04 / EX-05: invalid output is retried with its errors, then accepted once valid', async () => {
  const client = fakeClient(broken(), expected);
  const doc = await run(client);
  expect(client.calls).toHaveLength(2);
  const retry = client.calls[1].messages[0].content;
  expect(retry).toContain('# Your previous answer failed validation');
  expect(retry).toContain('[DS-12]');
  expect(retry).toContain('c99');
  expect(doc.flow).toEqual(expected);
});

test(`EX-05: extraction fails after ${MAX_ATTEMPTS} invalid attempts and returns nothing`, async () => {
  const client = fakeClient(broken());
  await expect(run(client)).rejects.toMatchObject({ name: 'ExtractionError', errors: [expect.objectContaining({ rule: 'DS-12' })] });
  expect(client.calls).toHaveLength(MAX_ATTEMPTS);
});

test('EX-06 / EX-07: the document is assembled by code and records the serving model', async () => {
  const client = fakeClient(expected);
  client.beta.messages.stream = ((orig) => (params) => {
    const s = orig(params);
    return { finalMessage: async () => ({ ...(await s.finalMessage()), model: 'claude-opus-4-8' }) };
  })(client.beta.messages.stream);
  const now = new Date('2026-10-18T15:00:00Z');
  const doc = await run(client, { interviewers: ['Interviewer'], now });

  expect(validateDocument(doc)).toEqual([]);
  expect(doc.source).toEqual({
    path: vtt, sha256: createHash('sha256').update(readFileSync(vtt)).digest('hex'), cueCount: 11, durationMs: 112000,
  });
  expect(doc.extraction).toEqual({
    route: 'provider', provider: 'anthropic', client: null, model: 'claude-opus-4-8', createdAt: '2026-10-18T15:00:00.000Z',
    options: { mainSpeaker: null, interviewers: ['Interviewer'] },
  });
  expect(doc.cues[0]).toEqual({ id: 'c1', startMs: 0, endMs: 6000, speaker: 'Interviewer' });
  expect(JSON.stringify(doc.cues)).not.toContain('meeting room'); // no cue text at rest
});

test('MCP route: a client-produced flow is validated and recorded with route mcp', () => {
  const doc = documentFromClient(vtt, expected, { client: 'IBM Bob 1.0.2', model: 'reported-by-client' });
  expect(doc.extraction).toMatchObject({ route: 'mcp', provider: null, client: 'IBM Bob 1.0.2', model: 'reported-by-client' });
  expect(validateDocument(doc)).toEqual([]);
  expect(() => documentFromClient(vtt, broken())).toThrow(ExtractionError);
  expect(documentFromClient(vtt, expected).extraction.model).toBe('unknown');
});

test('documents save, load and report their source path', ({}, testInfo) => {
  const file = saveDocument(documentFromClient(vtt, expected), testInfo.outputPath('F1.flow.json'));
  const doc = loadDocument(file);
  expect(sourcePath(doc)).toBe(vtt);
  expect(extractionGuide().instructions).toBe(EXTRACTION_INSTRUCTIONS);
});
