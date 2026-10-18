import { test, expect } from '@playwright/test';
import Anthropic from '@anthropic-ai/sdk';
import { createLlm, ConfigError, CredentialError, RefusalError, TruncatedOutputError, InvalidOutputError, ContextTooLongError, ProviderError } from '../../src/llm/index.js';
import { loadConfig, resolveProfile } from '../../src/llm/config.js';
import { resolveCredential } from '../../src/llm/credentials.js';

const config = {
  llm: {
    defaultProfile: 'default',
    profiles: {
      default: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', credential: 'provider-default' },
      keyed: { provider: 'anthropic', model: 'claude-opus-5-5', credential: 'env:JOURNEY_TEST_KEY', allowedModels: ['claude-sonnet-5-5'] },
      future: { provider: 'not-yet-built', model: 'x', credential: null },
    },
  },
};

/** Fake Anthropic client: records requests, returns a canned message (or throws). */
function fakeClient({ message, error, tokens = 1000 } = {}) {
  const calls = { stream: [], countTokens: [] };
  return {
    calls,
    beta: { messages: { stream: (params) => { calls.stream.push(params); return { finalMessage: async () => { if (error) throw error; return message; } }; } } },
    messages: { countTokens: async (params) => { calls.countTokens.push(params); return { input_tokens: tokens }; } },
  };
}
const okMessage = (json, extra = {}) => ({
  model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 45 },
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(json) }], ...extra,
});
const request = { system: 'Extract.', prompt: '[c1 00:00:00 Sam] Hello', schema: { type: 'object', properties: {}, additionalProperties: false } };

test('the shipped configuration defaults to Claude', () => {
  expect(resolveProfile(loadConfig())).toMatchObject({ name: 'default', provider: 'anthropic', model: 'claude-opus-5-5', credential: 'provider-default' });
});

test('LL-01: selections resolve to configured profiles only', () => {
  expect(resolveProfile(config).name).toBe('default');
  expect(resolveProfile(config, 'keyed').name).toBe('keyed');
  expect(resolveProfile(config, { profile: 'keyed', model: 'claude-sonnet-5-5' }).model).toBe('claude-sonnet-5-5');
  expect(() => resolveProfile(config, 'nope')).toThrow(ConfigError);
  expect(() => resolveProfile(config, { profile: 'default', model: 'claude-sonnet-5-5' })).toThrow(/not allowed/);
  // Callers can't smuggle in an endpoint or credential (D-024)
  expect(() => resolveProfile(config, { profile: 'default', baseUrl: 'https://evil.example', credential: 'env:X' })).toThrow(/Only a profile and a model/);
  expect(() => createLlm('future', { config })).toThrow(/not available/);
});

test('LL-02: credential references resolve without exposing values', () => {
  expect(resolveCredential('provider-default', {})).toEqual({ kind: 'provider-default' });
  expect(resolveCredential(null, {})).toEqual({ kind: 'none' });
  expect(resolveCredential('env:JOURNEY_TEST_KEY', { JOURNEY_TEST_KEY: 'sk-secret' })).toEqual({ kind: 'secret', value: 'sk-secret', source: 'env:JOURNEY_TEST_KEY' });
  expect(() => resolveCredential('env:JOURNEY_TEST_KEY', {})).toThrow(/JOURNEY_TEST_KEY is not set/);
  expect(() => resolveCredential('vault:secret/path', {})).toThrow(CredentialError);
});

test('LL-03: secret values never appear in errors or results', async () => {
  const pasted = 'sk-ant-api03-PASTED-BY-MISTAKE';
  const err = (() => { try { resolveCredential(pasted, {}); } catch (e) { return e; } })();
  expect(err.message).not.toContain(pasted);
  expect(err.message).not.toContain('PASTED');

  const client = fakeClient({ message: okMessage({ ok: true }) });
  const llm = createLlm('keyed', { config, env: { JOURNEY_TEST_KEY: 'sk-secret-value' }, clients: { anthropic: client } });
  const result = await llm.generateStructured(request);
  expect(JSON.stringify(result)).not.toContain('sk-secret-value');
  expect(JSON.stringify(llm.profile)).not.toContain('sk-secret-value');
});

