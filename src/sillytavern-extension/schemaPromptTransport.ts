/** Lossless authoring-contract delivery in ordinary messages. */
export const SCHEMA_PROMPT_MARKER = '[MWG_RESPONSE_SCHEMA/v1]';
export const NODE_SCHEMA_PROMPT_MARKER = '[MWG_NODE_RESPONSE_SCHEMA/v1]';
const REQUEST_MARKER = 'MWG_TOWER_STRUCTURED_REQUEST:';

/** Ordinary-text delivery of the SAME authoring outline, also used by legacy
 * compatibility fallback. The authoritative recursive
 * runtime contract remains in the existing local parser/validator. */
export function createSchemaCompatibilityMessage(schema: unknown): { role: 'user'; content: string } | null {
  if (!isRecord(schema) || typeof schema.name !== 'string' || !isRecord(schema.value)
    || !/^mwg_(?:stat_data_patch|(?:initial_battle|battle_settlement)_repair|rest_card_(?:upgrade|transform)|initial_joint_repair|initial_draft(?:_(?:registry|template|envelope)_repair)?|tower_(?:initial_slot_repair|single_floor_initial_content|(?:node_batch|opening|battle|elite|boss|event|shop|treasure|rest)_result))$/.test(schema.name)) return null;
  // Ordinary messages are not flattened by Tavern's native schema adapter.
  // Share identical nodes for every supported game contract, including batch
  // results and repairs. Existing reference scopes are preserved by the helper.
  const shared = shareSchemaPromptDefinitions(schema.value);
  const originalText = JSON.stringify(schema.value), sharedText = JSON.stringify(shared);
  const useShared = sharedText.length + 160 < originalText.length;
  return { role: 'user', content: '[MWG_SCHEMA_COMPATIBILITY/v1]\n以下 JSON Schema 是以普通文本提供的字段结构参考，不是接口强制输出参数。输出游戏数据而非 Schema；字段、引用和效果仍须通过本地规则校验。\n'
    + (useShared ? '$defs 只定义一次，$ref 引用对应的完整约束，不表示字段可省略；输出实际游戏数据，不输出 $defs 或 $ref。\n' : '')
    + (useShared ? sharedText : originalText) };
}
const MAP_KEYWORDS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const LIST_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_KEYWORDS = new Set([
  'items', 'additionalItems', 'contains', 'additionalProperties', 'unevaluatedProperties',
  'unevaluatedItems', 'propertyNames', 'not', 'if', 'then', 'else', 'contentSchema',
]);

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Use an existing bounded attempt after an empty final response. Move the
 * same schema into text and omit JSON mode. Node schemas use compact JSON:
 * Tavern's indentation can add hundreds of thousands of characters without
 * adding a single constraint. Keep literal whitespace and the entire schema;
 * initial/opening delivery and native-schema providers remain unchanged. */
export function createEmptyJsonModeFallbackMessage(schema: unknown, source: unknown): { role: 'user'; content: string } | null {
  const eligible = source === 'deepseek' && isRecord(schema)
    && typeof schema.name === 'string'
    && (schema.name === 'mwg_initial_draft'
      || /^mwg_tower_(?:node_batch|opening|battle|elite|boss|event|shop|treasure|rest)_result$/.test(schema.name))
    && isRecord(schema.value);
  if (!eligible) return null;
  const compactNode = /^mwg_tower_(?:node_batch|battle|elite|boss|event|shop|treasure|rest)_result$/.test(schema.name);
  return { role: 'user', content: `JSON schema for the response:\n${JSON.stringify(schema.value, null, compactNode ? undefined : 4)}` };
}

/** The inspected Tavern DeepSeek adapter renders json_schema as indented user
 * text, not native schema enforcement. Supply its COMPLETE object as compact
 * text through Helper before the late injector, keeping a small root outline
 * only to enable the same JSON-object mode. No refs, factoring or field removal
 * in the actual contract; native/custom providers and opening flows stay out. */
