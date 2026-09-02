const MVU_MAX_OUTPUT_TOKENS = 20_000;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Keep the card's second-stage MVU request observable and large enough.
 *
 * MVU's `关闭thinking` option only reaches the request body for some custom
 * response-format paths. When it reuses SillyTavern's active connection in
 * chat-message mode, reasoning-capable providers can still inherit the main
 * story preset's thinking settings.  The card monitor now deliberately shows
 * provider-returned reasoning, so preserve that channel instead of silently
 * disabling it.  Hidden provider reasoning that never reaches SillyTavern is
 * still unavailable by definition.
 * The controller calls this only after confirming both the active card and
 * MVU's extra-analysis lifecycle flag.
 */
export function applyMvuRequestPolicy(payload: unknown): boolean {
  if (!isRecord(payload)) return false;

  let changed = false;
  if (payload.include_reasoning !== true) {
    payload.include_reasoning = true;
    changed = true;
  }
  if (isRecord(payload.thinking) && payload.thinking.type === 'disabled') {
    delete payload.thinking;
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
