import { INTERCEPTION_SCHEMA } from './interception';
import { STATUS_DEFENSE_SCHEMA } from './statusDefense';
import { CHARACTER_EMOJI_SCHEMA } from './characterAppearance';
import compactEffectSchema from '../../schemas/mwg-card-effects-v1.schema.json';
import {
  ABILITY_TRIGGERS,
  EVENT_FILTERABLE_TRIGGER_SET,
  REGISTERABLE_EFFECT_TRIGGERS,
  STATUS_EVENT_TRIGGERS,
} from './battleTriggers';
import { CARD_RARITY_SET, CARD_TYPE_SET, RELIC_RARITY_SET } from './contentCatalog';
import { triggerEventSchemaConstraints } from './triggerEventContract';
import { BATTLE_ITEM_USAGE_RULE } from './battleItemUsage';

export type AiJsonSchema = Record<string, any>;

const ID_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*$';
const CONTENT_ID_PATTERN = '^[A-Za-z_][A-Za-z0-9_-]*$';
const EFFECT_DEFINITIONS = (compactEffectSchema as unknown as { $defs: AiJsonSchema }).$defs;
const NON_PASSIVE_ABILITY_TRIGGERS = ABILITY_TRIGGERS.filter(trigger => trigger !== 'passive');
const FILTERABLE_ABILITY_TRIGGERS = NON_PASSIVE_ABILITY_TRIGGERS.filter(trigger =>
  EVENT_FILTERABLE_TRIGGER_SET.has(trigger));
const UNFILTERED_ABILITY_TRIGGERS = NON_PASSIVE_ABILITY_TRIGGERS.filter(trigger =>
  !EVENT_FILTERABLE_TRIGGER_SET.has(trigger));
const FILTERABLE_CARD_TRIGGERS = REGISTERABLE_EFFECT_TRIGGERS.filter(trigger =>
  EVENT_FILTERABLE_TRIGGER_SET.has(trigger));
const UNFILTERED_CARD_TRIGGERS = REGISTERABLE_EFFECT_TRIGGERS.filter(trigger =>
  !EVENT_FILTERABLE_TRIGGER_SET.has(trigger));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Non-recursive card-rule field relationships for the bounded provider
 * outline. Derive them from the public contract instead of maintaining a
 * second rule/field table. Boolean property schemas preserve the meaning of
 * single-field prohibitions without repeating long `not/required` clauses at
 * every status/reward location. Formula validation remains in the compiler. */
export function createCardRuleFieldOutline(): AiJsonSchema {
  const source = EFFECT_DEFINITIONS.cardPlayRuleEffect;
  const compact = (value: any): any => {
    if (Array.isArray(value)) return value.map(compact);
    if (!value || typeof value !== 'object') return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, compact(entry)])) as AiJsonSchema;
    const forbidden = result.not?.anyOf ?? (result.not?.required ? [result.not] : []);
    if (Object.keys(result.not || {}).length === 1 && forbidden.length && forbidden.every((entry: any) =>
      Object.keys(entry).length === 1 && Array.isArray(entry.required) && entry.required.length === 1)) {
      result.properties = { ...(result.properties || {}),
        ...Object.fromEntries(forbidden.map((entry: any) => [entry.required[0], false])) };
      delete result.not;
    }
    return result;
  };
  const relationships = compact({ oneOf: source.oneOf, allOf: source.allOf });
  // The enclosing `if` already proves this field exists for every branch.
  for (const branch of relationships.oneOf) {
    if (branch.required) branch.required = branch.required.filter((key: string) => key !== 'card_rule');
    if (branch.required?.length === 0) delete branch.required;
  }
  return {
    properties: clone(source.properties),
    constraint: {
      if: { required: ['card_rule'] },
      then: relationships,
    },
  };
}

function ref(name: string): AiJsonSchema {
  return { $ref: `#/$defs/${name}` };
}

/** A guard changes evaluation timing, never its children's authoring context. */
function guardChildrenConstraint(effectType: string): AiJsonSchema {
  return {
    if: { required: ['guard'] },
    then: { properties: { effects: { type: 'array', minItems: 1, maxItems: 256, items: ref(effectType) } } },
  };
}

function triggerFilterProperties(): AiJsonSchema {
  return {
    scope: { enum: ['turn', 'combat', 'run', 'card_instance', 'team'] },
    ordinal: { enum: ['first', 'first_n', 'nth', 'every_n'] },
    n: { type: 'integer', minimum: 1 },
    event: ref('battleEventKind'),
    phase: ref('battleEventPhase'),
    reason: { type: 'string', minLength: 1 },
    source_kind: ref('eventSourceKind'),
    source_id: { type: 'string', minLength: 1 },
    damage_type: ref('damageKind'),
    card_type: { type: 'string', minLength: 1 },
    template_id: { type: 'string', minLength: 1 },
    card_instance_id: { type: 'string', minLength: 1 },
    actor_id: { type: 'string', minLength: 1 },
    target_id: { type: 'string', minLength: 1 },
  };
}

