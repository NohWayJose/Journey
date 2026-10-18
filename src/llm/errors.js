// Common error types for all model providers (specs/30-design.md#provider-interface).
// Messages never include secret values (LL-03).

export class LlmError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = new.target.name;
    Object.assign(this, details);
  }
}

/** Unknown profile or provider, or a selection the caller isn't allowed to make (LL-01). */
export class ConfigError extends LlmError {}
/** A credential reference that can't be resolved (LL-02). */
export class CredentialError extends LlmError {}
/** The model declined the request (LL-06). */
export class RefusalError extends LlmError {}
/** Output was cut off at the token limit (LL-06). */
export class TruncatedOutputError extends LlmError {}
/** Output wasn't valid JSON (LL-06). */
export class InvalidOutputError extends LlmError {}
/** The prompt doesn't fit the model's context window (LL-07). */
export class ContextTooLongError extends LlmError {}
/** The provider API failed (authentication, rate limit, server error, …). */
export class ProviderError extends LlmError {}
