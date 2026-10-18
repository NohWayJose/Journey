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
    { id: 'main', startStepId: flow.startStepId, steps: flow.steps, transitions: flow.transitions, loops: flow.loops },
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
    ...flow.errorFlows.map((f) => f.id), ...flows.flatMap((f) => f.loops.map((l) => l.id)), ...flow.annotations.map((n) => n.id),
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

  // DS-23 to DS-28: loops
  for (const f of flows) {
    const backEdges = new Set(); // declared iteration back transitions
    const valid = [];
    for (const l of f.loops) {
      if (stepFlow.get(l.firstStepId) !== f.id || stepFlow.get(l.lastStepId) !== f.id) {
        fail('DS-23', `Loop ${l.id} must start and end at steps in flow ${f.id}`);
        continue;
      }
      if (l.kind === 'iterate') {
        const out = f.transitions.filter((t) => t.from === l.lastStepId);
        const back = out.find((t) => t.to === l.firstStepId && t.condition === l.fail);
        if (steps.get(l.lastStepId).kind !== 'decision') fail('DS-24', `Iteration ${l.id} must end at a decision`);
        if (l.pass === null || l.fail === null) fail('DS-24', `Iteration ${l.id} needs pass and fail criteria`);
        if (!back) fail('DS-24', `Iteration ${l.id} has no transition back to ${l.firstStepId} labelled "${l.fail}"`);
        if (!out.some((t) => t !== back && t.condition === l.pass)) fail('DS-24', `Iteration ${l.id} has no exit transition labelled "${l.pass}"`);
        if (l.count !== null) fail('DS-24', `Iteration ${l.id} must not have a count`);
        if (back) backEdges.add(back.id);
        // DS-28
        if (l.limit?.errorFlowId) {
          const target = flow.errorFlows.find((e) => e.id === l.limit.errorFlowId);
          if (!target) fail('DS-28', `Iteration ${l.id} limit refers to unknown error flow "${l.limit.errorFlowId}"`);
          else if (!target.triggers.some((tr) => tr.fromStepId === l.lastStepId)) {
            fail('DS-28', `Error flow ${target.id} has no trigger from ${l.lastStepId}, where iteration ${l.id} runs out of tries`);
          }
        }
      } else if (l.count === null || l.pass !== null || l.fail !== null || l.iterations !== null || l.limit !== null) {
        fail('DS-25', `Repeat ${l.id} needs a count and no pass, fail, iterations or limit`);
      }
      valid.push(l);
    }

    const forward = f.transitions.filter((t) => !backEdges.has(t.id));
    const reach = (start, next) => {
      const seenSteps = new Set([start]);
      const queue = [start];
      while (queue.length) for (const n of next(queue.shift())) if (!seenSteps.has(n)) { seenSteps.add(n); queue.push(n); }
      return seenSteps;
    };
    const bodies = new Map();
    for (const l of valid) {
      const after = reach(l.firstStepId, (id) => forward.filter((t) => t.from === id).map((t) => t.to));
      if (!after.has(l.lastStepId)) { fail('DS-23', `Loop ${l.id}: ${l.lastStepId} is not reachable from ${l.firstStepId}`); continue; }
      const before = reach(l.lastStepId, (id) => forward.filter((t) => t.to === id).map((t) => t.from));
      const body = new Set([...after].filter((id) => before.has(id)));
      bodies.set(l.id, body);
      if (l.kind === 'repeat' && f.transitions.some((t) => body.has(t.from) && t.to === l.firstStepId)) {
        fail('DS-25', `Repeat ${l.id} must not have a transition back to ${l.firstStepId}`);
      }
    }

    // DS-26: what remains after removing declared back transitions must be acyclic
    const state = new Map(); // undefined = unvisited, 1 = on stack, 2 = done
    const visit = (id) => {
      state.set(id, 1);
      for (const t of forward.filter((tr) => tr.from === id)) {
        if (state.get(t.to) === 1) fail('DS-26', `Transition ${t.id} closes a cycle in flow ${f.id} that is not a declared iteration`);
        else if (!state.has(t.to)) visit(t.to);
      }
      state.set(id, 2);
    };
    for (const s of f.steps) if (!state.has(s.id)) visit(s.id);

    // DS-27
    const entries = [...bodies];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [a, A] = entries[i];
        const [b, B] = entries[j];
        const shared = [...A].filter((id) => B.has(id)).length;
        if (shared && shared !== A.size && shared !== B.size) fail('DS-27', `Loops ${a} and ${b} overlap without one containing the other`);
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