function structuredTrigger(
  on: AiJsonSchema,
  effects: AiJsonSchema,
  includeFilters: boolean,
): AiJsonSchema {
  const schema: AiJsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['on', 'effects'],
    properties: {
      on,
      effects,
      ...(includeFilters ? triggerFilterProperties() : {}),
    },
  };
  if (includeFilters) {
    schema.allOf = [
      {
        if: { properties: { ordinal: { const: 'first' } }, required: ['ordinal'] },
        then: { not: { required: ['n'] } },
      },
      {
        if: { properties: { ordinal: { enum: ['first_n', 'nth', 'every_n'] } }, required: ['ordinal'] },
        then: { required: ['n'] },
      },
      {
        if: { required: ['n'] },
        then: { required: ['ordinal'], properties: { ordinal: { enum: ['first_n', 'nth', 'every_n'] } } },
      },
      ...triggerEventSchemaConstraints(),
    ];
  }
  return schema;
}

function collectionTargetConstraint(target: 'self' | 'opponent'): AiJsonSchema {
  return {
    if: { required: ['targets'] },
    then: {
      allOf: [
        { if: { properties: { targets: { properties: { team: { const: 'self' } }, required: ['team'] } } }, then: { properties: { to: { const: 'self' } } } },
        { if: { properties: { targets: { properties: { team: { const: 'opponent' } }, required: ['team'] } } }, then: { properties: { to: { const: 'opponent' } } } },
        { if: { properties: { targets: { not: { required: ['team'] } } } }, then: { properties: { to: { const: target } } } },
        { if: { properties: { targets: { properties: { team: { const: 'enemies' } }, required: ['team'] } } }, then: { properties: { to: { const: target } } } },
      ],
    },
  };
}

function generatedCardProperties(): AiJsonSchema {
  const template = EFFECT_DEFINITIONS.cardTemplate as AiJsonSchema;
  return clone(template.properties || {});
}

function publicCardTemplateSchema(): AiJsonSchema {
  const template = clone(EFFECT_DEFINITIONS.cardTemplate as AiJsonSchema);
  return {
    ...template,
    properties: {
      ...(template.properties || {}),
      dialogue: { type: 'string', minLength: 1, description: '可选台词；卡牌结算时展示，不改变规则。' },
      // The effect policy depends on the card type and on whether a Power owns
      // a trigger. Leave the root unconstrained here and apply the exact
      // context rules below instead of exposing the catch-all portable list.
      effects: {},
      discard_effects: ref('effectList'),
      // New AI output has one trigger spelling. The runtime resolver still
      // accepts the sibling string form when loading older cards.
      trigger: ref('mwgCardTrigger'),
    },
    allOf: [
      ...(template.allOf || []),
      {
        if: { properties: { type: { const: 'Event' } }, required: ['type'] },
        then: {
          required: ['effects'],
          properties: { effects: ref('mwgEventEffectList') },
          not: { required: ['trigger'] },
        },
      },
      {
        if: { properties: { type: { const: 'Power' } }, required: ['type'] },
        then: {
          if: { required: ['trigger'] },
          then: { properties: { effects: ref('mwgPowerImmediateEffectList') } },
          else: {
            required: ['effects'],
            properties: { effects: ref('mwgPowerStatusEffectList') },
          },
        },
        else: {
          allOf: [
            { not: { required: ['trigger'] } },
            {
              if: { properties: { type: { not: { const: 'Event' } } } },
              then: { properties: { effects: ref('mwgCardEffectList') } },
            },
          ],
        },
      },
    ],
  };
}

function publicSpawnSummonEffectSchema(): AiJsonSchema {
  const schema = clone(EFFECT_DEFINITIONS.spawnSummonEffect as AiJsonSchema);
  const definition = schema.properties?.spawn_summon;
  if (!definition?.properties) return schema;
  // The runtime still loads the legacy singular `action` effect list, but it
  // is intentionally not an AI-facing spelling. Models repeatedly mistook it
  // for a named action object ({id,name,effects}), whereas `actions` already
  // expresses both one and many actions without that ambiguity.
  delete definition.properties.action;
  definition.properties.on_existing_effects = ref('mwgSummonEffectList');
  if (definition.properties.actions?.items?.properties) {
    definition.properties.actions.items.properties.effects = ref('mwgSummonEffectList');
    definition.properties.actions.items.properties.dialogue = { type: 'string', minLength: 1 };
  }
  if (definition.properties.abilities?.items?.properties) {
    definition.properties.abilities.items.properties.trigger = ref('mwgSummonAbilityTrigger');
  }
  return schema;
}

