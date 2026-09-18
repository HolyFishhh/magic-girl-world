const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const SPECS: Record<string, string | null> = {
  mwg_initial_draft: 'mwg.initial-draft/v1',
  mwg_initial_draft_registry_repair: 'mwg.initial-draft-registry-repair/v1',
  mwg_tower_initial_slot_repair: 'mwg.tower-initial-slot-repair/v1',
  mwg_tower_single_floor_initial_content: null,
  mwg_tower_opening_result: 'mwg.tower-opening-result/v1',
  mwg_tower_node_batch_result: 'mwg.tower-node-batch-result/v1',
  ...Object.fromEntries(['battle', 'elite', 'boss', 'event', 'shop', 'treasure', 'rest']
    .map(kind => [`mwg_tower_${kind}_result`, 'mwg.tower-node-result/v1'])),
};

/** A data-delivery adapter, not a reasoning extractor or gameplay validator.
 * Some custom endpoints put their entire JSON result in reasoning_content.
 * Require the WHOLE field to be one known result envelope; no fences, slicing,
 * JSON repair, prose, partial results or selecting among multiple choices.
 * The original controller still owns all decoding, scope, registry, semantic
 * validation and atomic publication, including its existing repair budget. */
export function createStructuredAuxiliaryDecoder(schema: unknown): ((body: unknown) => string | undefined) | undefined {
  if (!isRecord(schema) || !Object.hasOwn(SPECS, schema.name) || !isRecord(schema.value)
    || schema.value.type !== 'object' || !isRecord(schema.value.properties)
    || !Array.isArray(schema.value.required)) return;
  const name = schema.name as string;
  const properties = schema.value.properties;
  if (SPECS[name] !== null && properties.spec?.const !== SPECS[name]) return;
  const allowed = new Set(Object.keys(properties));
  const required = [...schema.value.required];
  if (!required.length || required.some(key => typeof key !== 'string' || !allowed.has(key))) return;
  const constants = Object.entries(properties).filter(([, value]) => isRecord(value) && Object.hasOwn(value, 'const'))
    .map(([key, value]) => [key, structuredClone((value as Record<string, unknown>).const)] as const);
  const batch = name === 'mwg_tower_node_batch_result';
  let members: Array<Record<string, unknown>> = [];
  if (batch) {
    const variants = properties.results?.items?.oneOf;
    if (!Array.isArray(variants) || variants.length < 1 || variants.length > 3) return;
    const keys = ['spec', 'node_id', 'request_id', 'based_on_revision', 'kind'];
    if (variants.some(variant => keys.some(key => !isRecord(variant?.properties?.[key])
      || !Object.hasOwn(variant.properties[key], 'const')))) return;
    members = variants.map(variant => Object.fromEntries(keys.map(key => [key, variant.properties[key].const])));
    if (new Set(members.map(member => member.node_id)).size !== members.length
      || new Set(members.map(member => member.request_id)).size !== members.length) return;
  }
  return body => {
    if (!isRecord(body) || Object.hasOwn(body, 'error') || !Array.isArray(body.choices) || body.choices.length !== 1) return;
    const choice = body.choices[0];
    if (!isRecord(choice) || choice.finish_reason !== 'stop' || (choice.index !== undefined && choice.index !== 0)
      || !isRecord(choice.message)) return;
    const message = choice.message;
    if (message.role !== 'assistant' || typeof message.content !== 'string' || message.content.trim()
      || Object.hasOwn(message, 'tool_calls') || Object.hasOwn(message, 'function_call')
      || message.refusal != null && message.refusal !== '' || typeof message.reasoning_content !== 'string') return;
    const text = message.reasoning_content;
    if (!text.trim().startsWith('{') || text.length > 1_000_000) return;
    let result: unknown;
    try { result = JSON.parse(text); } catch { return; }
    if (!isRecord(result) || Object.keys(result).some(key => !allowed.has(key))
      || required.some(key => !Object.hasOwn(result, key))
      || constants.some(([key, value]) => Object.hasOwn(result, key) && result[key] !== value)) return;
    if (batch) {
      if (!Array.isArray(result.results) || result.results.length !== members.length) return;
      const rows = result.results;
      if (rows.some(row => !isRecord(row)) || new Set(rows.map(row => row.node_id)).size !== rows.length
        || members.some(member => !rows.some(row => Object.entries(member).every(([key, value]) => row[key] === value)))) return;
    }
    return text; // Preserve every authored byte. No mutation/defaults/normalization.
  };
}
