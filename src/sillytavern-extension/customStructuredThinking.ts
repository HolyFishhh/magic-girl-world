import { getCustomPresetNarrativeRecoveryRoute } from './presetNarrativeRecovery';

const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const empty = (v: unknown) => v === undefined || v === '';
/** Candidate authoring policy, not an assurance of valid/complete output. */
export const CUSTOM_MECHANISM_TEMPERATURE = 0.2;
const gameSchema = /^(?:mwg_initial_joint_repair|mwg_initial_draft(?:_(?:registry|template)_repair)?|mwg_tower_(?:initial_slot_repair|single_floor_initial_content)|mwg_tower_(?:node_batch|opening|battle|elite|boss|event|shop|treasure|rest)_result)$/;

/** Data-only game authoring on the exact custom route already verified by the
 * request-local preset recovery probe. This does not disable preset thinking,
 * read auxiliary prose, change providers, strip schema, or grant another call.
 * The same guarded data request uses a lower temperature than story writing;
 * preset/global sampling and user body overrides remain untouched.
 * Both initial and later node authoring use the same delivery mode, rather
 * than consuming the existing fallback on the same reasoning-only response.
 */
export function createCustomStructuredThinkingPolicy(settings: unknown, config: {
  generation_id: string; json_schema?: unknown; custom_api?: unknown; tools?: unknown;
}) {
  if (config.custom_api || Object.hasOwn(config, 'tools') || !isRecord(config.json_schema)
    || !gameSchema.test(String(config.json_schema.name))) return;
  const route = getCustomPresetNarrativeRecoveryRoute(settings);
  if (!route || !config.generation_id.trim() || config.generation_id.length > 300 || /[\r\n]/.test(config.generation_id)) return;
  const marker = `MWG_TOWER_STRUCTURED_REQUEST:${config.generation_id}`;
  const body = JSON.stringify({ thinking: { type: 'disabled' } });
  return {
    isCurrent(settings: unknown): boolean {
      const current = getCustomPresetNarrativeRecoveryRoute(settings);
      return current?.model === route.model && current.url === route.url;
    },
    apply(payload: unknown): void {
      if (!isRecord(payload) || payload.chat_completion_source !== 'custom' || payload.model !== route.model
        || payload.custom_url !== route.url || Object.hasOwn(payload, 'tools')
        || !empty(payload.custom_exclude_body)
        || (!empty(payload.custom_include_body) && payload.custom_include_body !== body)
        || !Array.isArray(payload.messages)) return;
      const markers = payload.messages.filter((m: unknown) => isRecord(m) && m.role === 'system'
        && typeof m.content === 'string' && m.content.startsWith('MWG_TOWER_STRUCTURED_REQUEST:'));
      if (markers.length !== 1 || markers[0].content !== marker) return;
      payload.custom_include_body = body;
      payload.temperature = CUSTOM_MECHANISM_TEMPERATURE;
    },
  };
}