function publicSpawnEnemyEffectSchema(): AiJsonSchema {
  const schema = clone(EFFECT_DEFINITIONS.spawnEnemyEffect as AiJsonSchema);
  const definition = schema.properties?.spawn_enemy;
  if (!definition?.properties) return schema;
  definition.required = [
    'id', 'name', 'emoji', 'max_hp', 'hp', 'max_lust', 'lust', 'actions',
  ];
  definition.properties.max_lust = { type: 'number', exclusiveMinimum: 0 };
  definition.properties.escape_when = ref('formulaString');
  definition.properties.stance = { anyOf: [ref('mwgInitialStance'), { type: 'null' }] };
  definition.properties.orbs = { type: 'array', maxItems: 20, items: ref('mwgInitialOrb') };
  if (definition.properties.actions?.items?.properties) {
    definition.properties.actions.items.properties.effects = ref('mwgEnemyEffectList');
    definition.properties.actions.items.properties.dialogue = { type: 'string', minLength: 1 };
  }
  if (definition.properties.abilities?.items?.properties) {
    definition.properties.abilities.items.properties.trigger = ref('mwgEnemyAbilityTrigger');
  }
  if (definition.properties.lust_effect?.properties) {
    definition.properties.lust_effect.properties.effects = ref('mwgEnemyEffectList');
  }
  return schema;
}

function publicCardDefinitionSchema(includeSupportStatus = false): AiJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'type', 'rarity', 'quantity'],
    anyOf: [
      { required: ['effects'] },
      { required: ['trigger'] },
      { properties: { type: { const: 'Curse' } }, required: ['type'] },
    ],
    properties: {
      ...generatedCardProperties(),
      id: { type: 'string', pattern: CONTENT_ID_PATTERN },
      type: { enum: Array.from(CARD_TYPE_SET) },
      rarity: { enum: Array.from(CARD_RARITY_SET) },
      quantity: { type: 'integer', minimum: 1, maximum: 100 },
      creates: { type: 'array', maxItems: 32, items: ref('cardTemplate') },
      trigger: ref('mwgCardTrigger'),
      innate: { type: 'boolean', description: '固有：开战进入起手手牌，允许超过常规起手数量但不超过手牌上限；溢出留在抽牌堆顶。适用于需要先铺设的引擎、形态与关键支援牌。' },
      sly: { type: 'boolean', description: '灵巧：回合结束清理前从手牌被主动或效果弃置时，免费打出并完整结算；回合末自动弃牌不触发。' },
      unique: { type: 'boolean', description: 'unique:true 的卡牌 quantity=1，不能有额外副本；非唯一卡可写 unique:false 并用同一 ID、名称、完整规则与 quantity 表达完全相同的多份持有卡，每份独立结算。若只差小幅数值或换名且没有玩法差异，也优先复用已有卡，不强造新卡；已合法但不同的内容不会自动合并，确有玩法差异才使用新 ID。' },
      tags: {
        type: 'array',
        maxItems: 32,
        uniqueItems: true,
        items: { type: 'string', pattern: ID_PATTERN },
      },
      effects: {},
      discard_effects: ref('effectList'),
      ...(includeSupportStatus
        ? {
            status: ref('mwgStatusDefinition'),
            statuses: {
              type: 'array',
              description: '仅当本候选 effects/trigger/discard_effects 引用当前未登记的新状态时填写；必须完整闭合引用链，没有新状态时整个省略。',
              minItems: 1,
              maxItems: 16,
              items: ref('mwgStatusDefinition'),
            },
          }
        : {}),
    },
    allOf: [
      {
        if: { properties: { type: { const: 'Curse' } }, required: ['type'] },
        then: { not: { required: ['cost'] } },
        else: { required: ['cost'] },
      },
      {
        if: { required: ['trigger'] },
        then: { properties: { type: { const: 'Power' } } },
      },
      {
        if: { properties: { type: { const: 'Event' } }, required: ['type'] },
        then: {
          required: ['effects'],
          properties: { effects: ref('mwgEventEffectList') },
          not: { required: ['trigger'] },
        },
      },
      {
        if: { properties: { type: { const: 'Power' } }, required: ['type'] },
        then: {
          if: { required: ['trigger'] },
          then: { properties: { effects: ref('mwgPowerImmediateEffectList') } },
          else: {
            required: ['effects'],
            properties: { effects: ref('mwgPowerStatusEffectList') },
          },
        },
        else: {
          if: { properties: { type: { not: { const: 'Event' } } } },
          then: { properties: { effects: ref('mwgCardEffectList') } },
        },
      },
    ],
  };
}

/**
 * A bounded, pre-authored settlement used only when an artifact is acquired.
 * It deliberately has no artifact grant branch: acquiring an artifact must not
 * recursively acquire and execute another artifact.
 */
