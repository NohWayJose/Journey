import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parse } from 'pele';
import { parseVtt } from '../../src/vtt/parse.js';
import { compileTaskFlow } from '../../src/render/mermaid.js';
import { renderTaskFlow } from '../../src/render/render.js';

const fixture = (prefix) => {
  const root = new URL('../fixtures/', import.meta.url);
  const dir = { F1: 'F1-meeting-room', F2: 'F2-expense-claim', F4: 'F4-stock-count-divergence', F5: 'F5-repeat-prescription-scales', F6: 'F6-ward-discharge', F7: 'F7-lab-order-escaping', F8: 'F8-vat-return-nonlinear', F9: 'F9-site-inspections-loops' }[prefix];
  const { cues } = parseVtt(readFileSync(new URL(`${dir}/transcript.vtt`, root), 'utf8'));
  const flow = JSON.parse(readFileSync(new URL(`${dir}/expected.flow.json`, root), 'utf8'));
  return { flow, cues };
};
const renderFixture = (prefix, options = {}) => {
  const { flow, cues } = fixture(prefix);
  return Object.fromEntries(renderTaskFlow(flow, cues, { name: prefix, ...options }).map((d) => [d.id, d]));
};

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const nodeGroup = (svg, id) => svg.match(new RegExp(`<g class="pele-node([^"]*)" data-id="${id}"[\\s\\S]*?</g>`));
/** Text of a node as displayed (pele's wrapped lines joined with spaces). */
const nodeText = (svg, id) => decode([...nodeGroup(svg, id)[0].matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
  .map((m) => m[1].replace(/<\/tspan>\s*<tspan[^>]*>/g, ' ').replace(/<[^>]+>/g, '')).join(' '));
const nodeClasses = (svg, id) => nodeGroup(svg, id)[1].trim().split(/\s+/);
const svgText = (svg) => decode(svg.replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

/** Lane membership from compiled Mermaid: node ID -> lane label. */
function lanesOf(mermaid) {
  const lanes = new Map();
  let lane = null;
  for (const line of mermaid.split('\n')) {
    const open = line.match(/^\s*subgraph \S+\["(.*)"\]$/);
    if (open) { lane = open[1]; continue; }
    if (/^\s*end$/.test(line)) { lane = null; continue; }
    const node = line.match(/^\s{4}(\w+)[[({>]/);
    if (lane && node) lanes.set(node[1], lane);
  }
  return lanes;
}
const referencedIds = (mermaid) => new Set(
  mermaid.split('\n').flatMap((l) => [...l.matchAll(/^\s*(\w+) -[-.]+>?(?:\|"[^"]*"\|)? (\w+)$/g)].flatMap((m) => [m[1], m[2]])),
);

for (const prefix of ['F1', 'F2', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9']) {
  test(`PT-02 / CM-02: ${prefix} declares every node inside a lane and pele parses it`, () => {
    const { flow, cues } = fixture(prefix);
    for (const d of compileTaskFlow(flow, cues, { name: prefix })) {
      const lanes = lanesOf(d.mermaid);
      for (const id of referencedIds(d.mermaid)) expect(lanes.has(id), `${d.id}: ${id} has no lane`).toBe(true);
      expect(() => parse(d.mermaid)).not.toThrow();
    }
  });
}

test('PT-10 / CM-10: F7 text renders exactly as written', () => {
  const { flow } = fixture('F7');
  const { main } = renderFixture('F7');
  for (const s of flow.steps) expect(nodeText(main.svg, `n_${s.id}`)).toContain(s.label);
  const all = svgText(main.svg);
  for (const t of flow.transitions.filter((t) => t.condition)) expect(all).toContain(t.condition);
  expect(nodeText(main.svg, 'a_n1')).toContain(flow.annotations[0].text);
  expect(all).toContain('Ordering "critical" reagents for R&D');
});

test('PT-11: output is deterministic', () => {
  const first = renderFixture('F6');
  for (let i = 0; i < 3; i++) {
    const again = renderFixture('F6');
    for (const id of Object.keys(first)) expect(again[id].svg).toBe(first[id].svg);
  }
});

test('PT-08: the largest fixture renders in under a second', () => {
  const start = performance.now();
  renderFixture('F6');
  expect(performance.now() - start).toBeLessThan(1000);
});

test('PT-04 / CM-05: step properties show Likert label and value, inferred marker and text-only quotes', () => {
  const f5 = renderFixture('F5').main.svg;
  expect(nodeText(f5, 'n_s1')).toContain('Difficulty: Easy (2)');
  expect(nodeText(f5, 'n_s3')).toContain('Difficulty: “It\'s not hard, it just depends on my week”');
  expect(nodeText(f5, 'n_s8')).toContain('Time: 40 min');
  expect(nodeText(renderFixture('F1').main.svg, 'task_summary')).toContain('Frequency: Weekly (3)*');
  expect(nodeText(renderFixture('F2')['E1'].svg, 'n_e1')).toContain('Receipt photo: Rejected (state)');
});

test('PT-16 / CM-06: threshold above shows a frustration marker; below does not', () => {
  const f5 = renderFixture('F5').main.svg;
  expect(nodeText(f5, 'n_s8')).toContain('Very hard (5) ▲');
  expect(nodeClasses(f5, 'n_s8')).toContain('frustration');
  const f2 = renderFixture('F2');
  expect(nodeText(f2.main.svg, 'x_out_E1_1')).toContain('▲');
  expect(nodeText(f2['E2'].svg, 'n_e6')).toContain('Rarely (1)*');
  expect(nodeText(f2['E2'].svg, 'n_e6')).not.toContain('▲');
});

test('CM-07: difficulty and outcome classes', () => {
  const f4 = renderFixture('F4').main.svg;
  expect(nodeClasses(f4, 'n_s2')).toContain('difficulty-4');
  expect(nodeClasses(f4, 'n_s8')).toContain('outcome-success');
  expect(nodeClasses(renderFixture('F2')['E2'].svg, 'n_e6')).toContain('outcome-abandonment');
  expect(nodeClasses(renderFixture('F6')['E2'].svg, 'n_e10')).toContain('outcome-failure');
});

test('PT-15 / CM-08: error links follow the visual standard and link between diagrams', () => {
  const { flow, cues } = fixture('F2');
  const [main, e1] = compileTaskFlow(flow, cues, { name: 'F2' });
  const svg = renderFixture('F2');

  // Main diagram: link-out hexagon in the trigger step's lane, linking to the error diagram
  expect(lanesOf(main.mermaid).get('x_out_E1_1')).toBe('Marcus Lee');
  expect(lanesOf(main.mermaid).get('x_out_E2_1')).toBe('Line manager');
  expect(nodeClasses(svg.main.svg, 'x_out_E1_1')).toEqual(expect.arrayContaining(['pele-shape-hex', 'errOut']));
  expect(nodeGroup(svg.main.svg, 'x_out_E1_1')[0]).toContain('href="F2.error-E1.svg"');
  // Main diagram: re-entry double circle in the target step's lane
  expect(lanesOf(main.mermaid).get('x_in_E2_s5')).toBe('Finance');
  expect(nodeClasses(svg.main.svg, 'x_in_E2_s5')).toEqual(expect.arrayContaining(['pele-shape-dbl-circ', 'errRet']));
  expect(nodeGroup(svg.main.svg, 'x_in_E2_s5')[0]).toContain('href="F2.error-E2.svg"');
  // Error diagram: entry hexagon and return double circle, both linking back to the main diagram
  expect(e1.fileName).toBe('F2.error-E1.svg');
  expect(nodeClasses(svg.E1.svg, 'x_entry_1')).toEqual(expect.arrayContaining(['pele-shape-hex', 'errOut']));
  expect(nodeText(svg.E1.svg, 'x_entry_1')).toContain('⚠ From main flow: Fill in claim form and attach photos');
  expect(nodeClasses(svg.E1.svg, 'n_e2')).toEqual(expect.arrayContaining(['pele-shape-dbl-circ', 'errRet']));
  expect(nodeText(svg.E1.svg, 'n_e2')).toContain('↩ Back to main flow: Fill in claim form and attach photos');
  expect(nodeGroup(svg.E1.svg, 'n_e2')[0]).toContain('href="F2.svg"');
});

test('CM-09: alternative views and corrections show speaker and timestamp', () => {
  expect(nodeText(renderFixture('F4').main.svg, 'a_n1')).toContain('Alternative view (Grace, 00:00:44): Doesn\'t print a sheet');
  expect(nodeText(renderFixture('F8').main.svg, 'a_n2')).toContain('Correction (Nadia, 00:00:50): Rated matching a 3');
});

test('ST-01: compiled Mermaid contains no colours or styles', () => {
  for (const prefix of ['F2', 'F6']) {
    const { flow, cues } = fixture(prefix);
    for (const d of compileTaskFlow(flow, cues)) expect(d.mermaid).not.toMatch(/^\s*(classDef|style|linkStyle)\b/m);
  }
});

test('ST-02: default theme is embedded unless disabled; extra stylesheets follow it', () => {
  const withDefault = renderFixture('F1', { stylesheets: { embed: ['.corporate { fill: red }'] } }).main.svg;
  expect(withDefault).toMatch(/^<svg\b[^>]*><style><!\[CDATA\[/);
  expect(withDefault.indexOf('--cds-background')).toBeLessThan(withDefault.indexOf('.corporate'));
  const without = renderFixture('F1', { defaultTheme: false }).main.svg;
  expect(without).not.toContain('<style>');
});

test('ST-03: linked stylesheets come before the svg element, in order', () => {
  const svg = renderFixture('F1', { stylesheets: { link: ['corporate.css', 'https://example.com/brand.css?a=1&b=2'] } }).main.svg;
  expect(svg.split('\n').slice(0, 3)).toEqual([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?xml-stylesheet type="text/css" href="corporate.css"?>',
    '<?xml-stylesheet type="text/css" href="https://example.com/brand.css?a=1&amp;b=2"?>',
  ]);
});

test('PT-17 / CM-12: loops are drawn as markers on dashed loop-back paths', () => {
  const { flow, cues } = fixture('F9');
  const [main] = compileTaskFlow(flow, cues, { name: 'F9' });
  const svg = renderFixture('F9').main.svg;
  const lanes = lanesOf(main.mermaid);

  // Repeat with a known count: last step -> marker -> first step
  expect(nodeClasses(svg, 'l_L1')).toEqual(expect.arrayContaining(['loop', 'loop-repeat']));
  expect(nodeText(svg, 'l_L1')).toContain('↻ × 5');
  expect(lanes.get('l_L1')).toBe('Area safety officer');
  expect(main.mermaid).toContain('n_s6 -.-> l_L1');
  expect(main.mermaid).toContain('l_L1 -.-> n_s2');

  // Repeat with a varying count (nested inside L1)
  expect(nodeText(svg, 'l_L2')).toContain('↻ For each extinguisher');

  // Iteration: the back transition is routed through the marker, labelled with the fail branch
  expect(nodeClasses(svg, 'l_L3')).toEqual(expect.arrayContaining(['loop', 'loop-iterate']));
  expect(nodeText(svg, 'l_L3')).toContain('↻ until Passes validation? is Yes');
  expect(nodeText(svg, 'l_L3')).toContain('Usually: 2');
  expect(nodeText(svg, 'l_L3')).toContain('Limit: 3 → Error flow E1');
  expect(main.mermaid).toContain('n_s9 -.->|"No"| l_L3');
  expect(main.mermaid).toContain('l_L3 -.-> n_s7');
  expect(main.mermaid).not.toMatch(/n_s9 -->\|"No"\| n_s7/);

  // The limit's error flow is linked from the decision like any other error
  expect(nodeGroup(svg, 'x_out_E1_1')[0]).toContain('href="F9.error-E1.svg"');
  // A correction to the count attaches to the loop marker
  expect(main.mermaid).toContain('a_n1 -.- l_L1');
});

test('CM-12: an existing iteration (F8) is drawn through its marker', () => {
  const { flow, cues } = fixture('F8');
  const [main] = compileTaskFlow(flow, cues);
  expect(main.mermaid).toContain('n_s5 -.->|"No"| l_L1');
  expect(main.mermaid).toContain('l_L1 -.-> n_s3');
});
