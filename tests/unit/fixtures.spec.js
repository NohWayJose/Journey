import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { parseVtt } from '../../src/vtt/parse.js';
import { validateFlow } from '../../src/model/validate.js';

const root = new URL('../fixtures/', import.meta.url);
const fixtures = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^F\d+-/.test(d.name))
  .map((d) => d.name)
  .sort();

test('all PoT fixtures F1-F9 are present', () => {
  expect(fixtures.map((f) => f.split('-')[0])).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9']);
});

for (const name of fixtures) {
  test(`${name}: transcript parses and expected flow passes schema and semantic rules`, () => {
    const { cues } = parseVtt(readFileSync(new URL(`${name}/transcript.vtt`, root), 'utf8'));
    const flow = JSON.parse(readFileSync(new URL(`${name}/expected.flow.json`, root), 'utf8'));
    expect(cues.length).toBeGreaterThan(0);
    expect(validateFlow(flow, cues)).toEqual([]);
  });
}