export function createNodeSchemaPromptTransport(schema: unknown, source: unknown): {
  schema: Record<string, any>;
  message: { role: 'user'; content: string };
} | null {
  if (source !== 'deepseek' || !isRecord(schema) || typeof schema.name !== 'string'
    || !/^mwg_tower_(?:node_batch|battle|elite|boss|event|shop|treasure|rest)_result$/.test(schema.name)
    || !isRecord(schema.value) || schema.value.type !== 'object'
    || !isRecord(schema.value.properties) || !Array.isArray(schema.value.required)) return null;
  const value = schema.value;
  const properties = value.properties;
  const batch = schema.name === 'mwg_tower_node_batch_result';
  const keys = batch ? ['spec', 'batch_id', 'based_on_revision', 'results']
    : ['spec', 'node_id', 'request_id', 'based_on_revision', 'kind', 'title', 'narrative', 'payload', 'reward'];
  const required = batch ? keys : keys.filter(key => key !== 'reward');
  if (Object.keys(properties).sort().join(',') !== [...keys].sort().join(',')
    || !required.every(key => value.required.includes(key))
    || properties.spec?.const !== (batch ? 'mwg.tower-node-batch-result/v1' : 'mwg.tower-node-result/v1')
    || (batch ? properties.results?.type !== 'array' : properties.payload?.type !== 'object')
    || (!batch && schema.name !== `mwg_tower_${properties.kind?.const}_result`)) return null;
  const outline = {
    type: 'object',
    additionalProperties: value.additionalProperties,
    required: structuredClone(value.required),
    properties: Object.fromEntries(Object.entries(properties).map(([key, child]) => {
      const field = child as Record<string, any>;
      return [key, ['object', 'array'].includes(field?.type) ? { type: field.type } : structuredClone(field)];
    })),
    description: `完整且唯一的字段约束见用户消息 ${NODE_SCHEMA_PROMPT_MARKER}；此根摘要只用于启用 JSON 输出模式，不替代完整约束。`,
  };
  const document = JSON.stringify(value);
  const content = [NODE_SCHEMA_PROMPT_MARKER,
    '以下 JSON Schema 是本次回复的完整约束。所有嵌套字段、规则和请求身份必须满足它；只输出游戏结果对象，不输出 Schema。',
    document].join('\n');
  if (content.length + JSON.stringify(outline, null, 4).length + 500 >= JSON.stringify(value, null, 4).length) return null;
  return { schema: { ...structuredClone(schema), value: outline }, message: { role: 'user', content } };
}

// Visit schema positions only. Objects inside const/enum/examples are literal
// instance data, and a properties map is not itself a schema.
function mapChildren(schema: Record<string, any>, visit: (value: unknown) => unknown): Record<string, any> {
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => {
    if (MAP_KEYWORDS.has(key) && isRecord(value)) {
      return [key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, visit(child)]))];
    }
    if (LIST_KEYWORDS.has(key) && Array.isArray(value)) return [key, value.map(visit)];
    if (SCHEMA_KEYWORDS.has(key)) return [key, Array.isArray(value) ? value.map(visit) : visit(value)];
    return [key, structuredClone(value)];
  }));
}