function nonCombatSettlementSchema(): AiJsonSchema {
  const card = ref('mwgRewardCard');
  const item = ref('mwgRewardItem');
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      hp: { type: 'integer', minimum: -999, maximum: 999 },
      max_hp: { type: 'integer', minimum: -99, maximum: 999 },
      lust: { type: 'integer', minimum: -999, maximum: 999 },
      max_lust: { type: 'integer', minimum: -99, maximum: 999 },
      gold: { type: 'integer', minimum: -9999, maximum: 9999 },
      card_removals: { type: 'integer', minimum: -20, maximum: 20 },
      resources: { type: 'object', maxProperties: 16, additionalProperties: { type: 'integer', minimum: -999, maximum: 999 } },
      gain_cards: { type: 'array', maxItems: 32, items: card },
      cost: {
        type: 'object', additionalProperties: false,
        properties: {
          hp: { type: 'integer', minimum: 0, maximum: 999 },
          max_hp: { type: 'integer', minimum: 0, maximum: 999 },
          gold: { type: 'integer', minimum: 0, maximum: 9999 },
          resources: { type: 'object', maxProperties: 16, additionalProperties: { type: 'integer', minimum: 0, maximum: 999 } },
        },
      },
      deck_actions: {
        type: 'array', maxItems: 16,
        items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'kind', 'count', 'pick'],
          properties: {
            id: { type: 'string', pattern: ID_PATTERN },
            kind: { enum: ['remove', 'transform', 'duplicate'] },
            count: { type: 'integer', minimum: 1, maximum: 99 },
            pick: { enum: ['choose', 'random'] },
            filter: { type: 'object', additionalProperties: false, properties: {
              ids: { type: 'array', maxItems: 64, items: { type: 'string', minLength: 1 } },
              types: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1 } },
            } },
            replacement: card,
          },
        },
      },
      grant: {
        type: 'object', additionalProperties: false,
        properties: {
          cards: { type: 'array', maxItems: 32, items: card },
          items: { type: 'array', maxItems: 32, items: item },
          limits: { type: 'object', additionalProperties: false, properties: {
            cards: { type: 'integer', minimum: 0, maximum: 32 },
            items: { type: 'integer', minimum: 0, maximum: 32 },
          } },
        },
      },
    },
  };
}

function publicArtifactDefinitionSchema(includeSupportStatus = false): AiJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'rarity'],
    anyOf: [{ required: ['trigger'] }, { required: ['on_acquire'] }],
    properties: {
      id: { type: 'string', pattern: CONTENT_ID_PATTERN },
      name: { type: 'string', minLength: 1 },
      rarity: { enum: Array.from(RELIC_RARITY_SET) },
      emoji: { type: 'string' },
      description: { type: 'string' },
      creates: { type: 'array', maxItems: 32, items: ref('cardTemplate') },
      trigger: ref('mwgAbilityTrigger'),
      on_acquire: nonCombatSettlementSchema(),
      ...(includeSupportStatus
        ? {
            status: ref('mwgStatusDefinition'),
            statuses: {
              type: 'array',
              description: '仅当本候选 trigger 引用当前未登记的新状态时填写；必须完整闭合引用链，没有新状态时整个省略。',
              minItems: 1,
              maxItems: 16,
              items: ref('mwgStatusDefinition'),
            },
          }
        : {}),
    },
  };
}

function publicItemDefinitionSchema(includeSupportStatus = false): AiJsonSchema {
  return {
    type: 'object',
    description: BATTLE_ITEM_USAGE_RULE,
    additionalProperties: false,
    required: ['id', 'name', 'count', 'effects'],
    properties: {
      id: { type: 'string', pattern: CONTENT_ID_PATTERN },
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      count: { type: 'integer', minimum: 1, maximum: 999 },
      creates: { type: 'array', maxItems: 32, items: ref('cardTemplate') },
      effects: ref('effectList'),
      ...(includeSupportStatus
        ? {
            status: ref('mwgStatusDefinition'),
            statuses: {
              type: 'array',
              description: '仅当本候选 effects 引用当前未登记的新状态时填写；必须完整闭合引用链，没有新状态时整个省略。',
              minItems: 1,
              maxItems: 16,
              items: ref('mwgStatusDefinition'),
            },
          }
        : {}),
    },
  };
}

