// Anthropic provider (default, D-024). Rules LL-04 to LL-06.

import Anthropic from '@anthropic-ai/sdk';
import { InvalidOutputError, ProviderError, RefusalError, TruncatedOutputError } from '../errors.js';

export const CAPABILITIES = { structuredOutput: 'native', contextWindow: 1_000_000, maxOutputTokens: 64_000 };
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function mapError(error) {
  if (error instanceof Anthropic.APIError) {
    const retryable = error.status === 429 || error.status >= 500 || error.status === undefined;
    return new ProviderError(`Anthropic API error${error.status ? ` ${error.status}` : ''}: ${error.message}`, { status: error.status, retryable });
  }
  return error;
}

/**
 * @param {{ model: string, effort?: string }} profile
 * @param {{ kind: string, value?: string }} credential
 * @param {{ client?: object }} [options] client is injectable for tests
 */
export function createAnthropicProvider(profile, credential, { client } = {}) {
  // provider-default: let the SDK resolve ANTHROPIC_API_KEY, an `ant auth login` profile or workload identity
  const anthropic = client ?? new Anthropic(credential.kind === 'secret' ? { apiKey: credential.value } : {});
  const { model, effort = 'high' } = profile;

  return {
    provider: 'anthropic',
    model,
    capabilities: CAPABILITIES,

    async countTokens({ system, prompt }) {
      try {
        const result = await anthropic.messages.countTokens({ model, system, messages: [{ role: 'user', content: prompt }] });
        return result.input_tokens;
      } catch (error) {
        throw mapError(error);
      }
    },

    async generate({ system, prompt, schema, maxOutputTokens = CAPABILITIES.maxOutputTokens }) {
      let message;
      try {
        // LL-04: streamed (long outputs would otherwise hit HTTP timeouts), with server-side refusal fallbacks
        const stream = anthropic.beta.messages.stream({
          model,
          max_tokens: maxOutputTokens,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort, format: { type: 'json_schema', schema } },
          system,
          messages: [{ role: 'user', content: prompt }],
        });
        message = await stream.finalMessage();
      } catch (error) {
        throw mapError(error);
      }

      // LL-06: check the stop reason before reading content
      if (message.stop_reason === 'refusal') {
        const details = message.stop_details ?? {};
        throw new RefusalError(`The model declined the request${details.category ? ` (${details.category})` : ''}`, {
          category: details.category ?? null, explanation: details.explanation ?? null,
        });
      }
      if (message.stop_reason === 'max_tokens') {
        throw new TruncatedOutputError(`Output was cut off at ${maxOutputTokens} tokens`);
      }

      const text = message.content.filter((b) => b.type === 'text').at(-1)?.text;
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new InvalidOutputError('The model did not return valid JSON');
      }

      // LL-05: report the model that actually served the request (it can differ after a fallback)
      return {
        json,
        usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
        stopReason: message.stop_reason,
        provider: 'anthropic',
        model: message.model,
      };
    },
  };
}
