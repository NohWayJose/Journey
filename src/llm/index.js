// The only entry point for model use (D-024). Nothing outside src/llm/ imports a provider SDK.

import { loadConfig, resolveProfile } from './config.js';
import { resolveCredential } from './credentials.js';
import { ConfigError, ContextTooLongError } from './errors.js';
import { createAnthropicProvider } from './providers/anthropic.js';

export * from './errors.js';

const PROVIDERS = { anthropic: createAnthropicProvider };

/** Rough token estimate (generous: about 3 characters per token) used to decide whether to count exactly. */
const estimateTokens = (...parts) => Math.ceil(parts.reduce((n, p) => n + p.length, 0) / 3);

/**
 * @param {string | { profile?: string, model?: string }} [selection] the request's `llm` field
 * @param {{ config?: object, env?: object, clients?: Record<string, object> }} [options] clients are injectable for tests
 */
export function createLlm(selection, { config = loadConfig(), env = process.env, clients = {} } = {}) {
  const profile = resolveProfile(config, selection);
  const factory = PROVIDERS[profile.provider];
  if (!factory) throw new ConfigError(`Provider "${profile.provider}" is not available`);
  const provider = factory(profile, resolveCredential(profile.credential, env), { client: clients[profile.provider] });

  return {
    profile: { name: profile.name, provider: profile.provider, model: profile.model },
    capabilities: provider.capabilities,

    /**
     * @param {{ system: string, prompt: string, schema: object, maxOutputTokens?: number }} request
     * @returns {Promise<{ json: unknown, usage: { inputTokens: number, outputTokens: number }, stopReason: string, provider: string, model: string }>}
     */
    async generateStructured({ system, prompt, schema, maxOutputTokens = provider.capabilities.maxOutputTokens }) {
      // LL-07: never truncate or chunk (D-016); refuse before generating if the prompt can't fit
      const limit = provider.capabilities.contextWindow - maxOutputTokens;
      if (estimateTokens(system, prompt, JSON.stringify(schema)) > limit) {
        const counted = await provider.countTokens({ system, prompt });
        if (counted > limit) {
          throw new ContextTooLongError(`The transcript needs about ${counted} tokens; model ${profile.model} allows ${limit} for input`, { tokens: counted, limit });
        }
      }
      return provider.generate({ system, prompt, schema, maxOutputTokens });
    },
  };
}