/** Factor repeated object fields without refs (Tavern would expand refs again). */
export function factorSchemaObjectProperties(schema: Record<string, any>): Record<string, any> {
  const visit = (value: unknown): unknown => {
    if (!isRecord(value)) return structuredClone(value);
    const result = mapChildren(value, visit);
    // This transform is used only on reference-free provider outlines. Moving
    // a referenced property would otherwise change local JSON Pointer targets.
    if (!isRecord(result.properties) || result.patternProperties) return result;
    const groups = new Map<string, string[]>();
    for (const [name, child] of Object.entries(result.properties)) {
      const key = JSON.stringify(child);
      if (key.length < 160) continue;
      groups.set(key, [...(groups.get(key) || []), name]);
    }
    for (const [key, names] of groups) {
      if (names.length < 3) continue;
      const escaped = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      // Unlike $, the negative lookahead requires the absolute end of the key,
      // including for malicious keys ending with a newline.
      const pattern = `^(?:${escaped.join('|')})(?![\\s\\S])`;
      result.patternProperties ||= {};
      result.patternProperties[pattern] = JSON.parse(key);
      for (const name of names) delete result.properties[name];
    }
    // Root repairs often repeat an entire card/status schema in allOf and
    // change only a locked ID. Share the identical conjunct, not the ID or
    // the whole property. JSON Schema applies properties and patternProperties
    // together, preserving every per-slot constraint without using refs.
    const conjuncts = new Map<string, Set<string>>();
    for (const [name, child] of Object.entries(result.properties)) {
      if (!isRecord(child) || !Array.isArray(child.allOf)) continue;
      for (const branch of child.allOf) {
        if (!isRecord(branch)) continue;
        const key = JSON.stringify(branch);
        if (key.length < 160) continue;
        const names = conjuncts.get(key) || new Set<string>();
        names.add(name);
        conjuncts.set(key, names);
      }
    }
    for (const [key, nameSet] of conjuncts) {
      const names = [...nameSet];
      if (names.length < 2) continue;
      const escaped = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const pattern = `^(?:${escaped.join('|')})(?![\\s\\S])`;
      result.patternProperties ||= {};
      const previous = result.patternProperties[pattern];
      result.patternProperties[pattern] = previous ? { allOf: [previous, JSON.parse(key)] } : JSON.parse(key);
      for (const name of names) {
        const child = result.properties[name];
        child.allOf = child.allOf.filter((branch: unknown) => JSON.stringify(branch) !== key);
        if (child.allOf.length === 0) delete child.allOf;
      }
    }
    return result;
  };
  let hasUnsafeRelocationScope = false;
  const inspect = (value: unknown): unknown => {
    if (!isRecord(value)) return value;
    // Moving an allOf conjunct changes which annotations a sibling
    // unevaluated* keyword can observe. Skip these schemas entirely, just as
    // with local references whose pointer locations could be relocated.
    if (['$ref', '$dynamicRef', '$id', '$anchor', '$dynamicAnchor', '$defs', 'definitions',
      'unevaluatedProperties', 'unevaluatedItems'].some(key => key in value)) hasUnsafeRelocationScope = true;
    mapChildren(value, inspect);
    return value;
  };
  inspect(schema);
  return hasUnsafeRelocationScope ? structuredClone(schema) : visit(schema) as Record<string, any>;
}

/** Only identical status shapes with distinct locked IDs can share an enum. */
function shareLockedStatusVariants(schema: Record<string, any>): void {
  const items = schema.properties?.support_statuses?.items;
  if (!isRecord(items) || Object.keys(items).length !== 1 || !Array.isArray(items.oneOf)) return;
  const variants = items.oneOf;
  if (!variants.length) return;
  const ids: string[] = [];
  let signature: string | undefined;
  let shared: Record<string, any> | undefined;
  for (const variant of variants) {
    const id = variant?.properties?.id;
    if (variant?.type !== 'object' || !isRecord(id) || typeof id.const !== 'string' || !variant.required?.includes('id')) return;
    const copy = structuredClone(variant);
    delete copy.properties.id.const;
    const key = JSON.stringify(copy);
    if (signature !== undefined && signature !== key) return;
    signature = key;
    shared = copy;
    ids.push(id.const);
  }
  if (!shared || new Set(ids).size !== ids.length) return;
  // Existing enum constraints must be intersected rather than overwritten.
  const allowed = shared.properties.id.enum;
  const enumIds = Array.isArray(allowed) ? ids.filter(id => allowed.includes(id)) : ids;
  if (!enumIds.length) return;
  shared.properties.id.enum = enumIds;
  schema.properties.support_statuses.items = shared;
}

