export interface CustomPresetNarrativeRecoveryRoute {
  model: string;
  url: string;
}

const isEmptyOverride = (value: unknown): boolean => value === undefined || value === '';

/** This alias was verified on the project's custom transport, not inferred
 * from all OpenAI-compatible providers. Existing user body/exclusion policies
 * take precedence: do not parse, merge or replace them for automatic recovery.
 * The returned route lives only in this request; no URL/credential is persisted.
 */
export function getCustomPresetNarrativeRecoveryRoute(settings: unknown): CustomPresetNarrativeRecoveryRoute | undefined {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
  const s = settings as Record<string, unknown>;
  if (s.chat_completion_source !== 'custom' || s.custom_model !== 'deepseek-v4-flash【果汁】'
    || s.show_thoughts !== true || typeof s.custom_url !== 'string' || !s.custom_url.trim()
    || !isEmptyOverride(s.custom_include_body) || !isEmptyOverride(s.custom_exclude_body)) return;
  return { model: s.custom_model, url: s.custom_url };
}

/** A per-request transport policy, never a preset/settings mutation. The
 * factory is self-contained so the exact production matcher can be exercised
 * in the real Helper lab without publishing a fake narrative or game state.
 */
export function createPresetNarrativeRecovery(generationId: string, userInput: string, customRoute?: CustomPresetNarrativeRecoveryRoute) {
  if (!generationId.trim() || generationId.length > 300 || /[\r\n\[\]]/.test(generationId)) {
    throw new Error('剧情恢复请求缺少有效的独立标识');
  }
  const marker = `[MWG_PRESET_FINAL_RECOVERY:${generationId}]`;
  const route = customRoute ? { ...customRoute } : undefined;
  return {
    userInput: `${marker}\n${userInput}`,
    apply(payload: unknown): void {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      const p = payload as Record<string, any>;
      if (!Array.isArray(p.messages)) return;
      if (!p.messages.some((message: any) => message?.role === 'user'
        && typeof message.content === 'string'
        && message.content.split(/\r?\n/).includes(marker))) return;
      if (route) {
        if (p.chat_completion_source !== 'custom' || p.model !== route.model || p.custom_url !== route.url
          || !isEmptyOverride(p.custom_exclude_body)) return;
        const body = JSON.stringify({ thinking: { type: 'disabled' } });
        if (!isEmptyOverride(p.custom_include_body) && p.custom_include_body !== body) return;
        // Custom routes do not translate include_reasoning. This is Tavern's
        // supported request-local body override; all headers/settings stay intact.
        p.custom_include_body = body;
      } else if (p.chat_completion_source === 'deepseek'
        && ['deepseek-v4-flash', 'deepseek-v4-pro'].includes(String(p.model))) {
        p.include_reasoning = false;
      }
    },
  };
}