test('LL-04: Anthropic requests use the profile, streaming, adaptive thinking, the schema and refusal fallbacks', async () => {
  const client = fakeClient({ message: okMessage({ ok: true }) });
  await createLlm(undefined, { config, clients: { anthropic: client } }).generateStructured(request);
  expect(client.calls.stream).toHaveLength(1);
  expect(client.calls.stream[0]).toEqual({
    model: 'claude-opus-5-5',
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: request.schema } },
    system: request.system,
    messages: [{ role: 'user', content: request.prompt }],
  });
});

test('LL-05: results carry the JSON, usage and the model that actually served the request', async () => {
  const client = fakeClient({ message: okMessage({ steps: 3 }, { model: 'claude-opus-4-8' }) }); // e.g. after a fallback
  const result = await createLlm(undefined, { config, clients: { anthropic: client } }).generateStructured(request);
  expect(result).toEqual({
    json: { steps: 3 }, usage: { inputTokens: 120, outputTokens: 45 }, stopReason: 'end_turn', provider: 'anthropic', model: 'claude-opus-4-8',
  });
});

test('LL-06: refusals, truncation, bad JSON and API failures map to common errors', async () => {
  const run = (opts) => createLlm(undefined, { config, clients: { anthropic: fakeClient(opts) } }).generateStructured(request);
  await expect(run({ message: okMessage({}, { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' }, content: [] }) }))
    .rejects.toMatchObject({ name: 'RefusalError', category: 'cyber' });
  await expect(run({ message: okMessage({}, { stop_reason: 'max_tokens' }) })).rejects.toThrow(TruncatedOutputError);
  await expect(run({ message: okMessage({}, { content: [{ type: 'text', text: '{"half": ' }] }) })).rejects.toThrow(InvalidOutputError);
  const rateLimited = Object.assign(Object.create(Anthropic.APIError.prototype), { status: 429, message: 'rate limited' });
  await expect(run({ error: rateLimited })).rejects.toMatchObject({ name: 'ProviderError', status: 429, retryable: true });
  expect(RefusalError.prototype).toBeInstanceOf(Error);
  expect(ProviderError.name).toBe('ProviderError');
});

test('LL-07: a prompt that cannot fit is rejected before any generation request', async () => {
  const huge = { ...request, prompt: 'x'.repeat(3_000_000) }; // estimate ~1M tokens
  const tooBig = fakeClient({ message: okMessage({}), tokens: 990_000 });
  await expect(createLlm(undefined, { config, clients: { anthropic: tooBig } }).generateStructured(huge)).rejects.toThrow(ContextTooLongError);
  expect(tooBig.calls.countTokens).toHaveLength(1);
  expect(tooBig.calls.stream).toHaveLength(0);

  // The rough estimate is generous: an exact count that fits lets the request through
  const fits = fakeClient({ message: okMessage({ ok: true }), tokens: 700_000 });
  await expect(createLlm(undefined, { config, clients: { anthropic: fits } }).generateStructured(huge)).resolves.toMatchObject({ json: { ok: true } });

  // Normal-sized prompts skip the token count entirely
  const small = fakeClient({ message: okMessage({ ok: true }) });
  await createLlm(undefined, { config, clients: { anthropic: small } }).generateStructured(request);
  expect(small.calls.countTokens).toHaveLength(0);
});

test('the example configuration includes an unverified IBM Bob profile that cannot run yet', () => {
  const example = loadConfig(new URL('../../journey.config.example.json', import.meta.url));
  expect(resolveProfile(example)).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' });
  expect(resolveProfile(example, 'bob')).toMatchObject({ provider: 'openai-compatible', credential: 'env:BOB_API_KEY' });
  expect(resolveProfile(example, 'bob').notes).toMatch(/EXAMPLE ONLY, NOT VERIFIED/);
  expect(() => createLlm('bob', { config: example, env: { BOB_API_KEY: 'x' } })).toThrow(/not available/);
});