/** Bound the missing-status repair outline only on the inspected text adapter. */
export function applyRepairSchemaFactoring(payload: unknown): SchemaPromptTransportResult | null {
  if (!isRecord(payload) || payload.chat_completion_source !== 'deepseek' || !Array.isArray(payload.messages)) return null;
  if (!payload.messages.some((message: unknown) => isRecord(message) && message.role === 'system'
    && typeof message.content === 'string' && message.content.startsWith(REQUEST_MARKER))) return null;
  const schema = payload.json_schema;
  if (!isRecord(schema) || schema.name !== 'mwg_tower_initial_slot_repair' || !isRecord(schema.value)) return null;
  const originalSchemaCharacters = JSON.stringify(schema.value, null, 4).length;
  if (originalSchemaCharacters < 200_000) return null;
  const factored = factorSchemaObjectProperties(schema.value);
  // A skipped reference scope must also skip ID-variant relocation.
  if (JSON.stringify(factored) === JSON.stringify(schema.value)) return null;
  shareLockedStatusVariants(factored);
  const sharedSchemaCharacters = JSON.stringify(factored, null, 4).length;
  if (sharedSchemaCharacters >= originalSchemaCharacters) return null;
  payload.json_schema = { ...schema, value: factored };
  return { originalSchemaCharacters, sharedSchemaCharacters, definitions: 0 };
}

/**
 * Share byte-identical schema nodes without weakening any constraint. The
 * resulting $refs belong in prompt text, NEVER in Tavern's json_schema field:
 * Tavern eagerly flattens that field before selecting the provider adapter.
 */
export function shareSchemaPromptDefinitions(schema: Record<string, any>): Record<string, any> {
  const counts = new Map<string, number>();
  let alreadyReferenced = false;
  const count = (value: unknown): unknown => {
    if (!isRecord(value)) return value;
    if (['$ref', '$defs', 'definitions', '$id', '$anchor', '$dynamicRef', '$dynamicAnchor',
      '$recursiveRef', '$recursiveAnchor'].some(key => key in value)) {
      alreadyReferenced = true;
    }
    const key = JSON.stringify(value);
    if (key.length >= 160) counts.set(key, (counts.get(key) || 0) + 1);
    mapChildren(value, count);
    return value;
  };
  count(schema);
  // Existing reference scope must never be reinterpreted by relocating a node.
  if (alreadyReferenced) return structuredClone(schema);
  const definitions: Record<string, unknown> = {};
  const names = new Map<string, string>();
  const share = (value: unknown): unknown => {
    if (!isRecord(value)) return structuredClone(value);
    const key = JSON.stringify(value);
    if ((counts.get(key) || 0) > 1) {
      let name = names.get(key);
      if (!name) {
        name = `S${names.size}`;
        names.set(key, name);
        definitions[name] = mapChildren(value, share);
      }
      return { $ref: `#/$defs/${name}` };
    }
    return mapChildren(value, share);
  };
  const result = mapChildren(schema, share);
  if (names.size) result.$defs = definitions;
  return result;
}

export interface SchemaPromptTransportResult {
  originalSchemaCharacters: number;
  sharedSchemaCharacters: number;
  definitions: number;
}

/** Prepare the compact registry contract BEFORE Helper's late schema injector.
 * DeepSeek only supports JSON-object mode here, not native schema enforcement.
 * Keep the entire schema as shared prompt text and use a reference-free root
 * outline solely to enable that same mode. Native/custom providers stay intact.
 */
