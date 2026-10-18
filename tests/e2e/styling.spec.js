import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseVtt } from '../../src/vtt/parse.js';
import { renderTaskFlow } from '../../src/render/render.js';

const root = new URL('../fixtures/F2-expense-claim/', import.meta.url);
const { cues } = parseVtt(readFileSync(new URL('transcript.vtt', root), 'utf8'));
const flow = JSON.parse(readFileSync(new URL('expected.flow.json', root), 'utf8'));

/** Writes F2's main diagram (and any files) to the test's output folder and opens it directly. */
async function openMain(page, testInfo, options = {}, files = {}) {
  for (const [name, content] of Object.entries(files)) writeFileSync(testInfo.outputPath(name), content);
  const [main] = renderTaskFlow(flow, cues, { name: 'F2', ...options });
  const path = testInfo.outputPath(main.fileName);
  writeFileSync(path, main.svg);
  await page.goto(pathToFileURL(path).href);
}

const style = (page, selector, property) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], property);

test('PT-14: a standalone SVG gets the default Carbon theme with no external CSS', async ({ page }, testInfo) => {
  await openMain(page, testInfo);
  expect(await style(page, '[data-id="x_out_E1_1"] polygon', 'stroke')).toBe('rgb(218, 30, 40)'); // support-error
  expect(await style(page, '[data-id="n_s6"] rect', 'stroke')).toBe('rgb(36, 161, 72)'); // support-success
  expect(await style(page, 'svg', 'fontFamily')).toContain('IBM Plex Sans');
});

test('ST-04: a linked corporate stylesheet overrides the embedded default theme', async ({ page }, testInfo) => {
  // Linked stylesheets load before the embedded <style>, yet still win: the default uses :where()
  await openMain(page, testInfo, { stylesheets: { link: ['corporate.css'] } }, {
    'corporate.css': '.errOut polygon { stroke: rgb(0, 0, 255); }\n.pele { --cds-support-success: rgb(0, 128, 128); }',
  });
  expect(await style(page, '[data-id="x_out_E1_1"] polygon', 'stroke')).toBe('rgb(0, 0, 255)');
  expect(await style(page, '[data-id="n_s6"] rect', 'stroke')).toBe('rgb(0, 128, 128)');
});

test('ST-04: corporate Carbon tokens restyle everything', async ({ page }, testInfo) => {
  await openMain(page, testInfo, { stylesheets: { embed: ['.pele { --cds-support-error: rgb(1, 2, 3); }'] } });
  expect(await style(page, '[data-id="x_out_E1_1"] polygon', 'stroke')).toBe('rgb(1, 2, 3)');
  expect(await style(page, '.pele-edge[data-id*="_x_"] path:not(.pele-marker)', 'stroke')).toBe('rgb(1, 2, 3)');
});

test('text in linked connector nodes stays readable', async ({ page }, testInfo) => {
  await openMain(page, testInfo);
  const fill = await style(page, '[data-id="x_out_E1_1"] polygon', 'fill');
  const text = await style(page, '[data-id="x_out_E1_1"] text', 'fill');
  expect(text).not.toBe(fill);
});

test('dark colour scheme uses the Carbon Gray 100 theme', async ({ browser }, testInfo) => {
  const page = await browser.newPage({ colorScheme: 'dark' });
  await openMain(page, testInfo);
  expect(await style(page, 'svg', 'backgroundColor')).toBe('rgb(22, 22, 22)');
  await page.close();
});

test('loop markers and loop-back edges use the loop colour', async ({ page }, testInfo) => {
  const dir = new URL('../fixtures/F9-site-inspections-loops/', import.meta.url);
  const f9Cues = parseVtt(readFileSync(new URL('transcript.vtt', dir), 'utf8')).cues;
  const f9 = JSON.parse(readFileSync(new URL('expected.flow.json', dir), 'utf8'));
  const [main] = renderTaskFlow(f9, f9Cues, { name: 'F9' });
  const path = testInfo.outputPath(main.fileName);
  writeFileSync(path, main.svg);
  await page.goto(pathToFileURL(path).href);
  expect(await style(page, '[data-id="l_L1"] rect', 'stroke')).toBe('rgb(138, 63, 252)'); // Carbon purple 60
  expect(await style(page, '.pele-edge[data-id*="_l_"] path:not(.pele-marker)', 'stroke')).toBe('rgb(138, 63, 252)');
});
