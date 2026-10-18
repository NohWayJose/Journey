import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/adapters/mcp/server.js';

const fixtures = realpathSync(fileURLToPath(new URL('../fixtures/', import.meta.url)));
const vtt = `${fixtures}/F2-expense-claim/transcript.vtt`;
const expected = JSON.parse(readFileSync(`${fixtures}/F2-expense-claim/expected.flow.json`, 'utf8'));

async function connect(allowedDirs) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ allowedDirs }).connect(serverSide);
  const client = new Client({ name: 'IBM Bob', version: '1.0.2' });
  await client.connect(clientSide);
  return client;
}
const call = async (client, name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return { error: !!result.isError, text: result.content[0].text };
};

test('MC-01: exposes the documented tools', async () => {
  const client = await connect([fixtures]);
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(
    ['get_extraction_instructions', 'get_source_path', 'parse_vtt', 'render_task_flow', 'save_task_flow', 'validate_task_flow'],
  );
});

test('MCP route end to end: instructions, parse, validate, save, render, source path', async ({}, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const out = realpathSync(testInfo.outputDir);
  const client = await connect([fixtures, out]);

  expect((await call(client, 'get_extraction_instructions')).text).toContain('# JSON Schema for the Task Flow Model');
  const parsed = await call(client, 'parse_vtt', { path: vtt, interviewers: ['Interviewer'] });
  expect(parsed.text).toContain('[c18 00:02:28 Marcus Lee] Oh, I said fifty pounds');

  const broken = structuredClone(expected);
  broken.goal.evidence = ['c99'];
  const invalid = JSON.parse((await call(client, 'validate_task_flow', { path: vtt, flow: broken })).text);
  expect(invalid.valid).toBe(false);
  expect(invalid.errors[0].rule).toBe('DS-12');
  // Flows passed as JSON text work too
  expect(JSON.parse((await call(client, 'validate_task_flow', { path: vtt, flow: JSON.stringify(expected) })).text)).toEqual({ valid: true, errors: [] });

  const saved = JSON.parse((await call(client, 'save_task_flow', { path: vtt, flow: expected, outFile: `${out}/F2.flow.json`, model: 'bob-model' })).text);
  const doc = JSON.parse(readFileSync(saved.saved, 'utf8'));
  expect(doc.extraction).toMatchObject({ route: 'mcp', provider: null, client: 'IBM Bob 1.0.2', model: 'bob-model' });

  const rendered = JSON.parse((await call(client, 'render_task_flow', { file: saved.saved, outDir: `${out}/svg` })).text);
  expect(rendered.files.map((f) => f.split('/').pop())).toEqual(['transcript.svg', 'transcript.error-E1.svg', 'transcript.error-E2.svg']);

  expect(JSON.parse((await call(client, 'get_source_path', { file: saved.saved })).text)).toEqual({ path: vtt });
});

test('MC-02: paths outside the allowed directories are refused, including via symlinks', async ({}, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const out = realpathSync(testInfo.outputDir);
  const client = await connect([out]);
  const outside = await call(client, 'parse_vtt', { path: vtt });
  expect(outside).toMatchObject({ error: true, text: expect.stringContaining('outside the allowed directories') });

  symlinkSync(fixtures, `${out}/link-to-fixtures`);
  const viaLink = await call(client, 'parse_vtt', { path: `${out}/link-to-fixtures/F2-expense-claim/transcript.vtt` });
  expect(viaLink.error).toBe(true);
});

test('MC-03: failures come back as readable tool errors', async ({}, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const client = await connect([fixtures, realpathSync(testInfo.outputDir)]);
  const missing = await call(client, 'parse_vtt', { path: `${fixtures}/nope.vtt` });
  expect(missing).toMatchObject({ error: true, text: expect.stringContaining('ENOENT') });
  const broken = structuredClone(expected);
  broken.goal.evidence = ['c99'];
  const refused = await call(client, 'save_task_flow', { path: vtt, flow: broken, outFile: `${realpathSync(testInfo.outputDir)}/bad.json` });
  expect(refused).toMatchObject({ error: true, text: expect.stringContaining('[DS-12]') });
});

test('MC-04: runs as a local stdio server', async () => {
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const server = fileURLToPath(new URL('../../src/adapters/mcp/server.js', import.meta.url));
  const client = new Client({ name: 'stdio-test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env, JOURNEY_ALLOWED_DIRS: fixtures } }));
  try {
    const result = await client.callTool({ name: 'parse_vtt', arguments: { path: vtt } });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('[c1 00:00:00 Interviewer]');
    expect(client.getInstructions()).toContain('validate_task_flow');
  } finally {
    await client.close();
  }
});
