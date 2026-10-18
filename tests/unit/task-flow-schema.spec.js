import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const schema = readJson('../../schemas/task-flow.schema.json');
const example = readJson('../../schemas/examples/checkout.flow.json');

// Keywords Claude structured outputs does not support (specs/30-design.md#structured-output-constraints)
const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'patternProperties'];

function* walk(node, path = '#') {
  if (Array.isArray(node)) {
    for (const [i, child] of node.entries()) yield* walk(child, `${path}/${i}`);
  } else if (node && typeof node === 'object') {
    yield [node, path];
    for (const [key, child] of Object.entries(node)) yield* walk(child, `${path}/${key}`);
  }
}

const schemaNodes = [...walk(schema)].filter(([, path]) => !/\/properties$|\/\$defs$/.test(path));

test('DS-01: every object closes additionalProperties and requires all its properties', () => {
  for (const [node, path] of schemaNodes) {
    if (!node.properties) continue;
    expect(node.additionalProperties, path).toBe(false);
    expect([...node.required].sort(), path).toEqual(Object.keys(node.properties).sort());
  }
});

test('DS-02: uses no keywords unsupported by structured outputs', () => {
  for (const [node, path] of schemaNodes) {
    for (const keyword of UNSUPPORTED) expect(node, `${path} uses ${keyword}`).not.toHaveProperty(keyword);
  }
});

test('DS-03: flow schema is not recursive', () => {
  const refsFrom = (def) => [...walk(schema.$defs[def])].map(([n]) => n.$ref).filter(Boolean)
    .map((ref) => ref.replace('#/$defs/', ''));
  const visit = (def, seen) => {
    expect(seen, `cycle through ${def}`).not.toContain(def);
    for (const next of refsFrom(def)) visit(next, [...seen, def]);
  };
  visit('flow', []);
});

test('worked example is valid against the schema', () => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(example);
  expect(validate.errors ?? [], 'schema errors').toEqual([]);
  expect(valid).toBe(true);
});
