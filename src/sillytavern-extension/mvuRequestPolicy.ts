const MVU_MAX_OUTPUT_TOKENS = 20_000;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Keep the card's second-stage MVU request short and parseable.
 *
 * MVU's `关闭thinking` option only reaches the request body for some custom
 * response-format paths. When it reuses SillyTavern's active connection in
 * chat-message mode, reasoning-capable providers can still inherit the main
 * story preset's thinking settings and spend the whole response on reasoning.
 * The controller calls this only after confirming both the active card and
 * MVU's extra-analysis lifecycle flag.
 */
export function applyMvuRequestPolicy(payload: unknown): boolean {
  if (!isRecord(payload)) return false;

  let changed = false;
  if (payload.include_reasoning !== false) {
    // SillyTavern derives provider-specific `thinking` from this outer flag.
    // Mutating only a nested/provider body is not enough for DeepSeek and
    // other reasoning-capable chat-completion backends.
    payload.include_reasoning = false;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'thinking')) {
    const thinking = payload.thinking;
    if (!isRecord(thinking) || thinking.type !== 'disabled' || Object.keys(thinking).length !== 1) {
      payload.thinking = { type: 'disabled' };
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'reasoning_effort')) {
    delete payload.reasoning_effort;
    changed = true;
  }

  for (const key of ['max_tokens', 'max_completion_tokens']) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value) && value !== MVU_MAX_OUTPUT_TOKENS) {
      payload[key] = MVU_MAX_OUTPUT_TOKENS;
      changed = true;
    }
  }

  return changed;
}

export { MVU_MAX_OUTPUT_TOKENS };