export function createInitialDraftSchemaPromptTransport(schema: unknown, source: unknown): {
  schema: { name: string; value: Record<string, any>; [key: string]: any };
  /** Same complete constraints with shared definitions; suitable for tools. */
  completeSchema: Record<string, any>;
  message: { role: 'system'; content: string };
  measurement: SchemaPromptTransportResult;
} | null {
  if (source !== 'deepseek' || !isRecord(schema) || schema.name !== 'mwg_initial_draft'
    || !isRecord(schema.value) || schema.value.type !== 'object'
    || !isRecord(schema.value.properties) || !Array.isArray(schema.value.required)) return null;
  const properties = schema.value.properties;
  // Only the current separate-narrative registry protocol. An unrelated shape
  // reusing the name must not accidentally acquire a smaller provider schema.
  if (Object.keys(properties).sort().join(',') !== 'opening,player,registry,spec'
    || !['player', 'opening', 'registry'].every(key => properties[key]?.type === 'object')
    || properties.spec?.const !== 'mwg.initial-draft/v1') return null;
  const shared = shareSchemaPromptDefinitions(schema.value);
  const document = JSON.stringify(shared);
  const originalLength = JSON.stringify(schema.value, null, 4).length;
  const definitions = Object.keys(shared.$defs || {}).length;
  if (!definitions || document === JSON.stringify(schema.value) || document.length + 1000 >= originalLength) return null;
  const content = [
    SCHEMA_PROMPT_MARKER,
    '以下是本次回复的完整结构约束。$defs 定义只写一次，$ref 使用对应定义；引用不表示可以省略字段。',
    '只输出符合根结构的游戏数据，不输出 Schema、$defs 或 $ref。玩法和引用闭包仍遵守前面的完整契约。',
    document,
  ].join('\n');
  return {
    completeSchema: shared,
    schema: { ...schema, name: schema.name, value: {
      ...structuredClone(schema.value),
      properties: {
        spec: structuredClone(properties.spec),
        player: { type: 'object' }, opening: { type: 'object' }, registry: { type: 'object' },
      },
      description: `完整字段约束见系统消息 ${SCHEMA_PROMPT_MARKER}；本对象仅用于启用 JSON 输出模式。`,
    } },
    message: { role: 'system', content },
    measurement: { originalSchemaCharacters: originalLength, sharedSchemaCharacters: document.length, definitions },
  };
}

/**
 * Called at CHAT_COMPLETION_SETTINGS_READY, where the actual provider is known.
 * Ordinary preset/story requests, MVU UpdateVariable requests, other characters
 * and native schema providers retain their existing transport.
 */
export function applySchemaPromptTransport(payload: unknown): SchemaPromptTransportResult | null {
  if (!isRecord(payload) || payload.chat_completion_source !== 'deepseek' || !Array.isArray(payload.messages)) return null;
  if (!payload.messages.some((message: unknown) => (
    isRecord(message) && message.role === 'system'
    && typeof message.content === 'string' && message.content.startsWith(REQUEST_MARKER)
  ))) return null;
  const schema = payload.json_schema;
  if (!isRecord(schema) || schema.name !== 'mwg_tower_single_floor_initial_content' || !isRecord(schema.value)) return null;
  if (payload.messages.some((message: unknown) => (
    isRecord(message) && message.role === 'system' && typeof message.content === 'string'
    && message.content.startsWith(SCHEMA_PROMPT_MARKER)
  ))) return null;
  const shared = shareSchemaPromptDefinitions(schema.value);
  const document = JSON.stringify(shared);
  const originalLength = JSON.stringify(schema.value, null, 4).length;
  if (document.length + 500 >= originalLength) return null;
  const instructions = [
    SCHEMA_PROMPT_MARKER,
    '以下是本次回复的完整结构约束。$defs 定义只写一次，$ref 使用对应定义；引用不表示可以省略字段。',
    '只输出符合根结构的游戏数据，不输出 Schema、$defs 或 $ref。玩法和引用闭包仍遵守前面的完整契约。',
    document,
  ].join('\n');
  // Compute everything before changing the live request. Preserve all existing
  // messages and all sampling, thinking, token and streaming settings verbatim.
  payload.messages.push({ role: 'system', content: instructions });
  payload.json_schema = {
    ...schema,
    value: {
      type: 'object',
      required: ['narrative', 'player', 'opening'],
      additionalProperties: false,
      properties: {
        narrative: { type: 'string', minLength: 1 },
        player: { type: 'object' },
        opening: { type: 'object' },
      },
      description: `完整字段约束见系统消息 ${SCHEMA_PROMPT_MARKER}；本对象仅用于启用 JSON 输出模式。`,
    },
  };
  return {
    originalSchemaCharacters: originalLength,
    sharedSchemaCharacters: document.length,
    definitions: Object.keys(shared.$defs || {}).length,
  };
}
