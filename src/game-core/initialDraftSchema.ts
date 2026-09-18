import { INITIAL_DRAFT_SPEC } from './initialDraft';
import { INITIAL_CARD_REFERENCE_SCHEMA } from './initialCardReference';
import { INITIAL_DRAFT_AUTHOR_REQUIRED_ROOTS } from './initialDraftEnvelope';
import { createTowerInitialContentJsonSchema, type TowerJsonSchema } from './towerRequest';

/** Reuse the authoritative effects grammar; change definition placement only. */
export function createInitialDraftJsonSchema(options: { includeNarrative?: boolean } = {}): TowerJsonSchema {
  const source = createTowerInitialContentJsonSchema();
  const value = structuredClone(source.value) as Record<string, any>;
  // These are schema positions only, never literal instance values.
  const removeInlineTemplates = (schema: any): void => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
    if (schema.properties) delete schema.properties.creates;
    for (const key of ['properties', '$defs', 'patternProperties', 'dependentSchemas']) {
      if (schema[key] && typeof schema[key] === 'object') Object.values(schema[key]).forEach(removeInlineTemplates);
    }
    for (const key of ['oneOf', 'anyOf', 'allOf', 'prefixItems']) {
      if (Array.isArray(schema[key])) schema[key].forEach(removeInlineTemplates);
    }
    for (const key of ['items', 'if', 'then', 'else', 'not', 'contains', 'additionalProperties']) removeInlineTemplates(schema[key]);
  };
  removeInlineTemplates(value);
  for (const name of ['mwgRewardCard', 'mwgRewardArtifact', 'mwgRewardItem']) {
    delete value.$defs[name].properties.status;
    delete value.$defs[name].properties.statuses;
  }
  value.$defs.mwgRewardCard = { anyOf: [value.$defs.mwgRewardCard, structuredClone(INITIAL_CARD_REFERENCE_SCHEMA)] };
  delete value.properties.player.properties.statuses;
  delete value.properties.player.properties.core.properties.resources;
  // Descriptions are model-visible too: do not retain instructions to author
  // containers that this draft schema deliberately removes.
  value.properties.player.properties.player_abilities.description =
    value.properties.player.properties.player_abilities.description.replace('能力 creates 中的临时牌', 'registry.templates 中的临时牌');
  value.properties.player.properties.player_lust_effect.description =
    value.properties.player.properties.player_lust_effect.description.replace('同级 player.statuses', 'registry.statuses');
  value.properties.spec = { const: INITIAL_DRAFT_SPEC };
  value.properties.registry = {
    type: 'object', additionalProperties: false, required: ['statuses', 'resources', 'templates'],
    properties: {
      statuses: { type: 'array', maxItems: 128, items: { $ref: '#/$defs/mwgStatusDefinition' } },
      resources: { type: 'array', maxItems: 16, items: { $ref: '#/$defs/mwgCombatResource' } },
      templates: { type: 'array', maxItems: 128, items: { $ref: '#/$defs/cardTemplate' } },
    },
  };
  value.required = [...value.required, 'spec', 'registry'];
  if (options.includeNarrative === false) {
    delete value.properties.narrative;
    // This request route fixes v1. Its receiver supplies the constant only when
    // omitted; a supplied version still must match the const below. Standalone
    // draft/compiler schemas retain their required version for external inputs.
    value.required = value.required.filter((key: string) => key !== 'narrative' && key !== 'spec');
    for (const key of INITIAL_DRAFT_AUTHOR_REQUIRED_ROOTS) if (!value.required.includes(key)) value.required.push(key);
    // Model-facing order follows dependencies. This changes neither the set of
    // accepted fields nor JSON object semantics; the compiler stays order-free.
    value.properties = Object.fromEntries([
      ...INITIAL_DRAFT_AUTHOR_REQUIRED_ROOTS.map(key => [key, value.properties[key]]),
      ...Object.entries(value.properties).filter(([key]) => !INITIAL_DRAFT_AUTHOR_REQUIRED_ROOTS.some(root => root === key)),
    ]);
    value.required = [...INITIAL_DRAFT_AUTHOR_REQUIRED_ROOTS];
  }
  return { ...source, name: 'mwg_initial_draft', description: '魔法少女世界精简内容草稿：统一定义与引用', value };
}
