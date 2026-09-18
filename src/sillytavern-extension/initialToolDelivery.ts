export const INITIAL_DRAFT_TOOL_NAME = 'submit_initial_draft';
const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Receive data only. Never execute a model-supplied tool or use its reasoning.
 * Existing draft compilation, gameplay validation and commit guards still run.
 */
export function readInitialDraftToolResult(value: unknown): string {
  // Auto tool choice can legitimately choose ordinary final JSON instead.
  // Preserve that text for the same authoritative parser; do not call again.
  if (typeof value === 'string' && value.trim() && value.length <= 1_000_000) return value;
  if (!isRecord(value) || !Array.isArray(value.tool_calls) || value.tool_calls.length !== 1) {
    throw new Error('机制请求未返回唯一的草稿工具参数，已停止写入');
  }
  const call = value.tool_calls[0];
  if (!isRecord(call) || call.type !== 'function' || !isRecord(call.function)
    || call.function.name !== INITIAL_DRAFT_TOOL_NAME) {
    throw new Error('机制请求返回了未授权的工具名称，已停止写入');
  }
  const args = call.function.arguments;
  if (typeof args !== 'string' || !args.trim() || args.length > 1_000_000) {
    throw new Error('草稿工具参数为空或过大，已停止写入');
  }
  // This boundary validates the envelope, not the draft. The controller records
  // these exact final-data bytes BEFORE its authoritative syntax/compiler gates.
  // Parsing here would swallow unparseable arguments before diagnostics, or
  // conceal truncation if a repaired object were returned instead. Do not retry,
  // execute tools, or copy the provider's reasoning from the enclosing response.
  return args;
}
