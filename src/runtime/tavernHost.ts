export const REQUIRED_TAVERN_HELPER_FUNCTIONS = [
  'getVariables',
  'replaceVariables',
  'updateVariablesWith',
  'insertOrAssignVariables',
  'getCurrentMessageId',
  'getLastMessageId',
] as const;

/** Return the real Tavern Helper host or fail before touching message state. */
export function requireTavernHelperHost(
  requiredFunctions: readonly string[] = REQUIRED_TAVERN_HELPER_FUNCTIONS,
): Record<string, any> {
  const host = globalThis as Record<string, any>;
  const missing = requiredFunctions.filter(name => typeof host[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(`酒馆助手接口缺失: ${missing.join(', ')}`);
  }
  return host;
}
