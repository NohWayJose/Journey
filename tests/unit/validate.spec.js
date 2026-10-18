import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { validateDocument, validateFlow } from '../../src/model/validate.js';
import { parseVtt } from '../../src/vtt/parse.js';

const example = JSON.parse(readFileSync(new URL('../../schemas/examples/checkout.flow.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(example);
const step = (doc, id) => [...doc.flow.steps, ...doc.flow.errorFlows.flatMap((f) => f.steps)].find((s) => s.id === id);
const rules = (doc) => validateDocument(doc).map((e) => e.rule);

test('worked example passes all rules', () => {
  expect(validateDocument(example)).toEqual([]);
  expect(validateFlow(example.flow, example.cues)).toEqual([]);
});

test('schema errors are reported before semantic rules run', () => {
  const doc = copy();
  doc.flow.steps[0].frequency.value = 7;
  expect(new Set(rules(doc))).toEqual(new Set(['schema']));
});

// Each case breaks the worked example in one way and expects that rule to report it.
const cases = {
  'DS-10': (d) => { d.flow.annotations[0].id = 's1'; },
  'DS-11': (d) => { d.flow.transitions[0].to = 'nowhere'; },
  'DS-12': (d) => { d.flow.goal.evidence = ['c99']; },
  'DS-13': (d) => { d.flow.transitions.find((t) => t.id === 't3').condition = null; },
  'DS-14': (d) => { d.flow.transitions.push({ id: 't9', from: 's1', to: 's6', condition: null, evidence: ['c6'] }); },
  'DS-15': (d) => { step(d, 's5').outcome = null; },
  'DS-16': (d) => { d.flow.transitions = d.flow.transitions.filter((t) => t.id !== 't3'); d.flow.transitions.push({ id: 't3', from: 's2', to: 's3', condition: 'Maybe', evidence: ['c6'] }); },
  'DS-17': (d) => { step(d, 'e2').returnToStepId = 'e1'; },
  'DS-18': (d) => { step(d, 's1').difficulty.value = null; },
  'DS-19': (d) => { d.flow.participants[2].isMainSpeaker = true; },
  'DS-20': (d) => { step(d, 's2').evidence = ['c1', 'c3']; },
  'DS-21': (d) => { d.flow.errorFlows[0].triggers[0].fromStepId = 'e1'; },
  'DS-22': (d) => { d.flow.errorFlows[0].transitions[0].to = 's3'; },
};

for (const [rule, breakIt] of Object.entries(cases)) {
  test(`${rule}: is detected`, () => {
    const doc = copy();
    breakIt(doc);
    expect(rules(doc)).toContain(rule);
  });
}

// Loop rules break fixture F9 (repeat x5 containing a for-each repeat, plus an iteration with a limit)
const f9Dir = new URL('../fixtures/F9-site-inspections-loops/', import.meta.url);
const f9Cues = parseVtt(readFileSync(new URL('transcript.vtt', f9Dir), 'utf8')).cues;
const f9 = JSON.parse(readFileSync(new URL('expected.flow.json', f9Dir), 'utf8'));
const loop = (flow, id) => flow.loops.find((l) => l.id === id);

const loopCases = {
  'DS-23': (f) => { loop(f, 'L1').lastStepId = 's1'; },
  'DS-24': (f) => { loop(f, 'L3').fail = 'Maybe'; },
  'DS-25': (f) => { f.transitions.push({ id: 't99', from: 's6', to: 's2', condition: null, evidence: ['c4'] }); },
  'DS-26': (f) => { f.loops = f.loops.filter((l) => l.id !== 'L3'); },
  'DS-27': (f) => { loop(f, 'L1').lastStepId = 's3'; loop(f, 'L2').firstStepId = 's3'; },
  'DS-28': (f) => { f.errorFlows[0].triggers[0].fromStepId = 's8'; },
};

test('F9 loops pass all rules', () => {
  expect(validateFlow(f9, f9Cues)).toEqual([]);
});

for (const [rule, breakIt] of Object.entries(loopCases)) {
  test(`${rule}: is detected`, () => {
    const flow = structuredClone(f9);
    breakIt(flow);
    expect(validateFlow(flow, f9Cues).map((e) => e.rule)).toContain(rule);
  });
}
