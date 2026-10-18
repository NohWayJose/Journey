import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { validateDocument, validateFlow } from '../../src/model/validate.js';

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
