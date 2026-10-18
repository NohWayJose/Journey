// Credential references (D-025): profiles say where a secret is, never what it is.

import { CredentialError } from './errors.js';

/**
 * LL-02: resolves a profile's `credential` reference.
 * @param {string | null | undefined} ref
 * @param {Record<string, string | undefined>} env
 * @returns {{ kind: 'none' } | { kind: 'provider-default' } | { kind: 'secret', value: string, source: string }}
 */
export function resolveCredential(ref, env = process.env) {
  if (ref === null || ref === undefined) return { kind: 'none' };
  if (ref === 'provider-default') return { kind: 'provider-default' };

  const envRef = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(ref);
  if (envRef) {
    const value = env[envRef[1]];
    if (!value) throw new CredentialError(`Environment variable ${envRef[1]} is not set`);
    return { kind: 'secret', value, source: ref };
  }

  // LL-03: echo only the scheme, in case someone pasted a secret into the config by mistake
  const scheme = String(ref).includes(':') ? `${String(ref).split(':')[0]}:` : 'that form';
  throw new CredentialError(`Unsupported credential reference (${scheme}). Use provider-default, env:NAME or null`);
}