const SHARED_CONTENT_DEFINITIONS: AiJsonSchema = {
  /**
   * `on` inside an effects item is a legacy runtime spelling. Keep it in the
   * portable parser for old saves, but never advertise it to a generator: a
   * generated trigger always belongs at content.trigger.{on,effects}.
   */
  mwgPublicEffect: {
    allOf: [
      guardChildrenConstraint('mwgPublicEffect'),
      ref('effect'),
      collectionTargetConstraint('opponent'),
      {
        not: {
          anyOf: [
            { required: ['on'] },
            { required: ['modify'] },
            { required: ['card_rule'] },
            { required: ['narrate'] },
            { required: ['summoner_effects'] },
            { required: ['card_destination'] },
            { required: ['replay_current'] },
          ],
        },
      },
    ],
  },
  mwgPublicBundleEffect: {
    allOf: [
      ref('bundleEffect'),
      collectionTargetConstraint('opponent'),
      { not: { required: ['on'] } },
    ],
  },
  effectList: {
    anyOf: [
      { type: 'array', minItems: 1, maxItems: 256, items: ref('mwgPublicEffect') },
      ref('mwgPublicEffect'),
      ref('mwgPublicBundleEffect'),
    ],
  },
  mwgCardEffect: {
    allOf: [
      guardChildrenConstraint('mwgCardEffect'),
      ref('effect'),
      collectionTargetConstraint('opponent'),
      {
        not: {
          anyOf: [
            { required: ['on'] },
            { required: ['modify'] },
            { required: ['card_rule'] },
            { required: ['narrate'] },
            { required: ['summoner_effects'] },
          ],
        },
      },
    ],
  },
  mwgCardEffectList: {
    anyOf: [
      { type: 'array', minItems: 1, maxItems: 256, items: ref('mwgCardEffect') },
      ref('mwgCardEffect'),
      ref('mwgPublicBundleEffect'),
    ],
  },
  mwgPowerImmediateEffect: {
    allOf: [
      guardChildrenConstraint('mwgPowerImmediateEffect'),
      ref('mwgCardEffect'),
      { not: { required: ['replay_current'] } },
    ],
  },
  mwgPowerImmediateEffectList: {
    anyOf: [
      { type: 'array', minItems: 1, maxItems: 256, items: ref('mwgPowerImmediateEffect') },
      ref('mwgPowerImmediateEffect'),
      ref('mwgPublicBundleEffect'),
    ],
  },
  mwgEventEffect: {
    allOf: [
      ref('narrateEffect'),
      { not: { anyOf: [{ required: ['on'] }, { required: ['when'] }] } },
    ],
  },
  mwgEventEffectList: {
    anyOf: [
      ref('mwgEventEffect'),
      { type: 'array', minItems: 1, maxItems: 1, items: ref('mwgEventEffect') },
    ],
  },
  mwgPowerStatusEffect: {
    allOf: [ref('applyStatusEffect'), { not: { required: ['on'] } }],
  },
  mwgPowerStatusEffectList: {
    anyOf: [
      ref('mwgPowerStatusEffect'),
      { type: 'array', minItems: 1, maxItems: 256, items: ref('mwgPowerStatusEffect') },
    ],
  },
  mwgPassiveEffect: {
    oneOf: [ref('modifierEffect'), ref('cardPlayRuleEffect')],
  },
  mwgPassiveEffectList: {
    anyOf: [
      { type: 'array', minItems: 1, maxItems: 64, items: ref('mwgPassiveEffect') },
      ref('mwgPassiveEffect'),
    ],
  },
  mwgThresholdExecuteEffect: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['execute', 'to'],
        properties: {
          execute: ref('formula'),
          threshold_mode: { enum: ['hp', 'hp_percent'] },
          exclude_tags: {
            type: 'array', minItems: 1, maxItems: 32, uniqueItems: true,
            items: { type: 'string', pattern: ID_PATTERN },
          },
          trigger_fatal: { type: 'boolean' },
          to: { const: 'self' },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['kill', 'to'],
        properties: {
          kill: { const: true },
          exclude_tags: {
            type: 'array', minItems: 1, maxItems: 32, uniqueItems: true,
            items: { type: 'string', pattern: ID_PATTERN },
          },
          trigger_fatal: { type: 'boolean' },
          to: { const: 'self' },
        },
      },
    ],
  },
  mwgThresholdExecuteEffectList: {
    anyOf: [
      { type: 'array', minItems: 1, maxItems: 64, items: ref('mwgThresholdExecuteEffect') },
      ref('mwgThresholdExecuteEffect'),
    ],
  },
  mwgAbilityTrigger: {
    oneOf: [
      structuredTrigger(
        { enum: FILTERABLE_ABILITY_TRIGGERS },
        ref('effectList'),
        true,
      ),
      structuredTrigger({ enum: UNFILTERED_ABILITY_TRIGGERS }, ref('effectList'), false),
      structuredTrigger({ const: 'passive' }, ref('mwgPassiveEffectList'), false),
    ],
  },
  // Every nested ability inside spawn_enemy/spawn_summon also resolves the
  // portable schema's abilityTriggerInput reference. Override that shared
  // definition here so a generator never sees the legacy sibling-string form.
  abilityTriggerInput: ref('mwgAbilityTrigger'),
  mwgCardTrigger: {
    oneOf: [
      structuredTrigger(
        { enum: FILTERABLE_CARD_TRIGGERS },
        ref('effectList'),
        true,
      ),
      structuredTrigger({ enum: UNFILTERED_CARD_TRIGGERS }, ref('effectList'), false),
      structuredTrigger({ const: 'passive' }, ref('mwgPassiveEffectList'), false),
    ],
  },
  mwgSummonEffect: {
    allOf: [
      guardChildrenConstraint('mwgSummonEffect'),
      ref('effect'),
      collectionTargetConstraint('opponent'),
      {
        not: {
          anyOf: [
            { required: ['on'] },
            { required: ['modify'] },
            { required: ['card_rule'] },
            { required: ['narrate'] },
            { required: ['card_destination'] },
            { required: ['replay_current'] },
          ],
        },
      },
    ],
  },
  mwgSummonEffectList: {
    anyOf: [
      { type: 'array', minItems: 1, maxItems: 256, items: ref('mwgSummonEffect') },
      ref('mwgSummonEffect'),
      ref('mwgPublicBundleEffect'),
    ],
  },
  mwgEnemyEffect: {
    allOf: [
      guardChildrenConstraint('mwgEnemyEffect'),
      ref('effect'),
      collectionTargetConstraint('self'),
      {
        not: {
          anyOf: [
            { required: ['on'] },
            { required: ['modify'] },
            { required: ['card_rule'] },
            { required: ['narrate'] },
            { required: ['summoner_effects'] },
            { required: ['card_destination'] },
            { required: ['replay_current'] },
          ],
        },
      },
    ],
  },
  mwgEnemyBundleEffect: {
    allOf: [
      ref('bundleEffect'),
      collectionTargetConstraint('self'),
      { not: { required: ['on'] } },
    ],
  },
  mwgEnemyEffectList: {
    anyOf: [
      { type: 'array', minItems: 1, maxItems: 256, items: ref('mwgEnemyEffect') },
      ref('mwgEnemyEffect'),
      ref('mwgEnemyBundleEffect'),
    ],
  },
  mwgEnemyAbilityTrigger: {
    oneOf: [
      structuredTrigger({ enum: FILTERABLE_ABILITY_TRIGGERS }, ref('mwgEnemyEffectList'), true),
      structuredTrigger({ enum: UNFILTERED_ABILITY_TRIGGERS }, ref('mwgEnemyEffectList'), false),
      structuredTrigger({ const: 'passive' }, ref('mwgPassiveEffectList'), false),
    ],
  },
  mwgSummonAbilityTrigger: {
    oneOf: [
      structuredTrigger({ enum: FILTERABLE_ABILITY_TRIGGERS }, ref('mwgSummonEffectList'), true),
      structuredTrigger({ enum: UNFILTERED_ABILITY_TRIGGERS }, ref('mwgSummonEffectList'), false),
    ],
  },
  spawnSummonEffect: publicSpawnSummonEffectSchema(),
  spawnEnemyEffect: publicSpawnEnemyEffectSchema(),
  cardTemplate: publicCardTemplateSchema(),
  mwgCombatResource: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'emoji', 'max', 'refresh'],
    anyOf: [{ required: ['start'] }, { required: ['current'] }],
    properties: {
      id: { type: 'string', pattern: ID_PATTERN },
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      start: { type: 'integer', minimum: 0 },
      current: { type: 'integer', minimum: 0 },
      max: { type: 'integer', minimum: 1 },
      refresh: { enum: ['reset', 'retain'] },
      end_of_battle: { enum: ['retain', 'reset'], description: '战后保留结余，或恢复 start（缺省 0）；与回合刷新独立。省略保留结余。' },
    },
  },
  mwgActiveStatus: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'stacks'],
    properties: {
      id: { type: 'string', pattern: ID_PATTERN },
      stacks: { type: 'integer', minimum: 1, maximum: 999 },
    },
  },
  mwgDamageProtection: {
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'scope'],
    properties: {
      mode: { enum: ['intercept', 'share_damage'] },
      scope: { enum: ['specific', 'all_allies'] },
      target_id: { type: 'string', pattern: ID_PATTERN },
      priority: { type: 'integer' },
    },
    allOf: [
      { if: { properties: { scope: { const: 'specific' } }, required: ['scope'] }, then: { required: ['target_id'] } },
      { if: { properties: { scope: { const: 'all_allies' } }, required: ['scope'] }, then: { not: { required: ['target_id'] } } },
    ],
  },
  mwgStatusDefinition: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'emoji', 'type', 'triggers'],
    properties: {
      id: { type: 'string', pattern: ID_PATTERN },
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      type: { enum: ['buff', 'debuff', 'neutral'] },
      stacks_change: {
        anyOf: [
          { type: 'number' },
          { enum: ['keep', 'reset'] },
          { type: 'string', pattern: '^x(?:\\d+(?:\\.\\d+)?|\\.\\d+)$' },
        ],
      },
      maxStacks: { type: 'integer', minimum: 1, maximum: 999 }, intercepts: structuredClone(INTERCEPTION_SCHEMA),
      tags: { type: 'array', maxItems: 64, uniqueItems: true, items: { type: 'string', pattern: ID_PATTERN } },
      tick_timing: { enum: ['before_action', 'after_action'] },
      stun: { type: 'boolean' }, character_emoji: CHARACTER_EMOJI_SCHEMA,
      protection: ref('mwgDamageProtection'),
      defense: clone(STATUS_DEFENSE_SCHEMA),
      creates: { type: 'array', maxItems: 32, items: ref('cardTemplate') },
      triggers: {
        type: 'object',
        additionalProperties: false,
        properties: {
          apply: ref('effectList'),
          stack: ref('effectList'),
          tick: ref('effectList'),
          remove: ref('effectList'),
          hold: ref('mwgPassiveEffectList'),
          threshold_execute: ref('mwgThresholdExecuteEffectList'),
          ...Object.fromEntries(STATUS_EVENT_TRIGGERS.map(trigger => [trigger, ref('effectList')])),
        },
      },
    },
  },
  mwgNamedEffects: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'effects'],
    properties: {
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      creates: { type: 'array', maxItems: 32, items: ref('cardTemplate') },
      when: ref('formulaString'),
      effects: ref('effectList'),
    },
  },
  mwgAbility: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'trigger'],
    properties: {
      id: { type: 'string', pattern: CONTENT_ID_PATTERN },
      name: { type: 'string', minLength: 1 },
      source: { type: 'string', minLength: 1 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      creates: { type: 'array', maxItems: 32, items: ref('cardTemplate') },
      trigger: ref('mwgAbilityTrigger'),
    },
  },
  mwgCard: publicCardDefinitionSchema(),
  /** Reward-only wrapper: the support definition is stripped from the owned card after atomic registration. */
  mwgRewardCard: publicCardDefinitionSchema(true),
  mwgArtifact: publicArtifactDefinitionSchema(),
  mwgRewardArtifact: publicArtifactDefinitionSchema(true),
  mwgItem: publicItemDefinitionSchema(),
  mwgRewardItem: publicItemDefinitionSchema(true),
  mwgInitialStance: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name'],
    properties: {
      id: { type: 'string', pattern: ID_PATTERN },
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      enter: ref('effectList'),
      exit: ref('effectList'),
      passive: ref('mwgPassiveEffectList'),
      events: { type: 'array', minItems: 1, maxItems: 16, items: { allOf: [
        ref('mwgAbilityTrigger'), { not: { type: 'object', required: ['on'], properties: { on: { const: 'passive' } } } },
      ] } },
    },
  },
  mwgInitialOrb: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'value'],
    properties: {
      id: { type: 'string', pattern: ID_PATTERN },
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      value: { type: 'number', minimum: 0 },
      passive: ref('effectList'),
      evoke: ref('effectList'),
    },
  },
  mwgEnemyAction: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'effects'],
    properties: {
      id: { type: 'string', pattern: ID_PATTERN },
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      dialogue: { type: 'string', minLength: 1, description: '可选台词；行动执行时展示。' },
      weight: { type: 'number', exclusiveMinimum: 0 },
      when: ref('formulaString'),
      creates: { type: 'array', maxItems: 32, items: ref('cardTemplate') },
      effects: ref('mwgEnemyEffectList'),
    },
  },
  mwgEnemyAbility: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'trigger'],
    allOf: [{ if: { properties: { trigger: { properties: { on: { const: 'passive' }, effects: { type: 'object', maxProperties: 0 } }, required: ['on', 'effects'] } }, required: ['trigger'] }, then: { required: ['protection'] } }],
    properties: {
      id: { type: 'string', pattern: CONTENT_ID_PATTERN },
      name: { type: 'string', minLength: 1 },
      source: { type: 'string', minLength: 1 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      creates: { type: 'array', maxItems: 32, items: ref('cardTemplate') },
      trigger: {
        anyOf: [
          ref('mwgEnemyAbilityTrigger'),
          {
            type: 'object', additionalProperties: false,
            required: ['on', 'effects'],
            properties: { on: { const: 'passive' }, effects: { type: 'object', maxProperties: 0 } },
          },
        ],
      },
      protection: ref('mwgDamageProtection'),
    },
  },
  mwgEnemyNamedEffects: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'effects'],
    properties: {
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string' },
      description: { type: 'string' },
      creates: { type: 'array', maxItems: 32, items: ref('cardTemplate') },
      when: ref('formulaString'),
      effects: ref('mwgEnemyEffectList'),
    },
  },
  mwgEnemy: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'emoji', 'hp', 'max_hp', 'lust', 'max_lust', 'actions'],
    properties: {
      id: { type: 'string', pattern: ID_PATTERN },
      name: { type: 'string', minLength: 1 },
      emoji: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      escape_when: ref('formulaString'),
      quantity: { type: 'integer', minimum: 1, maximum: 100, description: '同一定义的独立敌人数。设计时优先不超过两名，更多敌人使用不同变种；这不是质量硬门槛。' },
      victory_on_defeat: { type: 'boolean', description: '最终击倒此敌人即胜利；复活成功不算击倒。' },
      defeat_reward: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cards: { type: 'array', maxItems: 12, items: ref('cardTemplate') },
          artifacts: { type: 'array', maxItems: 6, items: ref('mwgArtifact') },
          items: { type: 'array', maxItems: 6, items: ref('mwgItem') },
          gold: { type: 'integer', minimum: 0 },
        },
      },
      family_id: { type: 'string', pattern: ID_PATTERN },
      family_name: { type: 'string', minLength: 1 },
      evolution_stage: { type: 'string', minLength: 1 },
      hp: { type: 'number', minimum: 0 },
      max_hp: { type: 'number', exclusiveMinimum: 0 },
      lust: { type: 'number', minimum: 0 },
      max_lust: { type: 'number', exclusiveMinimum: 0 },
      energy: { type: 'integer', minimum: 0 },
      max_energy: { type: 'integer', minimum: 0 },
      block: { type: 'number', minimum: 0 },
      resources: { type: 'array', maxItems: 16, items: ref('mwgCombatResource') },
      actions: { type: 'array', minItems: 1, maxItems: 24, items: ref('mwgEnemyAction') },
      abilities: { type: 'array', maxItems: 24, items: ref('mwgEnemyAbility') },
      status_effects: { type: 'array', maxItems: 64, items: ref('mwgActiveStatus') },
      lust_effect: ref('mwgEnemyNamedEffects'),
      action_mode: { enum: ['random', 'probability', 'sequence', 'sequence_then_probability'] },
      action_config: {
        type: 'object',
        additionalProperties: false,
        properties: {
          probability: {
            type: 'object',
            minProperties: 1,
            maxProperties: 24,
            additionalProperties: { type: 'number', exclusiveMinimum: 0 },
          },
          sequence: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: { type: 'string', minLength: 1 },
          },
        },
      },
      action_priority: { type: 'integer', minimum: -999, maximum: 999 },
      speed: { type: 'integer', minimum: -999, maximum: 999 },
      tags: {
        type: 'array',
        maxItems: 32,
        uniqueItems: true,
        items: { type: 'string', pattern: ID_PATTERN },
      },
      stance: { anyOf: [ref('mwgInitialStance'), { type: 'null' }] },
      orb_slots: { type: 'integer', minimum: 0, maximum: 20 },
      orbs: { type: 'array', maxItems: 20, items: ref('mwgInitialOrb') },
    },
  },
};

