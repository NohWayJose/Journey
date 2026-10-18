// Task Flow Model validation: JSON Schema (Ajv) then semantic rules DS-10 to DS-22
// (specs/30-design.md#semantic-rules).

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const schema = JSON.parse(readFileSync(new URL('../../schemas/task-flow.schema.json', import.meta.url), 'utf8'));

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
ajv.addSchema(schema);
const validateDocumentSchema = ajv.getSchema(schema.$id);
const validateFlowSchema = ajv.getSchema(`${schema.$id}#/$defs/flow`);

const schemaErrors = (validate) =>
  (validate.errors ?? []).map((e) => ({ rule: 'schema', message: `${e.instancePath || '/'} ${e.message}` }));

/** Yields every object nested anywhere in value, with its JSON path. */
function* objects(value, path = '') {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) yield* objects(v, `${path}/${i}`);
  } else if (value && typeof value === 'object') {
    yield [value, path];
    for (const [k, v] of Object.entries(value)) yield* objects(v, `${path}/${k}`);
  }
}

/**
 * @param {object} flow the `flow` part of a Task Flow Document
 * @param {{id: string, speaker: string|null}[]} cues
 * @returns {{rule: string, message: string}[]}
 */
export function semanticErrors(flow, cues) {
  const errors = [];
  const fail = (rule, message) => errors.push({ rule, message });

  const flows = [
    { id: 'main', startStepId: flow.startStepId, steps: flow.steps, transitions: flow.transitions },
    ...flow.errorFlows,
  ];
  const stepFlow = new Map(flows.flatMap((f) => f.steps.map((s) => [s.id, f.id])));
  const steps = new Map(flows.flatMap((f) => f.steps.map((s) => [s.id, s])));
  const transitions = flows.flatMap((f) => f.transitions);
  const outgoing = (id) => transitions.filter((t) => t.from === id);
  const isMainStep = (id) => stepFlow.get(id) === 'main';

  // DS-10
  const ids = [
    ...flow.actors.map((a) => a.id), ...steps.keys(), ...transitions.map((t) => t.id),
    ...flow.errorFlows.map((f) => f.id), ...flow.annotations.map((n) => n.id),
  ];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) fail('DS-10', `Duplicate ID "${id}"`);
    seen.add(id);
  }

  // DS-11
  const actorIds = new Set(flow.actors.map((a) => a.id));
  const ref = (id, what) => { if (!seen.has(id)) fail('DS-11', `${what} refers to unknown ID "${id}"`); };
  for (const s of steps.values()) {
    if (!actorIds.has(s.actorId)) fail('DS-11', `Step ${s.id} refers to unknown actor "${s.actorId}"`);
    if (s.returnToStepId !== null) ref(s.returnToStepId, `Step ${s.id} returnToStepId`);
  }
  for (const t of transitions) { ref(t.from, `Transition ${t.id} from`); ref(t.to, `Transition ${t.id} to`); }
  for (const f of flows) {
    if (stepFlow.get(f.startStepId) !== f.id) fail('DS-11', `Flow ${f.id} startStepId "${f.startStepId}" is not one of its steps`);
  }
  for (const f of flow.errorFlows) for (const tr of f.triggers) ref(tr.fromStepId, `Error flow ${f.id} trigger`);
  for (const n of flow.annotations) if (n.targetId !== null) ref(n.targetId, `Annotation ${n.id}`);

  // DS-12
  const cueIds = new Set(cues.map((c) => c.id));
  for (const [obj, path] of objects(flow)) {
    if (!Array.isArray(obj.evidence)) continue;
    if (obj.evidence.length === 0) fail('DS-12', `${path || '/'} has no evidence`);
    for (const c of obj.evidence) if (!cueIds.has(c)) fail('DS-12', `${path || '/'} cites unknown cue "${c}"`);
  }

  for (const s of steps.values()) {
    const out = outgoing(s.id);
    // DS-13
    if (s.kind === 'decision') {
      if (out.length < 2) fail('DS-13', `Decision ${s.id} has fewer than two outgoing transitions`);
      for (const t of out) if (!t.condition) fail('DS-13', `Transition ${t.id} leaves decision ${s.id} without a condition`);
    } else if (out.length > 1) {
      fail('DS-14', `Step ${s.id} is not a decision but has ${out.length} outgoing transitions`);
    }
    // DS-15
    if (s.kind === 'outcome') {
      if (s.outcome === null) fail('DS-15', `Outcome step ${s.id} has no outcome value`);
      if (out.length > 0) fail('DS-15', `Outcome step ${s.id} has outgoing transitions`);
    } else if (s.outcome !== null) {
      fail('DS-15', `Step ${s.id} is not an outcome but has outcome "${s.outcome}"`);
    }
    // DS-17
    if (s.kind === 'return') {
      if (isMainStep(s.id)) fail('DS-17', `Return step ${s.id} is in the main flow`);
      if (out.length > 0) fail('DS-17', `Return step ${s.id} has outgoing transitions`);
      if (s.returnToStepId === null || !isMainStep(s.returnToStepId)) {
        fail('DS-17', `Return step ${s.id} must return to a main-flow step`);
      }
    } else if (s.returnToStepId !== null) {
      fail('DS-17', `Step ${s.id} is not a return step but has returnToStepId`);
    }
  }

  // DS-16
  for (const f of flows) {
    if (!f.steps.some((s) => s.kind === 'outcome' || s.kind === 'return')) {
      fail('DS-16', `Flow ${f.id} has no outcome or return step`);
    }
    const reached = new Set([f.startStepId]);
    const queue = [f.startStepId];
    while (queue.length) for (const t of outgoing(queue.shift())) if (!reached.has(t.to)) { reached.add(t.to); queue.push(t.to); }
    for (const s of f.steps) if (!reached.has(s.id)) fail('DS-16', `Step ${s.id} is not reachable from the start of flow ${f.id}`);
  }

  // DS-18
  for (const [m, path] of objects(flow)) {
    if (!('basis' in m)) continue;
    if (m.basis === 'text' && (m.value !== null || !m.text)) fail('DS-18', `${path}: a text measure needs text and no value`);
    if (m.basis !== 'text' && m.value === null) fail('DS-18', `${path}: a ${m.basis} measure needs a value`);
  }

  // DS-19
  const main = flow.participants.filter((p) => p.isMainSpeaker);
  if (main.length !== 1) fail('DS-19', `Expected exactly one main speaker, found ${main.length}`);
  for (const p of main) if (p.role === 'interviewer') fail('DS-19', `Interviewer "${p.speakerLabel}" is marked as main speaker`);

  // DS-20
  const interviewers = new Set(flow.participants.filter((p) => p.role === 'interviewer').map((p) => p.speakerLabel));
  const speakerOf = new Map(cues.map((c) => [c.id, c.speaker]));
  for (const s of steps.values()) {
    if (s.evidence.length && s.evidence.every((c) => interviewers.has(speakerOf.get(c)))) {
      fail('DS-20', `Step ${s.id} is supported only by interviewer cues`);
    }
  }

  // DS-21
  for (const f of flow.errorFlows) {
    if (f.triggers.length === 0) fail('DS-21', `Error flow ${f.id} has no trigger`);
    for (const tr of f.triggers) if (!isMainStep(tr.fromStepId)) fail('DS-21', `Error flow ${f.id} is triggered from "${tr.fromStepId}", which is not a main-flow step`);
  }

  // DS-22
  for (const f of flows) {
    for (const t of f.transitions) {
      if (stepFlow.get(t.from) !== f.id || stepFlow.get(t.to) !== f.id) {
        fail('DS-22', `Transition ${t.id} in flow ${f.id} connects steps outside that flow`);
      }
    }
  }

  return errors;
}

/** Validates the `flow` part (what Claude returns) against the schema, then the semantic rules. */
export function validateFlow(flow, cues) {
  if (!validateFlowSchema(flow)) return schemaErrors(validateFlowSchema);
  return semanticErrors(flow, cues);
}

/** Validates a whole Task Flow Document. */
export function validateDocument(doc) {
  if (!validateDocumentSchema(doc)) return schemaErrors(validateDocumentSchema);
  return semanticErrors(doc.flow, doc.cues);
}
