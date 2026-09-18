const MVU_MAX_OUTPUT_TOKENS = 20_000;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Keep the card's second-stage MVU request large enough without changing the
 * active model/provider's reasoning behavior.
 *
 * MVU's own `关闭thinking=false` setting means the normal second stage does not
 * suppress reasoning. Do not manufacture `include_reasoning`, `thinking`, or
 * `reasoning_effort` fields here: those names are provider-specific and models
 * that do not support them must remain usable. The monitor still displays any
 * reasoning the selected endpoint actually returns.
 * The controller calls this only after confirming both the active card and
 * MVU's extra-analysis lifecycle flag.
 */
export function applyMvuRequestPolicy(payload: unknown): boolean {
  if (!isRecord(payload)) return false;

  let changed = false;
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