/**
 * Attach the one AI-facing effects grammar plus the content wrappers that use
 * it. Every structured generator calls this function, so schema and runtime
 * validation no longer drift between opening, node and reward requests.
 */
export function withAiContentDefinitions(value: AiJsonSchema): AiJsonSchema {
  return {
    ...value,
    $defs: {
      ...clone(EFFECT_DEFINITIONS),
      ...clone(SHARED_CONTENT_DEFINITIONS),
    },
  };
}

/**
 * Attach only definitions reachable from the supplied schema. Small bounded
 * repair protocols should not expose the model to the unrelated full content
 * grammar merely because they reuse a primitive formula or card-zone shape.
 */
export function withAiContentDefinitionsSubset(value: AiJsonSchema): AiJsonSchema {
  const available: AiJsonSchema = {
    ...clone(EFFECT_DEFINITIONS),
    ...clone(SHARED_CONTENT_DEFINITIONS),
  };
  const required = new Set<string>();
  const queue: unknown[] = [value];
  const visited = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.pop();
    if (current == null || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
      if (key === '$ref' && typeof entry === 'string') {
        const match = entry.match(/^#\/\$defs\/([A-Za-z_][A-Za-z0-9_]*)$/);
        if (match && !required.has(match[1])) {
          required.add(match[1]);
          if (available[match[1]]) queue.push(available[match[1]]);
        }
      } else {
        queue.push(entry);
      }
    }
  }
  return {
    ...value,
    $defs: Object.fromEntries([...required].sort().map(name => [name, clone(available[name])])),
  };
}

export function aiSchemaRef(name: keyof typeof SHARED_CONTENT_DEFINITIONS | 'effectList' | 'cardCost'): AiJsonSchema {
  return ref(name);
}
