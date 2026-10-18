// Compiles a Task Flow Model to Mermaid `swimlane-beta` diagrams: one for the main flow and
// one per error flow. Rules CM-01 to CM-11 in specs/30-design.md#compiling-to-diagrams.

import { likertLabel } from '../model/scales.js';

const ENTITY = { '#': '#35;', '&': '#amp;', '"': '#quot;', '<': '#lt;', '>': '#gt;' };
/** CM-10: escape model text so it renders literally. */
export const escape = (text) => String(text).replace(/[#&"<>]/g, (ch) => ENTITY[ch]);

// Styling is CSS only (D-017): this module emits class names, never colours or line styles.

const ANNOTATION_PREFIX = {
  note: 'Note', hesitation: 'Hesitation', workaround: 'Workaround', opinion: 'Opinion',
  quote: 'Quote', alternativeView: 'Alternative view', correction: 'Correction',
};

const SHAPES = {
  rect: (t) => `["${t}"]`,
  diamond: (t) => `{"${t}"}`,
  stadium: (t) => `(["${t}"])`,
  round: (t) => `("${t}")`,
  flag: (t) => `>"${t}"]`,
  hexagon: (t) => `{{"${t}"}}`,
  doubleCircle: (t) => `((("${t}")))`,
};

/** Splits text into lines of at most `width` characters at word boundaries (0 = no wrapping). */
function wrap(text, width) {
  if (!width) return [text];
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
}

const truncate = (text, max = 48) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

const timestamp = (ms) => new Date(ms).toISOString().slice(11, 19);

/** CM-05 / CM-06 */
function measureLine(name, m) {
  const head = name[0].toUpperCase() + name.slice(1);
  const body = m.value !== null
    ? `${likertLabel(name, m.value)} (${m.value})${m.basis === 'inferred' ? '*' : ''}`
    : `“${truncate(m.text)}”`;
  return `${head}: ${body}${m.threshold === 'above' ? ' ▲' : ''}`;
}

function metricLines(metrics) {
  const lines = [];
  const { timeOnTask: t, attempts: a } = metrics;
  if (t) lines.push(`Time: ${t.minutes !== null ? formatMinutes(t.minutes) : `“${truncate(t.text)}”`}`);
  if (a) lines.push(`Attempts: ${a.count !== null ? `${a.count}` : `“${truncate(a.text)}”`}`);
  return lines;
}

function propertyLines(step, detail) {
  const lines = [];
  if (step.frequency) lines.push(measureLine('frequency', step.frequency));
  if (step.difficulty) lines.push(measureLine('difficulty', step.difficulty));
  if (detail === 'summary') return lines;
  for (const a of step.attributes) lines.push(`${a.name}: ${a.value}`);
  for (const s of step.states) lines.push(`${s.name}: ${s.value} (state)`);
  return [...lines, ...metricLines(step.metrics)];
}

const hasFrustration = (...measures) => measures.some((m) => m?.threshold === 'above');

/** Collects lanes, nodes, edges and styling for one diagram and prints it as Mermaid. */
class Diagram {
  constructor(title, direction) {
    this.title = title;
    this.direction = direction;
    this.lanes = new Map(); // key -> { label, nodes: [] }
    this.edges = [];
    this.classes = [];
    this.clicks = [];
  }

  lane(key, label) {
    if (!this.lanes.has(key)) this.lanes.set(key, { label, nodes: [] });
    return this.lanes.get(key);
  }

  node(laneKey, laneLabel, id, shape, lines, classes = []) {
    const text = lines.filter((l) => l !== null && l !== undefined).join('<br/>');
    this.lane(laneKey, laneLabel).nodes.push(`${id}${SHAPES[shape](text)}`);
    for (const c of classes) this.classes.push(`class ${id} ${c}`);
  }

  edge(from, to, { label = null, style = 'solid' } = {}) {
    const arrow = { solid: '-->', dashed: '-.->', dotted: '-.-' }[style];
    const lbl = label === null ? '' : `|"${escape(label)}"|`;
    this.edges.push(`${from} ${arrow}${lbl} ${to}`);
  }

  click(id, href, tooltip) {
    this.clicks.push(`click ${id} href "${href}" "${escape(tooltip)}"`);
  }

  toString() {
    const out = ['---', `title: ${JSON.stringify(this.title)}`, '---', `swimlane-beta ${this.direction}`];
    let i = 0;
    for (const { label, nodes } of this.lanes.values()) {
      out.push(`  subgraph lane_${++i}["${escape(label)}"]`, ...nodes.map((n) => `    ${n}`), '  end');
    }
    out.push(...this.edges.map((e) => `  ${e}`), ...this.classes.map((c) => `  ${c}`), ...this.clicks.map((c) => `  ${c}`));
    return out.join('\n') + '\n';
  }
}

/**
 * @param {object} flow the `flow` part of a Task Flow Document
 * @param {{id: string, startMs: number}[]} cues
 * @param {{ name?: string, direction?: 'LR'|'TB', detail?: 'full'|'summary', wrapAt?: number }} [options]
 * @returns {{ id: string, fileName: string, mermaid: string }[]} main diagram first, then one per error flow
 */
export function compileTaskFlow(flow, cues, { name = 'flow', direction = 'LR', detail = 'full', wrapAt = 0 } = {}) {
  const fileOf = (flowId) => (flowId === 'main' ? `${name}.svg` : `${name}.error-${flowId}.svg`);
  const startOf = new Map(cues.map((c) => [c.id, c.startMs]));
  const actors = new Map(flow.actors.map((a) => [a.id, a]));
  const steps = new Map([...flow.steps, ...flow.errorFlows.flatMap((f) => f.steps)].map((s) => [s.id, s]));
  const lines = (text) => wrap(text, wrapAt).map(escape);
  const small = (text) => `<small>${escape(text)}</small>`;
  const nid = (id) => `n_${id}`;

  const newDiagram = (title) => new Diagram(title, direction);
  const laneFor = (d, actorId, stepsInDiagram) => {
    // CM-02: lanes appear in `actors` order regardless of the order nodes are added
    if (!d.lanes.size) for (const a of flow.actors) if (stepsInDiagram.some((s) => s.actorId === a.id)) d.lane(a.id, a.name);
    return [actorId, actors.get(actorId).name];
  };

  function addStep(d, step, stepsInDiagram) {
    const [lane, laneLabel] = laneFor(d, step.actorId, stepsInDiagram);
    const props = propertyLines(step, detail).map(small);
    const classes = [];
    if (step.difficulty?.value) classes.push(`difficulty-${step.difficulty.value}`);
    if (hasFrustration(step.frequency, step.difficulty)) classes.push('frustration');
    if (step.kind === 'outcome') classes.push(`outcome-${step.outcome}`);
    if (step.kind === 'return') {
      const target = steps.get(step.returnToStepId);
      d.node(lane, laneLabel, nid(step.id), 'doubleCircle',
        [...lines(`↩ Back to main flow: ${target.label}`), small(step.label), ...props], ['errRet']);
      d.click(nid(step.id), fileOf('main'), `Back to main flow: ${target.label}`);
      return;
    }
    const shape = { action: 'rect', decision: 'diamond', outcome: 'stadium' }[step.kind];
    d.node(lane, laneLabel, nid(step.id), shape, [...lines(step.label), ...props], classes);
  }

  const loopMarkers = new Map(); // loop id -> { d, lane, laneLabel, id }

  /** Transitions plus loop markers (CM-11, CM-12). Iteration back edges are routed through their marker. */
  function addTransitionsAndLoops(d, transitions, loops, stepsInDiagram) {
    const backEdge = (l) => transitions.find((t) => t.from === l.lastStepId && t.to === l.firstStepId && t.condition === l.fail);
    const routed = new Set(loops.filter((l) => l.kind === 'iterate').map(backEdge).filter(Boolean));
    for (const t of transitions) if (!routed.has(t)) d.edge(nid(t.from), nid(t.to), { label: t.condition });

    for (const l of loops) {
      const first = steps.get(l.firstStepId);
      const [lane, laneLabel] = laneFor(d, first.actorId, stepsInDiagram);
      const id = `l_${l.id}`;
      let text;
      if (l.kind === 'repeat') {
        text = l.count.value !== null
          ? [...lines(`↻ × ${l.count.value}`), small(`“${truncate(l.count.text)}”`)]
          : lines(`↻ ${l.count.text}`);
        d.node(lane, laneLabel, id, 'round', text, ['loop', 'loop-repeat']);
        d.edge(nid(l.lastStepId), id, { style: 'dashed' });
      } else {
        const decision = steps.get(l.lastStepId);
        const it = l.iterations;
        const lim = l.limit;
        text = [
          ...lines(`↻ until ${decision.label} is ${l.pass}`),
          it ? small(`Usually: ${it.count !== null ? it.count : `“${truncate(it.text)}”`}`) : null,
          lim ? small(`Limit: ${lim.count !== null ? lim.count : `“${truncate(lim.text)}”`}${lim.errorFlowId ? ` → Error flow ${lim.errorFlowId}` : ''}`) : null,
        ];
        d.node(lane, laneLabel, id, 'round', text, ['loop', 'loop-iterate']);
        d.edge(nid(l.lastStepId), id, { style: 'dashed', label: l.fail });
      }
      d.edge(id, nid(l.firstStepId), { style: 'dashed' });
      loopMarkers.set(l.id, { d, lane, laneLabel, id });
    }
  }

  function annotationText(n) {
    const prefix = ANNOTATION_PREFIX[n.kind];
    const who = [];
    if (n.kind === 'alternativeView' || n.kind === 'correction') {
      if (n.speaker) who.push(n.speaker);
      who.push(timestamp(startOf.get(n.evidence[0])));
    }
    return `${prefix}${who.length ? ` (${who.join(', ')})` : ''}: ${n.text}`;
  }

  function addAnnotation(d, n, lane, laneLabel, attachTo) {
    const id = `a_${n.id}`;
    d.node(lane, laneLabel, id, 'flag', lines(annotationText(n)), ['annotation']);
    if (attachTo) d.edge(id, attachTo, { style: 'dotted' });
  }

  // ---- Main diagram ------------------------------------------------------
  const main = newDiagram(flow.title);
  const mainStepIds = new Set(flow.steps.map((s) => s.id));
  const mainTransitions = new Map(flow.transitions.map((t) => [t.id, t]));
  for (const s of flow.steps) addStep(main, s, flow.steps);
  addTransitionsAndLoops(main, flow.transitions, flow.loops, flow.steps);

  const linkOuts = new Map(); // errorFlowId -> first link-out node id
  for (const ef of flow.errorFlows) {
    ef.triggers.forEach((tr, i) => {
      const from = steps.get(tr.fromStepId);
      const id = `x_out_${ef.id}_${i + 1}`;
      const freq = tr.frequency ? small(`${tr.frequency.value !== null ? likertLabel('frequency', tr.frequency.value) : `“${truncate(tr.frequency.text)}”`}${tr.frequency.threshold === 'above' ? ' ▲' : ''}`) : null;
      main.node(...laneFor(main, from.actorId, flow.steps), id, 'hexagon',
        [...lines(`⚠ ${tr.condition}`), ...lines(`→ Error flow ${ef.id}`), freq], ['errOut']);
      main.edge(nid(from.id), id, { style: 'dashed' });
      main.click(id, fileOf(ef.id), `Open error flow ${ef.id}: ${ef.title}`);
      if (!linkOuts.has(ef.id)) linkOuts.set(ef.id, id);
    });
    const targets = [...new Set(ef.steps.filter((s) => s.kind === 'return').map((s) => s.returnToStepId))];
    for (const targetId of targets) {
      const target = steps.get(targetId);
      const id = `x_in_${ef.id}_${targetId}`;
      main.node(...laneFor(main, target.actorId, flow.steps), id, 'doubleCircle', lines(`↩ from ${ef.id}`), ['errRet']);
      main.edge(id, nid(targetId), { style: 'dashed' });
      main.click(id, fileOf(ef.id), `Returns from error flow ${ef.id}: ${ef.title}`);
    }
  }

  // Task lane: summary + task-level annotations (CM-02)
  const summary = [
    ...lines(`Goal: ${flow.goal.text}`),
    flow.frequency ? small(measureLine('frequency', flow.frequency)) : null,
    flow.difficulty ? small(measureLine('difficulty', flow.difficulty)) : null,
    ...metricLines(flow.metrics).map(small),
  ];
  main.node('task', 'Task', 'task_summary', 'rect', summary, ['summary']);

  // ---- Error diagrams ----------------------------------------------------
  const errorDiagrams = flow.errorFlows.map((ef) => {
    const d = newDiagram(`${flow.title} — Error flow ${ef.id}: ${ef.title}`);
    const start = steps.get(ef.startStepId);
    for (const s of ef.steps) addStep(d, s, ef.steps);
    ef.triggers.forEach((tr, i) => {
      const id = `x_entry_${i + 1}`;
      const from = steps.get(tr.fromStepId);
      d.node(...laneFor(d, start.actorId, ef.steps), id, 'hexagon',
        [...lines(`⚠ From main flow: ${from.label}`), small(tr.condition)], ['errOut']);
      d.edge(id, nid(start.id), { style: 'dashed' });
      d.click(id, fileOf('main'), `Back to main flow: ${from.label}`);
    });
    addTransitionsAndLoops(d, ef.transitions, ef.loops, ef.steps);
    return { ef, d, stepIds: new Set(ef.steps.map((s) => s.id)), transitions: new Map(ef.transitions.map((t) => [t.id, t])) };
  });

  // ---- Annotations (CM-09) ---------------------------------------------
  for (const n of flow.annotations) {
    const target = n.targetId;
    if (target === null) { addAnnotation(main, n, 'task', 'Task', 'task_summary'); continue; }
    if (actors.has(target)) { addAnnotation(main, n, target, actors.get(target).name, null); continue; }
    if (loopMarkers.has(target)) {
      const m = loopMarkers.get(target);
      addAnnotation(m.d, n, m.lane, m.laneLabel, m.id);
      continue;
    }
    const errorTarget = errorDiagrams.find((e) => e.ef.id === target);
    if (errorTarget) {
      const start = steps.get(errorTarget.ef.startStepId);
      addAnnotation(errorTarget.d, { ...n, id: `${n.id}` }, start.actorId, actors.get(start.actorId).name, 'x_entry_1');
      const out = linkOuts.get(target);
      const from = steps.get(errorTarget.ef.triggers[0].fromStepId);
      addAnnotation(main, { ...n, id: `${n.id}_main` }, from.actorId, actors.get(from.actorId).name, out);
      continue;
    }
    const stepId = steps.has(target) ? target : (mainTransitions.get(target) ?? errorDiagrams.map((e) => e.transitions.get(target)).find(Boolean)).from;
    const step = steps.get(stepId);
    const d = mainStepIds.has(stepId) ? main : errorDiagrams.find((e) => e.stepIds.has(stepId)).d;
    addAnnotation(d, n, step.actorId, actors.get(step.actorId).name, nid(stepId));
  }

  return [
    { id: 'main', fileName: fileOf('main'), mermaid: main.toString() },
    ...errorDiagrams.map(({ ef, d }) => ({ id: ef.id, fileName: fileOf(ef.id), mermaid: d.toString() })),
  ];
}
