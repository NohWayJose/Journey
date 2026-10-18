// Model profiles (D-024): defined in journey.config.json by the server operator, selected by name per request.

import { readFileSync } from 'node:fs';
import { ConfigError } from './errors.js';

export const DEFAULT_CONFIG_PATH = new URL('../../journey.config.json', import.meta.url);

export function loadConfig(path = DEFAULT_CONFIG_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * LL-01: resolves a request's `llm` selection to a profile.
 * @param {object} config parsed journey.config.json
 * @param {string | { profile?: string, model?: string } | undefined} selection
 * @returns {{ name: string, provider: string, model: string, effort?: string, credential: string|null, baseUrl?: string }}
 */
export function resolveProfile(config, selection) {
  const sel = typeof selection === 'string' ? { profile: selection } : (selection ?? {});
  const extra = Object.keys(sel).filter((k) => k !== 'profile' && k !== 'model');
  if (extra.length) throw new ConfigError(`Only a profile and a model can be selected, not: ${extra.join(', ')}`);

  const { defaultProfile, profiles } = config.llm;
  const name = sel.profile ?? defaultProfile;
  const profile = profiles[name];
  if (!profile) throw new ConfigError(`Unknown model profile "${name}"`);

  let { model } = profile;
  if (sel.model && sel.model !== model) {
    if (!(profile.allowedModels ?? []).includes(sel.model)) {
      throw new ConfigError(`Model "${sel.model}" is not allowed for profile "${name}"`);
    }
    model = sel.model;
  }
  return { name, ...profile, model };
}
