import {
  ABILITY_TRIGGER_SET,
  REGISTERABLE_EFFECT_TRIGGER_SET,
  type RegisterableEffectTrigger,
} from './battleTriggers';
import { roundBattleValue } from './battleMath';
import type { CardOrigin } from './cardIdentity';
import type { PlayedCardDestination } from './cardRules';
import type { CardCostOperator, CardKeyword, CardPatchScope } from './cardPatch';
import type { EnemyTargetSelector } from './combatantCollection';
import {
  BATTLE_EVENT_PHASES,
  BATTLE_EVENT_KINDS,
  DAMAGE_KINDS,
  EVENT_SOURCE_KINDS,
  readBattleEventHistoryValue,
  type BattleEventJournalState,
  type CardMoveReason,
  type DamageKind,
  type EventCounterFilter,
  type EventHistoryMetric,
  type EventTriggerQuery,
  type HistoryScope,
} from './battleEventJournal';
import type { CardAttachmentKind, CardAttachmentRemovalEvent } from './cardAttachment';
import { validateCardCost, type CardCost } from './combatResource';
import type { SummonOverflowPolicy, SummonSelector, SummonUnitDefinition } from './summonUnit';

export const EFFECT_PROGRAM_SPEC = 'mwg.effect/v1' as const;

export type EffectTarget = 'self' | 'opponent';

export type CardZone = 'hand' | 'draw' | 'discard' | 'exhaust' | 'all' | 'combat';
export type CardPick = 'random' | 'choose' | 'left' | 'right' | 'top' | 'bottom' | 'all';
export type CardType = 'Attack' | 'Skill' | 'Power' | 'Event' | 'Curse';
export type CardRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Corrupt';
export type RecoverCardZone = 'draw' | 'discard' | 'exhaust';
export type EffectCardPileZone = 'hand' | 'drawPile' | 'discardPile' | 'exhaustPile';
export type ModifierStat = 'damage' | 'damage_taken' | 'lust' | 'lust_taken' | 'heal' | 'block' | 'summon_capacity';
export type EffectModifierOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'set';
export type CardValueStat = 'damage' | 'block' | 'lust' | 'stacks';
export type CardValueOperator = 'add' | 'subtract' | 'multiply' | 'divide';
export type CardPlayRuleKind =
  | 'replay'
  | 'free'
  | 'retain_hand'
  | 'retain_block'
  | 'limit_draw'
  | 'limit_block_gain'
  | 'limit_energy_gain'
  | 'deny_card_play'
  | 'allow_card_play'
  | 'limit_card_play'
  | 'card_destination';
export type EffectTrigger = RegisterableEffectTrigger;
export type EffectSchedulePhase = 'turn_start' | 'before_draw' | 'after_draw' | 'turn_end';

export interface CardSelector {
  zone: CardZone;
  pick: CardPick;
  count?: number;
  filter?: CardSelectorFilter;
}

export interface CardSelectorFilter {
  /** Exact visible card name. Distinct from template and instance identity. */
  name?: string;
  types?: CardType[];
  rarities?: CardRarity[];
  cost?: CardCost;
  minCost?: number;
  maxCost?: number;
  tags?: string[];
  templateId?: string;
  runInstanceId?: string;
  combatInstanceId?: string;
  origin?: CardOrigin;
  upgraded?: boolean;
  /** Select lineage roots only; temporary copied combat instances are excluded. */
  rootOnly?: boolean;
}

export type CardPatchMatch = 'instance' | 'run_instance' | 'template' | 'filter';

interface EffectCardPatchBase {
  scope: CardPatchScope;
  match?: CardPatchMatch;
  includeFutureCopies?: boolean;
}

export type EffectCardPatch =
  | (EffectCardPatchBase & {
      kind: 'numeric';
      stat: CardValueStat;
      operator: CardValueOperator;
      value: NumericExpression;
    })
  | (EffectCardPatchBase & {
      kind: 'cost';
      operator: CardCostOperator;
      value: NumericExpression;
    })
  | (EffectCardPatchBase & { kind: 'keyword'; keyword: CardKeyword; enabled: boolean })
  | (EffectCardPatchBase & { kind: 'replay'; extra: NumericExpression })
  | (EffectCardPatchBase & { kind: 'x_value'; operator: CardCostOperator; value: NumericExpression })
  | (EffectCardPatchBase & {
      kind: 'dynamic_cost';
      timing: 'on_draw' | 'while_in_hand' | 'on_play';
      operator: CardCostOperator;
      value: NumericExpression;
      minimum?: number;
      maximum?: number;
    });

export type EffectCardUpgradeChange =
  | { kind: 'numeric'; stat: CardValueStat; operator: CardValueOperator; value: NumericExpression }
  | { kind: 'cost'; operator: CardCostOperator; value: NumericExpression }
  | { kind: 'keyword'; keyword: CardKeyword; enabled: boolean }
  | { kind: 'replay'; extra: NumericExpression }
  | { kind: 'x_value'; operator: CardCostOperator; value: NumericExpression }
  | {
      kind: 'dynamic_cost';
      timing: 'on_draw' | 'while_in_hand' | 'on_play';
      operator: CardCostOperator;
      value: NumericExpression;
      minimum?: number;
      maximum?: number;
    };

export type EffectCardAttachmentChange =
  | EffectCardUpgradeChange
  | { kind: 'play_access'; mode: 'deny' | 'allow' }
  | {
      kind: 'discard_auto_play';
      reasons: CardMoveReason[];
      failureDestination: PlayedCardDestination;
      onlyPlayerTurn: boolean;
    };

export interface EffectCardAttachmentDefinition {
  id: string;
  kind: CardAttachmentKind;
  name: string;
  description?: string;
  emoji?: string;
  scope: CardPatchScope;
  removeOn?: CardAttachmentRemovalEvent;
  remaining?: number;
  discardReasons?: CardMoveReason[];
  priority?: number;
  changes: EffectCardAttachmentChange[];
}

export interface GeneratedCardDefinition {
  id: string;
  name: string;
  emoji: string;
  type: CardType;
  rarity: CardRarity;
  cost?: CardCost;
  description: string;
  program: EffectProgram;
  discardProgram?: EffectProgram;
  retain?: boolean;
  exhaust?: boolean;
  ethereal?: boolean;
}

/** Mutually-exclusive combat mode carried by one combatant. */
export interface EffectStanceDefinition {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  enterEffects?: EffectNode[];
  exitEffects?: EffectNode[];
  passiveEffects?: EffectNode[];
}

/** Ordered slot entity with an independent value and passive/evoke programs. */
export interface EffectOrbDefinition {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  value: NumericExpression;
  passiveEffects?: EffectNode[];
  evokeEffects?: EffectNode[];
}

export interface EffectOrbSelector {
  pick: 'first' | 'last' | 'all';
  count?: number;
  id?: string;
}

export type EffectSummonDefinition = Omit<SummonUnitDefinition, 'statusEffects'>;
export type SummonValueStat = 'max_hp' | 'block' | 'actions_per_activation' | 'speed' | 'action_priority';
export type SummonValueOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'set';

/**
 * JSON-safe authored enemy template carried by a spawn effect. The Tavern
 * adapter performs the same full content compilation used for initial MVU
 * enemies before admitting an instance into the live encounter.
 */
export interface EffectEnemySpawnDefinition {
  id: string;
  name: string;
  emoji: string;
  max_hp: number;
  hp?: number;
  max_lust?: number;
  lust?: number;
  block?: number;
  description?: string;
  actions: Array<Record<string, unknown>>;
  abilities?: Array<Record<string, unknown>>;
  status_effects?: Array<Record<string, unknown>>;
  lust_effect: Record<string, unknown>;
  action_mode?: string;
  action_config?: Record<string, unknown>;
  action_priority?: number;
  speed?: number;
  tags?: string[];
  resources?: Record<string, unknown>;
  stance?: Record<string, unknown> | null;
  orb_slots?: number;
  orbs?: Array<Record<string, unknown>>;
}

export type NumericExpression =
  | number
  | { op: 'var'; path: string }
  | BinaryNumericExpression
  | UnaryNumericExpression
  | { op: 'clamp_min'; value: NumericExpression; minimum: number }
  | AggregateNumericExpression
  | { op: 'count_cards'; selector: CardSelector }
  | { op: 'count_statuses'; target: EffectTarget }
  | {
      op: 'history'; metric: EventHistoryMetric; scope?: HistoryScope; turn?: number;
      cardInstanceId?: string; teamActorIds?: string[]; filter?: EventCounterFilter;
    }
  | { op: 'intent_value' };

export type BinaryNumericExpression = {
  [TOperator in 'add' | 'subtract' | 'multiply' | 'divide']: {
    op: TOperator;
    left: NumericExpression;
    right: NumericExpression;
  };
}['add' | 'subtract' | 'multiply' | 'divide'];

export type UnaryNumericExpression = {
  [TOperator in 'negate' | 'floor' | 'ceil' | 'abs']: { op: TOperator; value: NumericExpression };
}['negate' | 'floor' | 'ceil' | 'abs'];

export type AggregateNumericExpression = {
  [TOperator in 'min' | 'max']: { op: TOperator; values: NumericExpression[] };
}['min' | 'max'];

export type ConditionExpression =
  | ComparisonCondition
  | { op: 'all' | 'any'; conditions: ConditionExpression[] }
  | { op: 'not'; condition: ConditionExpression }
  | { op: 'last_card_type'; cardType: CardType }
  | { op: 'intent_type'; intentType: string };

export interface ComparisonCondition {
  op: 'compare';
  relation: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  left: NumericExpression;
  right: NumericExpression;
}

export type EffectNode =
  | {
      op: 'damage'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: NumericExpression;
      damageKind?: Exclude<DamageKind, 'execute'>; bypassBlock?: boolean; lifesteal?: NumericExpression;
    }
  | {
      op: 'execute'; target: EffectTarget; targetSelector?: EnemyTargetSelector; threshold: NumericExpression;
      thresholdMode: 'hp' | 'hp_percent'; excludeTags?: string[]; triggerFatal?: boolean;
    }
  | {
      op: 'kill'; target: EffectTarget; targetSelector?: EnemyTargetSelector;
      excludeTags?: string[]; triggerFatal?: boolean;
    }
  | { op: 'heal'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: NumericExpression }
  | { op: 'gain_block'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: NumericExpression }
  | { op: 'gain_energy'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: NumericExpression }
  | { op: 'gain_resource'; target: EffectTarget; targetSelector?: EnemyTargetSelector; resource: string; amount: NumericExpression }
  | { op: 'set_resource'; target: EffectTarget; targetSelector?: EnemyTargetSelector; resource: string; value: NumericExpression }
  | { op: 'gain_lust'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: NumericExpression }
  | {
      op: 'set_stat';
      target: EffectTarget;
      targetSelector?: EnemyTargetSelector;
      stat: 'hp' | 'lust' | 'energy' | 'block';
      value: NumericExpression;
    }
  | { op: 'apply_status'; target: EffectTarget; targetSelector?: EnemyTargetSelector; status: string; stacks: NumericExpression }
  | { op: 'remove_status'; target: EffectTarget; targetSelector?: EnemyTargetSelector; status: string }
  | { op: 'draw_cards'; amount: NumericExpression }
  | { op: 'scry_cards'; amount: NumericExpression }
  | { op: 'discard_cards'; selector: CardSelector; amount: NumericExpression }
  | { op: 'exhaust_cards'; selector: CardSelector; amount: NumericExpression }
  | { op: 'recover_cards'; source: RecoverCardZone; pick: 'random' | 'choose' | 'all'; amount: NumericExpression }
  | { op: 'reduce_card_cost'; selector: CardSelector; amount: NumericExpression }
  | {
      op: 'modify_card_value';
      selector: CardSelector;
      stat: CardValueStat;
      operator: CardValueOperator;
      value: NumericExpression;
    }
  | { op: 'copy_cards'; selector: CardSelector }
  | { op: 'double_card_effect'; selector: CardSelector }
  | { op: 'auto_play_cards'; selector: CardSelector; free: boolean }
  | { op: 'set_card_destination'; destination: PlayedCardDestination }
  | {
      op: 'move_cards';
      selector: CardSelector;
      amount: number;
      destination: EffectCardPileZone;
      position: 'top' | 'bottom';
    }
  | { op: 'remove_cards'; selector: CardSelector; amount: number }
  | { op: 'transform_cards'; selector: CardSelector; replacement: GeneratedCardDefinition }
  | { op: 'apply_card_patch'; selector: CardSelector; patch: EffectCardPatch }
  | { op: 'apply_card_attachment'; selector: CardSelector; attachment: EffectCardAttachmentDefinition }
  | {
      op: 'upgrade_cards';
      selector: CardSelector;
      scope: 'combat' | 'run' | 'permanent';
      levels: number;
      maxLevel?: number;
      changes: EffectCardUpgradeChange[];
    }
  | { op: 'add_card'; zone: 'hand' | 'draw'; card: GeneratedCardDefinition; count: number }
  | {
      op: 'ensure_card';
      zone: 'hand' | 'draw';
      card: GeneratedCardDefinition;
      minimum: number;
      includeCopies?: boolean;
    }
  | {
      op: 'spawn_summon'; target: EffectTarget; summon: EffectSummonDefinition; count: NumericExpression;
      capacity?: number; overflow?: SummonOverflowPolicy;
    }
  | {
      op: 'spawn_enemy'; enemy: EffectEnemySpawnDefinition; count: NumericExpression;
      /** Maximum simultaneously living enemies after this effect resolves. */
      capacity?: number;
    }
  | { op: 'damage_summons'; selector: SummonSelector; amount: NumericExpression }
  | { op: 'heal_summons'; selector: SummonSelector; amount: NumericExpression }
  | {
      op: 'modify_summons'; selector: SummonSelector; stat: SummonValueStat;
      operator: SummonValueOperator; value: NumericExpression;
    }
  | {
      op: 'modify_summon_effects'; selector: SummonSelector; stat: CardValueStat;
      operator: CardValueOperator; value: NumericExpression;
    }
  | { op: 'gain_summon_resource'; selector: SummonSelector; resource: string; amount: NumericExpression }
  | { op: 'set_summon_resource'; selector: SummonSelector; resource: string; value: NumericExpression }
  | { op: 'apply_summon_status'; selector: SummonSelector; status: string; stacks: NumericExpression }
  | { op: 'remove_summon_status'; selector: SummonSelector; status: string }
  | { op: 'activate_summons'; selector: SummonSelector }
  | { op: 'dismiss_summons'; selector: SummonSelector; retainCorpse?: boolean }
  | {
      op: 'copy_summons'; selector: SummonSelector;
      targetOwner?: 'same' | EffectTarget;
      capacity?: number; overflow?: SummonOverflowPolicy;
    }
  /**
   * Resolve a nested program against the combatant who owns the active summon.
   * Ordinary summon `self` remains the exact summon; authors opt in explicitly
   * when a passive/action should grant its summoner block, energy, statuses, etc.
   */
  | { op: 'summoner_effects'; effects: EffectNode[] }
  | {
      op: 'modify';
      target: EffectTarget;
      targetSelector?: EnemyTargetSelector;
      stat: ModifierStat;
      operator: EffectModifierOperator;
      value: NumericExpression;
    }
  | {
      op: 'card_play_rule';
      target: EffectTarget;
      rule: CardPlayRuleKind;
      limit?: NumericExpression | 'all';
      extra?: NumericExpression;
      selector?: CardSelector;
      destination?: PlayedCardDestination;
      priority?: number;
      /** all waives every component; a list waives only those resource IDs. */
      freeResources?: 'all' | string[];
    }
  | {
      op: 'set_stance';
      target: EffectTarget;
      targetSelector?: EnemyTargetSelector;
      stance: EffectStanceDefinition | null;
    }
  | {
      op: 'channel_orb';
      target: EffectTarget;
      targetSelector?: EnemyTargetSelector;
      orb: EffectOrbDefinition;
    }
  | {
      op: 'evoke_orbs';
      target: EffectTarget;
      targetSelector?: EnemyTargetSelector;
      selector: EffectOrbSelector;
    }
  | {
      op: 'set_orb_slots';
      target: EffectTarget;
      targetSelector?: EnemyTargetSelector;
      amount: NumericExpression;
    }
  | {
      op: 'modify_orbs';
      target: EffectTarget;
      targetSelector?: EnemyTargetSelector;
      selector: EffectOrbSelector;
      operator: CardValueOperator;
      value: NumericExpression;
    }
  | {
      op: 'grant_extra_turn';
      target: EffectTarget;
      amount: NumericExpression;
    }
  | { op: 'force_end_turn'; target: EffectTarget }
  | {
      op: 'register_trigger'; target: EffectTarget; trigger: EffectTrigger;
      eventQuery?: EventTriggerQuery; effects: EffectNode[];
    }
  | {
      op: 'schedule_effect';
      afterTurns: number;
      phase: EffectSchedulePhase;
      priority?: number;
      repeatEvery?: number;
      repeats?: number;
      effects: EffectNode[];
    }
  | { op: 'choose_one'; choiceId: string; options: EffectChoiceOption[] }
  | { op: 'if'; condition: ConditionExpression; then: EffectNode[]; else?: EffectNode[] }
  | { op: 'narrate'; text: string };

export interface EffectChoiceOption {
  id: string;
  label: string;
  effects: EffectNode[];
}

export interface EffectProgram {
  spec: typeof EFFECT_PROGRAM_SPEC;
  steps: EffectNode[];
}

export interface CoreCombatantState {
  hp: number;
  maxHp: number;
  lust: number;
  maxLust: number;
  energy: number;
  maxEnergy: number;
  block: number;
  handSize?: number;
  drawPileSize?: number;
  discardPileSize?: number;
  exhaustPileSize?: number;
  statusStacks?: Record<string, number>;
  resources?: Record<string, number>;
  maxResources?: Record<string, number>;
  tags?: string[];
}

export interface CoreEffectState {
  self: CoreCombatantState;
  opponent: CoreCombatantState;
  currentTurn: number;
  cardsPlayedThisTurn: number;
  attacksPlayedThisTurn: number;
  skillsPlayedThisTurn: number;
  cardZones?: {
    hand: CoreCardView[];
    draw: CoreCardView[];
    discard: CoreCardView[];
    exhaust: CoreCardView[];
  };
  history?: {
    lastDamage?: number;
    lastHpLoss?: number;
    lastHeal?: number;
    lastResourceSpent?: number;
    lastCardType?: string;
    /** Full structured history enables filtered counters and recent-event reads. */
    eventJournal?: BattleEventJournalState;
  };
  enemyIntentValue?: number;
  enemyIntentType?: string;
}

export interface CoreCardView {
  id: string;
  name?: string;
  type?: CardType;
  rarity?: CardRarity;
  cost?: CardCost;
  tags?: string[];
  originalId?: string;
  templateId?: string;
  runInstanceId?: string;
  combatInstanceId?: string;
  origin?: CardOrigin;
  upgraded?: boolean;
  upgradeLevel?: number;
}

export interface EffectExecutionContext {
  spentEnergy: number;
  spentResources?: Readonly<Record<string, number>>;
  xValues?: Readonly<Record<string, number>>;
  xValue?: number;
  statusStacks?: number;
  orbValue?: number;
  choiceSelections?: Readonly<Record<string, string>>;
}

export interface EffectValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type EffectValidationResult =
  { ok: true; value: EffectProgram } | { ok: false; issues: EffectValidationIssue[] };

export type CoreEffectEvent =
  | {
      type: 'damage'; target: EffectTarget; requested: number; blocked: number; hpLost: number;
      damageKind?: Exclude<DamageKind, 'execute'>; bypassBlock?: boolean; lifesteal?: number;
    }
  | {
      type: 'defeat'; target: EffectTarget; method: 'execute' | 'kill'; succeeded: boolean;
      previousHp: number; threshold?: number; thresholdMode?: 'hp' | 'hp_percent';
      fatal: boolean; excludedBy?: string;
    }
  | { type: 'heal'; target: EffectTarget; requested: number; hpGained: number }
  | { type: 'gain_block'; target: EffectTarget; amount: number }
  | { type: 'gain_energy'; target: EffectTarget; amount: number }
  | { type: 'gain_resource'; target: EffectTarget; resource: string; amount: number }
  | { type: 'set_resource'; target: EffectTarget; resource: string; value: number }
  | { type: 'gain_lust'; target: EffectTarget; amount: number }
  | { type: 'set_stat'; target: EffectTarget; stat: 'hp' | 'lust' | 'energy' | 'block'; value: number }
  | { type: 'apply_status'; target: EffectTarget; status: string; stacks: number }
  | { type: 'remove_status'; target: EffectTarget; status: string }
  | { type: 'draw_cards'; amount: number }
  | { type: 'scry_cards'; amount: number }
  | { type: 'discard_cards' | 'exhaust_cards'; selector: CardSelector; amount: number }
  | { type: 'recover_cards'; source: RecoverCardZone; pick: 'random' | 'choose' | 'all'; amount: number }
  | { type: 'reduce_card_cost'; selector: CardSelector; amount: number }
  | {
      type: 'modify_card_value';
      selector: CardSelector;
      stat: CardValueStat;
      operator: CardValueOperator;
      value: number;
    }
  | { type: 'copy_cards' | 'double_card_effect'; selector: CardSelector }
  | { type: 'auto_play_cards'; selector: CardSelector; free: boolean }
  | { type: 'set_card_destination'; destination: PlayedCardDestination }
  | {
      type: 'move_cards';
      selector: CardSelector;
      amount: number;
      destination: EffectCardPileZone;
      position: 'top' | 'bottom';
    }
  | { type: 'remove_cards'; selector: CardSelector; amount: number }
  | { type: 'transform_cards'; selector: CardSelector; replacement: GeneratedCardDefinition }
  | { type: 'apply_card_patch'; selector: CardSelector; patch: EffectCardPatch }
  | { type: 'apply_card_attachment'; selector: CardSelector; attachment: EffectCardAttachmentDefinition }
  | {
      type: 'upgrade_cards';
      selector: CardSelector;
      scope: 'combat' | 'run' | 'permanent';
      levels: number;
      maxLevel?: number;
      changes: EffectCardUpgradeChange[];
    }
  | { type: 'add_card'; zone: 'hand' | 'draw'; card: GeneratedCardDefinition; count: number }
  | {
      type: 'ensure_card';
      zone: 'hand' | 'draw';
      card: GeneratedCardDefinition;
      minimum: number;
      includeCopies: boolean;
    }
  | {
      type: 'spawn_summon'; target: EffectTarget; summon: EffectSummonDefinition; count: number;
      capacity: number; overflow: SummonOverflowPolicy;
    }
  | { type: 'spawn_enemy'; enemy: EffectEnemySpawnDefinition; count: number; capacity: number }
  | { type: 'damage_summons' | 'heal_summons'; selector: SummonSelector; amount: number }
  | {
      type: 'modify_summons'; selector: SummonSelector; stat: SummonValueStat;
      operator: SummonValueOperator; value: number;
    }
  | {
      type: 'modify_summon_effects'; selector: SummonSelector; stat: CardValueStat;
      operator: CardValueOperator; value: number;
    }
  | { type: 'gain_summon_resource'; selector: SummonSelector; resource: string; amount: number }
  | { type: 'set_summon_resource'; selector: SummonSelector; resource: string; value: number }
  | { type: 'apply_summon_status'; selector: SummonSelector; status: string; stacks: number }
  | { type: 'remove_summon_status'; selector: SummonSelector; status: string }
  | { type: 'activate_summons'; selector: SummonSelector }
  | { type: 'dismiss_summons'; selector: SummonSelector; retainCorpse: boolean }
  | {
      type: 'copy_summons'; selector: SummonSelector; targetOwner: 'same' | EffectTarget;
      capacity: number; overflow: SummonOverflowPolicy;
    }
  | { type: 'summoner_effects'; effects: EffectNode[] }
  | {
      type: 'modify';
      target: EffectTarget;
      stat: ModifierStat;
      operator: EffectModifierOperator;
      value: number;
    }
  | {
      type: 'card_play_rule';
      target: EffectTarget;
      rule: CardPlayRuleKind;
      limit?: number | 'all';
      extra: number;
      selector?: CardSelector;
      destination?: PlayedCardDestination;
      priority: number;
      freeResources?: 'all' | string[];
    }
  | { type: 'set_stance'; target: EffectTarget; stance: EffectStanceDefinition | null }
  | { type: 'channel_orb'; target: EffectTarget; orb: EffectOrbDefinition }
  | { type: 'evoke_orbs'; target: EffectTarget; selector: EffectOrbSelector }
  | { type: 'set_orb_slots'; target: EffectTarget; amount: number }
  | {
      type: 'modify_orbs'; target: EffectTarget; selector: EffectOrbSelector;
      operator: CardValueOperator; value: number;
    }
  | { type: 'grant_extra_turn'; target: EffectTarget; amount: number }
  | { type: 'force_end_turn'; target: EffectTarget }
  | {
      type: 'register_trigger'; target: EffectTarget; trigger: EffectTrigger;
      eventQuery?: EventTriggerQuery; effects: EffectNode[];
    }
  | {
      type: 'schedule_effect';
      afterTurns: number;
      phase: EffectSchedulePhase;
      priority: number;
      repeatEvery?: number;
      repeats?: number;
      effects: EffectNode[];
    }
  | { type: 'choice_selected'; choiceId: string; optionId: string; label: string }
  | { type: 'narration'; text: string };

export type EffectExecutionResult =
  | { ok: true; state: CoreEffectState; events: CoreEffectEvent[] }
  | { ok: false; error: EffectExecutionError; state: CoreEffectState; events: [] };

export class EffectExecutionError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'EffectExecutionError';
  }
}

const MAX_AST_DEPTH = 32;
const MAX_AST_NODES = 256;
const TARGETS = new Set<EffectTarget>(['self', 'opponent']);
const BINARY_NUMBER_OPS = new Set(['add', 'subtract', 'multiply', 'divide']);
const UNARY_NUMBER_OPS = new Set(['negate', 'floor', 'ceil', 'abs']);
const RELATIONS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);
const EFFECT_OPS = new Set([
  'damage',
  'execute',
  'kill',
  'heal',
  'gain_block',
  'gain_energy',
  'gain_resource',
  'set_resource',
  'gain_lust',
  'set_stat',
  'apply_status',
  'remove_status',
  'draw_cards',
  'scry_cards',
  'discard_cards',
  'exhaust_cards',
  'recover_cards',
  'reduce_card_cost',
  'modify_card_value',
  'copy_cards',
  'double_card_effect',
  'auto_play_cards',
  'set_card_destination',
  'move_cards',
  'remove_cards',
  'transform_cards',
  'apply_card_patch',
  'apply_card_attachment',
  'upgrade_cards',
  'add_card',
  'ensure_card',
  'spawn_summon',
  'spawn_enemy',
  'damage_summons',
  'heal_summons',
  'modify_summons',
  'modify_summon_effects',
  'gain_summon_resource',
  'set_summon_resource',
  'apply_summon_status',
  'remove_summon_status',
  'activate_summons',
  'dismiss_summons',
  'copy_summons',
  'summoner_effects',
  'modify',
  'card_play_rule',
  'set_stance',
  'channel_orb',
  'evoke_orbs',
  'set_orb_slots',
  'modify_orbs',
  'grant_extra_turn',
  'force_end_turn',
  'register_trigger',
  'schedule_effect',
  'choose_one',
  'if',
  'narrate',
]);
const CARD_ZONES = new Set<CardZone>(['hand', 'draw', 'discard', 'exhaust', 'all', 'combat']);
const CARD_PICKS = new Set<CardPick>(['random', 'choose', 'left', 'right', 'top', 'bottom', 'all']);
const CARD_TYPES = new Set<CardType>(['Attack', 'Skill', 'Power', 'Event', 'Curse']);
const CARD_RARITIES = new Set<CardRarity>(['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Corrupt']);
const CARD_ORIGINS = new Set<CardOrigin>(['deck', 'generated', 'copied', 'transformed']);
const CARD_PATCH_SCOPES = new Set<CardPatchScope>(['resolution', 'turn', 'until_played', 'combat', 'run', 'permanent']);
const CARD_PATCH_MATCHES = new Set<CardPatchMatch>(['instance', 'run_instance', 'template', 'filter']);
const CARD_COST_OPERATORS = new Set<CardCostOperator>(['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max']);
const CARD_KEYWORDS = new Set<CardKeyword>(['retain', 'exhaust', 'ethereal', 'innate']);
const MODIFIER_STATS = new Set<ModifierStat>(['damage', 'damage_taken', 'lust', 'lust_taken', 'heal', 'block', 'summon_capacity']);
const MODIFIER_OPERATORS = new Set<EffectModifierOperator>(['add', 'subtract', 'multiply', 'divide', 'set']);
const CARD_VALUE_STATS = new Set<CardValueStat>(['damage', 'block', 'lust', 'stacks']);
const CARD_VALUE_OPERATORS = new Set<CardValueOperator>(['add', 'subtract', 'multiply', 'divide']);
const CARD_PLAY_RULES = new Set<CardPlayRuleKind>([
  'replay', 'free', 'retain_hand', 'retain_block', 'limit_draw', 'limit_block_gain',
  'limit_energy_gain', 'deny_card_play', 'allow_card_play', 'limit_card_play', 'card_destination',
]);
const STATUS_ID_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function isComparisonCondition(value: ConditionExpression): value is ComparisonCondition {
  return value.op === 'compare';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function addIssue(issues: EffectValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  issues: EffectValidationIssue[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) addIssue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', `未知字段: ${key}`);
  }
}

const HISTORY_SCOPES: readonly HistoryScope[] = ['turn', 'combat', 'run', 'card_instance', 'team'];
const HISTORY_METRICS: readonly EventHistoryMetric[] = [
  'count', 'last_damage', 'last_hp_loss', 'last_heal', 'last_resource_spent', 'last_turn', 'last_sequence',
];

function validateEventFilter(value: unknown, path: string, issues: EffectValidationIssue[]): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'INVALID_EVENT_FILTER', 'event filter must be an object');
    return;
  }
  rejectUnknownKeys(
    value,
    ['kind', 'phase', 'sourceKind', 'sourceId', 'reason', 'cardType', 'templateId', 'cardInstanceId', 'damageKind', 'actorId', 'targetId'],
    path,
    issues,
  );
  if (value.kind !== undefined && !BATTLE_EVENT_KINDS.includes(value.kind as never))
    addIssue(issues, `${path}.kind`, 'INVALID_EVENT_KIND', `unsupported event kind: ${String(value.kind)}`);
  if (value.phase !== undefined && !BATTLE_EVENT_PHASES.includes(value.phase as never))
    addIssue(issues, `${path}.phase`, 'INVALID_EVENT_PHASE', `unsupported event phase: ${String(value.phase)}`);
  if (value.sourceKind !== undefined && !EVENT_SOURCE_KINDS.includes(value.sourceKind as never))
    addIssue(issues, `${path}.sourceKind`, 'INVALID_EVENT_SOURCE', `unsupported event source kind: ${String(value.sourceKind)}`);
  if (value.damageKind !== undefined && !DAMAGE_KINDS.includes(value.damageKind as never))
    addIssue(issues, `${path}.damageKind`, 'INVALID_DAMAGE_KIND', `unsupported damage kind: ${String(value.damageKind)}`);
  for (const field of ['sourceId', 'reason', 'cardType', 'templateId', 'cardInstanceId', 'actorId', 'targetId']) {
    const entry = value[field];
    if (entry !== undefined && (typeof entry !== 'string' || !entry.trim()))
      addIssue(issues, `${path}.${field}`, 'INVALID_EVENT_FILTER', `${field} must be a non-empty string`);
  }
}

function validateEventQuery(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  options: { metric?: boolean; ordinal?: boolean } = {},
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'INVALID_EVENT_QUERY', 'event query must be an object');
    return;
  }
  const allowed = ['scope', 'turn', 'cardInstanceId', 'teamActorIds', 'filter'];
  if (options.metric) allowed.push('metric');
  if (options.ordinal) allowed.push('ordinal', 'n');
  const outerAllowed = options.metric ? ['op', ...allowed] : allowed;
  rejectUnknownKeys(value, outerAllowed, path, issues);
  if (value.scope !== undefined && !HISTORY_SCOPES.includes(value.scope as never))
    addIssue(issues, `${path}.scope`, 'INVALID_HISTORY_SCOPE', `unsupported history scope: ${String(value.scope)}`);
  if (value.turn !== undefined && (!Number.isInteger(value.turn) || Number(value.turn) < 0))
    addIssue(issues, `${path}.turn`, 'INVALID_HISTORY_TURN', 'history turn must be a non-negative integer');
  if (value.cardInstanceId !== undefined && (typeof value.cardInstanceId !== 'string' || !value.cardInstanceId.trim()))
    addIssue(issues, `${path}.cardInstanceId`, 'INVALID_HISTORY_CARD', 'cardInstanceId must be a non-empty string');
  if (value.teamActorIds !== undefined && (
    !Array.isArray(value.teamActorIds) || value.teamActorIds.length < 1 ||
    value.teamActorIds.some(entry => typeof entry !== 'string' || !entry.trim())
  )) addIssue(issues, `${path}.teamActorIds`, 'INVALID_HISTORY_TEAM', 'teamActorIds must contain non-empty ids');
  if (value.filter !== undefined) validateEventFilter(value.filter, `${path}.filter`, issues);
  if (options.metric && !HISTORY_METRICS.includes(value.metric as never))
    addIssue(issues, `${path}.metric`, 'INVALID_HISTORY_METRIC', `unsupported history metric: ${String(value.metric)}`);
  if (options.ordinal && value.ordinal !== undefined && !['first', 'nth', 'every_n'].includes(String(value.ordinal)))
    addIssue(issues, `${path}.ordinal`, 'INVALID_EVENT_ORDINAL', `unsupported event ordinal: ${String(value.ordinal)}`);
  if (options.ordinal) {
    const needsN = value.ordinal === 'nth' || value.ordinal === 'every_n';
    if (needsN && (!Number.isInteger(value.n) || Number(value.n) < 1))
      addIssue(issues, `${path}.n`, 'INVALID_EVENT_ORDINAL', 'nth/every_n require a positive integer n');
    if (!needsN && value.n !== undefined)
      addIssue(issues, `${path}.n`, 'INVALID_EVENT_ORDINAL', 'n is only valid with nth/every_n');
  }
}

function validateNumericExpression(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  counter.value += 1;
  if (counter.value > MAX_AST_NODES)
    return addIssue(issues, path, 'TOO_MANY_NODES', `AST 节点不能超过 ${MAX_AST_NODES}`);
  if (depth > MAX_AST_DEPTH) return addIssue(issues, path, 'TOO_DEEP', `AST 深度不能超过 ${MAX_AST_DEPTH}`);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) addIssue(issues, path, 'NON_FINITE_NUMBER', '数字必须是有限值');
    return;
  }
  if (!isRecord(value) || typeof value.op !== 'string') {
    addIssue(issues, path, 'INVALID_NUMBER_EXPRESSION', '数值必须是有限数字或数值表达式对象');
    return;
  }
  if (value.op === 'var') {
    rejectUnknownKeys(value, ['op', 'path'], path, issues);
    if (typeof value.path !== 'string' || value.path.trim() === '')
      addIssue(issues, `${path}.path`, 'INVALID_VARIABLE_PATH', '变量路径必须是非空字符串');
    else if (!isSupportedVariablePath(value.path))
      addIssue(issues, `${path}.path`, 'UNKNOWN_VARIABLE', `不支持的变量路径: ${value.path}`);
    return;
  }
  if (BINARY_NUMBER_OPS.has(value.op)) {
    rejectUnknownKeys(value, ['op', 'left', 'right'], path, issues);
    validateNumericExpression(value.left, `${path}.left`, issues, depth + 1, counter);
    validateNumericExpression(value.right, `${path}.right`, issues, depth + 1, counter);
    return;
  }
  if (UNARY_NUMBER_OPS.has(value.op)) {
    rejectUnknownKeys(value, ['op', 'value'], path, issues);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
    return;
  }
  if (value.op === 'clamp_min') {
    rejectUnknownKeys(value, ['op', 'value', 'minimum'], path, issues);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
    if (typeof value.minimum !== 'number' || !Number.isFinite(value.minimum)) {
      addIssue(issues, `${path}.minimum`, 'NON_FINITE_NUMBER', 'clamp_min minimum 必须是有限数字');
    }
    return;
  }
  if (value.op === 'min' || value.op === 'max') {
    rejectUnknownKeys(value, ['op', 'values'], path, issues);
    if (!Array.isArray(value.values) || value.values.length < 1 || value.values.length > 32)
      addIssue(issues, `${path}.values`, 'INVALID_NUMBER_EXPRESSION', 'min/max 需要 1 到 32 个数值');
    else value.values.forEach((entry, index) => validateNumericExpression(entry, `${path}.values[${index}]`, issues, depth + 1, counter));
    return;
  }
  if (value.op === 'count_cards') {
    rejectUnknownKeys(value, ['op', 'selector'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    return;
  }
  if (value.op === 'count_statuses') {
    rejectUnknownKeys(value, ['op', 'target'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    return;
  }
  if (value.op === 'history') {
    validateEventQuery(value, path, issues, { metric: true });
    return;
  }
  if (value.op === 'intent_value') {
    rejectUnknownKeys(value, ['op'], path, issues);
    return;
  }
  addIssue(issues, `${path}.op`, 'UNKNOWN_NUMBER_OPERATOR', `不支持的数值运算: ${value.op}`);
}

function validateCondition(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  counter.value += 1;
  if (counter.value > MAX_AST_NODES)
    return addIssue(issues, path, 'TOO_MANY_NODES', `AST 节点不能超过 ${MAX_AST_NODES}`);
  if (depth > MAX_AST_DEPTH) return addIssue(issues, path, 'TOO_DEEP', `AST 深度不能超过 ${MAX_AST_DEPTH}`);
  if (!isRecord(value) || typeof value.op !== 'string')
    return addIssue(issues, path, 'INVALID_CONDITION', '条件必须是带 op 字段的对象');
  if (value.op === 'compare') {
    rejectUnknownKeys(value, ['op', 'relation', 'left', 'right'], path, issues);
    if (typeof value.relation !== 'string' || !RELATIONS.has(value.relation))
      addIssue(issues, `${path}.relation`, 'UNKNOWN_RELATION', `不支持的比较关系: ${String(value.relation)}`);
    validateNumericExpression(value.left, `${path}.left`, issues, depth + 1, counter);
    validateNumericExpression(value.right, `${path}.right`, issues, depth + 1, counter);
    return;
  }
  if (value.op === 'all' || value.op === 'any') {
    rejectUnknownKeys(value, ['op', 'conditions'], path, issues);
    if (!Array.isArray(value.conditions) || value.conditions.length === 0)
      return addIssue(issues, `${path}.conditions`, 'EMPTY_CONDITIONS', 'all/any 至少需要一个条件');
    value.conditions.forEach((condition, index) =>
      validateCondition(condition, `${path}.conditions[${index}]`, issues, depth + 1, counter),
    );
    return;
  }
  if (value.op === 'not') {
    rejectUnknownKeys(value, ['op', 'condition'], path, issues);
    validateCondition(value.condition, `${path}.condition`, issues, depth + 1, counter);
    return;
  }
  if (value.op === 'last_card_type') {
    rejectUnknownKeys(value, ['op', 'cardType'], path, issues);
    if (!CARD_TYPES.has(value.cardType as CardType))
      addIssue(issues, `${path}.cardType`, 'INVALID_CARD_TYPE', `不支持的卡牌类型: ${String(value.cardType)}`);
    return;
  }
  if (value.op === 'intent_type') {
    rejectUnknownKeys(value, ['op', 'intentType'], path, issues);
    if (typeof value.intentType !== 'string' || !value.intentType.trim())
      addIssue(issues, `${path}.intentType`, 'INVALID_INTENT_TYPE', '敌方意图类型必须是非空字符串');
    return;
  }
  addIssue(issues, `${path}.op`, 'UNKNOWN_CONDITION_OPERATOR', `不支持的条件运算: ${value.op}`);
}

function validateCardSelector(value: unknown, path: string, issues: EffectValidationIssue[]): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_CARD_SELECTOR', '卡牌选择器必须是对象');
  rejectUnknownKeys(value, ['zone', 'pick', 'count', 'filter'], path, issues);
  if (!CARD_ZONES.has(value.zone as CardZone))
    addIssue(issues, `${path}.zone`, 'INVALID_CARD_ZONE', `不支持的牌区: ${String(value.zone)}`);
  if (!CARD_PICKS.has(value.pick as CardPick))
    addIssue(issues, `${path}.pick`, 'INVALID_CARD_PICK', `不支持的选择方式: ${String(value.pick)}`);
  if (
    value.count !== undefined &&
    (!Number.isInteger(value.count) || (value.count as number) < 1 || (value.count as number) > 100)
  ) {
    addIssue(issues, `${path}.count`, 'INVALID_CARD_COUNT', '选择数量必须是 1 到 100 的整数');
  }
  if ((value.pick === 'left' || value.pick === 'right') && value.zone !== 'hand')
    addIssue(issues, path, 'INVALID_CARD_SELECTOR', '左侧/右侧选择只适用于手牌');
  if ((value.pick === 'top' || value.pick === 'bottom') && !['draw', 'discard', 'exhaust'].includes(String(value.zone)))
    addIssue(issues, path, 'INVALID_CARD_SELECTOR', '顶部/底部选择只适用于抽牌堆、弃牌堆或消耗堆');
  if ((value.zone === 'all' || value.zone === 'combat') && value.pick !== 'all')
    addIssue(issues, path, 'INVALID_CARD_SELECTOR', '跨全部牌区时只能选择全部卡牌');
  if (value.pick === 'all' && value.count !== undefined)
    addIssue(issues, `${path}.count`, 'INVALID_CARD_COUNT', '选择全部卡牌时不能再指定数量');
  if (value.filter !== undefined) validateCardSelectorFilter(value.filter, `${path}.filter`, issues);
}

function validateStringList(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string> | null,
  issues: EffectValidationIssue[],
): void {
  if (!Array.isArray(value) || value.length === 0 || value.some(entry => typeof entry !== 'string' || !entry.trim())) {
    addIssue(issues, path, 'INVALID_CARD_FILTER', '过滤列表必须是非空字符串数组');
    return;
  }
  if (allowed && value.some(entry => !allowed.has(entry))) {
    addIssue(issues, path, 'INVALID_CARD_FILTER', `过滤列表包含不支持的值: ${value.join(',')}`);
  }
}

function validateCardSelectorFilter(value: unknown, path: string, issues: EffectValidationIssue[]): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_CARD_FILTER', '卡牌过滤器必须是对象');
  rejectUnknownKeys(
    value,
    ['name', 'types', 'rarities', 'cost', 'minCost', 'maxCost', 'tags', 'templateId', 'runInstanceId', 'combatInstanceId', 'origin', 'upgraded', 'rootOnly'],
    path,
    issues,
  );
  if (value.types !== undefined) validateStringList(value.types, `${path}.types`, CARD_TYPES, issues);
  if (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim()))
    addIssue(issues, `${path}.name`, 'INVALID_CARD_FILTER', '同名卡过滤值必须是非空字符串');
  if (value.rarities !== undefined) validateStringList(value.rarities, `${path}.rarities`, CARD_RARITIES, issues);
  if (value.tags !== undefined) validateStringList(value.tags, `${path}.tags`, null, issues);
  if (value.cost !== undefined) {
    const costIssue = validateCardCost(value.cost);
    if (costIssue) addIssue(issues, `${path}.cost`, 'INVALID_CARD_FILTER', costIssue);
  }
  for (const key of ['minCost', 'maxCost'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0))
      addIssue(issues, `${path}.${key}`, 'INVALID_CARD_FILTER', '费用边界必须是非负有限数值');
  }
  if (typeof value.minCost === 'number' && typeof value.maxCost === 'number' && value.minCost > value.maxCost)
    addIssue(issues, path, 'INVALID_CARD_FILTER', '最低费用不能高于最高费用');
  for (const key of ['templateId', 'runInstanceId', 'combatInstanceId'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !value[key].trim()))
      addIssue(issues, `${path}.${key}`, 'INVALID_CARD_FILTER', '身份过滤值必须是非空字符串');
  }
  if (value.origin !== undefined && !CARD_ORIGINS.has(value.origin as CardOrigin))
    addIssue(issues, `${path}.origin`, 'INVALID_CARD_FILTER', `不支持的卡牌来源: ${String(value.origin)}`);
  if (value.upgraded !== undefined && typeof value.upgraded !== 'boolean')
    addIssue(issues, `${path}.upgraded`, 'INVALID_CARD_FILTER', '升级过滤必须是布尔值');
  if (value.rootOnly !== undefined && typeof value.rootOnly !== 'boolean')
    addIssue(issues, `${path}.rootOnly`, 'INVALID_CARD_FILTER', '根实例过滤必须是布尔值');
}

function validateEffectCardPatch(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_CARD_PATCH', '卡牌补丁必须是对象');
  const common = ['kind', 'scope', 'match', 'includeFutureCopies'];
  if (!CARD_PATCH_SCOPES.has(value.scope as CardPatchScope))
    addIssue(issues, `${path}.scope`, 'INVALID_CARD_PATCH_SCOPE', `不支持的补丁作用域: ${String(value.scope)}`);
  if (value.match !== undefined && !CARD_PATCH_MATCHES.has(value.match as CardPatchMatch))
    addIssue(issues, `${path}.match`, 'INVALID_CARD_PATCH_MATCH', `不支持的补丁目标范围: ${String(value.match)}`);
  if (value.includeFutureCopies !== undefined && typeof value.includeFutureCopies !== 'boolean')
    addIssue(issues, `${path}.includeFutureCopies`, 'INVALID_CARD_PATCH', 'includeFutureCopies 必须是布尔值');
  if (value.includeFutureCopies === true && value.match !== 'template' && value.match !== 'filter')
    addIssue(issues, `${path}.includeFutureCopies`, 'INVALID_CARD_PATCH_MATCH', '未来副本只适用于模板或过滤器范围');

  if (value.kind === 'numeric') {
    rejectUnknownKeys(value, [...common, 'stat', 'operator', 'value'], path, issues);
    if (!CARD_VALUE_STATS.has(value.stat as CardValueStat))
      addIssue(issues, `${path}.stat`, 'INVALID_CARD_VALUE_STAT', `不支持的卡牌数值类型: ${String(value.stat)}`);
    if (!CARD_VALUE_OPERATORS.has(value.operator as CardValueOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_CARD_VALUE_OPERATOR', `不支持的数值补丁运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
    if (value.operator === 'divide' && value.value === 0)
      addIssue(issues, `${path}.value`, 'DIVISION_BY_ZERO', '卡牌补丁不能除以 0');
  } else if (value.kind === 'cost') {
    rejectUnknownKeys(value, [...common, 'operator', 'value'], path, issues);
    if (!CARD_COST_OPERATORS.has(value.operator as CardCostOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_CARD_COST_OPERATOR', `不支持的费用补丁运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
    if (value.operator === 'divide' && value.value === 0)
      addIssue(issues, `${path}.value`, 'DIVISION_BY_ZERO', '费用补丁不能除以 0');
  } else if (value.kind === 'keyword') {
    rejectUnknownKeys(value, [...common, 'keyword', 'enabled'], path, issues);
    if (!CARD_KEYWORDS.has(value.keyword as CardKeyword))
      addIssue(issues, `${path}.keyword`, 'INVALID_CARD_KEYWORD', `不支持的卡牌关键词: ${String(value.keyword)}`);
    if (typeof value.enabled !== 'boolean')
      addIssue(issues, `${path}.enabled`, 'INVALID_CARD_PATCH', '关键词补丁 enabled 必须是布尔值');
  } else if (value.kind === 'replay') {
    rejectUnknownKeys(value, [...common, 'extra'], path, issues);
    validateNumericExpression(value.extra, `${path}.extra`, issues, depth + 1, counter);
  } else if (value.kind === 'x_value') {
    rejectUnknownKeys(value, [...common, 'operator', 'value'], path, issues);
    if (!CARD_COST_OPERATORS.has(value.operator as CardCostOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_X_VALUE_OPERATOR', `不支持的X值补丁运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
    if (value.operator === 'divide' && value.value === 0)
      addIssue(issues, `${path}.value`, 'DIVISION_BY_ZERO', 'X值补丁不能除以 0');
  } else if (value.kind === 'dynamic_cost') {
    rejectUnknownKeys(value, [...common, 'timing', 'operator', 'value', 'minimum', 'maximum'], path, issues);
    if (!['on_draw', 'while_in_hand', 'on_play'].includes(String(value.timing)))
      addIssue(issues, `${path}.timing`, 'INVALID_DYNAMIC_COST_TIMING', `不支持的动态费用时机: ${String(value.timing)}`);
    if (!CARD_COST_OPERATORS.has(value.operator as CardCostOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_CARD_COST_OPERATOR', `不支持的动态费用运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
    if (value.operator === 'divide' && value.value === 0)
      addIssue(issues, `${path}.value`, 'DIVISION_BY_ZERO', '动态费用补丁不能除以 0');
    if (value.minimum !== undefined && (typeof value.minimum !== 'number' || !Number.isFinite(value.minimum)))
      addIssue(issues, `${path}.minimum`, 'INVALID_DYNAMIC_COST_BOUND', '动态费用下限必须是有限数值');
    if (value.maximum !== undefined && (typeof value.maximum !== 'number' || !Number.isFinite(value.maximum)))
      addIssue(issues, `${path}.maximum`, 'INVALID_DYNAMIC_COST_BOUND', '动态费用上限必须是有限数值');
    if (typeof value.minimum === 'number' && typeof value.maximum === 'number' && value.minimum > value.maximum)
      addIssue(issues, path, 'INVALID_DYNAMIC_COST_BOUND', '动态费用下限不能大于上限');
  } else {
    rejectUnknownKeys(value, common, path, issues);
    addIssue(issues, `${path}.kind`, 'INVALID_CARD_PATCH', `不支持的卡牌补丁类型: ${String(value.kind)}`);
  }
}

function validateEffectCardUpgradeChange(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_CARD_UPGRADE', '升级变化必须是对象');
  const common = { ...value, scope: 'combat' };
  if (value.kind === 'numeric') rejectUnknownKeys(value, ['kind', 'stat', 'operator', 'value'], path, issues);
  else if (value.kind === 'cost' || value.kind === 'x_value') rejectUnknownKeys(value, ['kind', 'operator', 'value'], path, issues);
  else if (value.kind === 'keyword') rejectUnknownKeys(value, ['kind', 'keyword', 'enabled'], path, issues);
  else if (value.kind === 'replay') rejectUnknownKeys(value, ['kind', 'extra'], path, issues);
  else if (value.kind === 'dynamic_cost') rejectUnknownKeys(value, ['kind', 'timing', 'operator', 'value', 'minimum', 'maximum'], path, issues);
  else rejectUnknownKeys(value, ['kind'], path, issues);
  validateEffectCardPatch(common, path, issues, depth, counter);
}

const CARD_MOVE_REASONS = new Set<CardMoveReason>([
  'player_choice', 'random_effect', 'effect', 'turn_cleanup', 'scry', 'recover', 'exhaust',
  'generate', 'copy', 'transform', 'auto_play', 'other',
]);
const CARD_ATTACHMENT_REMOVALS = new Set<CardAttachmentRemovalEvent>([
  'played', 'discarded', 'turn_end', 'combat_end', 'run_end', 'manual',
]);

function validateEffectCardAttachment(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_CARD_ATTACHMENT', '卡牌附着包必须是对象');
  rejectUnknownKeys(value, [
    'id', 'kind', 'name', 'description', 'emoji', 'scope', 'removeOn', 'remaining',
    'discardReasons', 'priority', 'changes',
  ], path, issues);
  if (typeof value.id !== 'string' || !STATUS_ID_PATTERN.test(value.id))
    addIssue(issues, `${path}.id`, 'INVALID_CARD_ATTACHMENT_ID', '卡牌附着包需要稳定英文 ID');
  if (value.kind !== 'enchantment' && value.kind !== 'affliction')
    addIssue(issues, `${path}.kind`, 'INVALID_CARD_ATTACHMENT_KIND', 'kind 只能是 enchantment 或 affliction');
  if (typeof value.name !== 'string' || !value.name.trim())
    addIssue(issues, `${path}.name`, 'INVALID_CARD_ATTACHMENT_NAME', '卡牌附着包需要非空名称');
  if (value.description !== undefined && (typeof value.description !== 'string' || !value.description.trim()))
    addIssue(issues, `${path}.description`, 'INVALID_CARD_ATTACHMENT_DESCRIPTION', 'description 必须是非空文本');
  if (value.emoji !== undefined && (typeof value.emoji !== 'string' || !value.emoji.trim()))
    addIssue(issues, `${path}.emoji`, 'INVALID_CARD_ATTACHMENT_EMOJI', 'emoji 必须是非空文本');
  if (!CARD_PATCH_SCOPES.has(value.scope as CardPatchScope))
    addIssue(issues, `${path}.scope`, 'INVALID_CARD_PATCH_SCOPE', '卡牌附着包作用域无效');
  if (value.removeOn !== undefined && !CARD_ATTACHMENT_REMOVALS.has(value.removeOn as CardAttachmentRemovalEvent))
    addIssue(issues, `${path}.removeOn`, 'INVALID_CARD_ATTACHMENT_REMOVAL', '卡牌附着包移除时机无效');
  if (value.remaining !== undefined && (!Number.isInteger(value.remaining) || Number(value.remaining) < 1 || Number(value.remaining) > 999))
    addIssue(issues, `${path}.remaining`, 'INVALID_CARD_ATTACHMENT_DURATION', 'remaining 必须是 1 到 999 的整数');
  if (value.priority !== undefined && (!Number.isInteger(value.priority) || Math.abs(Number(value.priority)) > 100000))
    addIssue(issues, `${path}.priority`, 'INVALID_CARD_ATTACHMENT_PRIORITY', 'priority 必须是合法整数');
  if (value.discardReasons !== undefined) {
    if (value.removeOn !== 'discarded')
      addIssue(issues, `${path}.discardReasons`, 'INVALID_CARD_ATTACHMENT_REMOVAL', 'discardReasons 只用于 discarded 移除时机');
    if (!Array.isArray(value.discardReasons) || value.discardReasons.length < 1 ||
      value.discardReasons.some(reason => !CARD_MOVE_REASONS.has(reason as CardMoveReason)) ||
      new Set(value.discardReasons).size !== value.discardReasons.length)
      addIssue(issues, `${path}.discardReasons`, 'INVALID_DISCARD_REASON', 'discardReasons 必须是非空且不重复的合法原因数组');
  }
  if (!Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > 32) {
    addIssue(issues, `${path}.changes`, 'INVALID_CARD_ATTACHMENT', '附着包必须包含 1 到 32 项变化');
    return;
  }
  value.changes.forEach((change, index) => {
    const changePath = `${path}.changes[${index}]`;
    if (!isRecord(change)) return addIssue(issues, changePath, 'INVALID_CARD_ATTACHMENT', '附着变化必须是对象');
    if (change.kind === 'play_access') {
      rejectUnknownKeys(change, ['kind', 'mode'], changePath, issues);
      if (change.mode !== 'deny' && change.mode !== 'allow')
        addIssue(issues, `${changePath}.mode`, 'INVALID_CARD_PLAY_RULE', 'play_access mode 只能是 deny 或 allow');
      return;
    }
    if (change.kind === 'discard_auto_play') {
      rejectUnknownKeys(change, ['kind', 'reasons', 'failureDestination', 'onlyPlayerTurn'], changePath, issues);
      if (!Array.isArray(change.reasons) || change.reasons.length < 1 ||
        change.reasons.some(reason => !CARD_MOVE_REASONS.has(reason as CardMoveReason)) ||
        new Set(change.reasons).size !== change.reasons.length)
        addIssue(issues, `${changePath}.reasons`, 'INVALID_DISCARD_REASON', '弃牌自动打出需要合法且不重复的原因数组');
      if (!['discard', 'exhaust', 'draw_top', 'draw_bottom', 'hand', 'remove'].includes(String(change.failureDestination)))
        addIssue(issues, `${changePath}.failureDestination`, 'INVALID_CARD_DESTINATION', '自动打出失败去向无效');
      if (typeof change.onlyPlayerTurn !== 'boolean')
        addIssue(issues, `${changePath}.onlyPlayerTurn`, 'INVALID_CARD_ATTACHMENT', 'onlyPlayerTurn 必须是布尔值');
      return;
    }
    validateEffectCardUpgradeChange(change, changePath, issues, depth + 1, counter);
  });
}

function validateGeneratedCard(value: unknown, path: string, issues: EffectValidationIssue[]): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_GENERATED_CARD', '生成卡牌必须是对象');
  rejectUnknownKeys(
    value,
    [
      'id',
      'name',
      'emoji',
      'type',
      'rarity',
      'cost',
      'description',
      'program',
      'discardProgram',
      'retain',
      'exhaust',
      'ethereal',
    ],
    path,
    issues,
  );
  if (typeof value.id !== 'string' || !STATUS_ID_PATTERN.test(value.id))
    addIssue(issues, `${path}.id`, 'INVALID_CARD_ID', `生成卡牌 ID 无效: ${String(value.id)}`);
  if (typeof value.name !== 'string' || !value.name.trim())
    addIssue(issues, `${path}.name`, 'INVALID_CARD_NAME', '生成卡牌名称不能为空');
  if (typeof value.emoji !== 'string') addIssue(issues, `${path}.emoji`, 'INVALID_CARD_EMOJI', 'emoji 必须是字符串');
  if (!['Attack', 'Skill', 'Power', 'Event', 'Curse'].includes(String(value.type)))
    addIssue(issues, `${path}.type`, 'INVALID_CARD_TYPE', `不支持的卡牌类型: ${String(value.type)}`);
  if (!['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Corrupt'].includes(String(value.rarity)))
    addIssue(issues, `${path}.rarity`, 'INVALID_CARD_RARITY', `不支持的稀有度: ${String(value.rarity)}`);
  if (value.type === 'Curse') {
    if (value.cost !== undefined) addIssue(issues, `${path}.cost`, 'INVALID_CARD_COST', 'Curse 不能带 cost');
  } else {
    const costIssue = validateCardCost(value.cost);
    if (costIssue) addIssue(issues, `${path}.cost`, 'INVALID_CARD_COST', costIssue);
  }
  if (typeof value.description !== 'string')
    addIssue(issues, `${path}.description`, 'INVALID_CARD_DESCRIPTION', 'description 必须是字符串');
  for (const flag of ['retain', 'exhaust', 'ethereal'] as const) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean')
      addIssue(issues, `${path}.${flag}`, 'INVALID_CARD_FLAG', `${flag} 必须是布尔值`);
  }
  const program = validateEffectProgram(value.program);
  if (!program.ok) {
    program.issues.forEach(issue =>
      addIssue(issues, `${path}.program${issue.path === '$' ? '' : issue.path.slice(1)}`, issue.code, issue.message),
    );
  }
  if (value.discardProgram !== undefined) {
    const discardProgram = validateEffectProgram(value.discardProgram);
    if (!discardProgram.ok) {
      discardProgram.issues.forEach(issue =>
        addIssue(
          issues,
          `${path}.discardProgram${issue.path === '$' ? '' : issue.path.slice(1)}`,
          issue.code,
          issue.message,
        ),
      );
    }
  }
}

function validateEnemyTargetSelector(value: unknown, path: string, issues: EffectValidationIssue[]): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_TARGET_SELECTOR', '敌人目标选择器必须是对象');
  const mode = value.mode;
  const modes = new Set(['active', 'by_id', 'all', 'random', 'random_n', 'lowest_hp', 'highest_hp']);
  if (!modes.has(String(mode)))
    addIssue(issues, `${path}.mode`, 'INVALID_TARGET_SELECTOR', `不支持的敌人目标模式：${String(mode)}`);
  const randomMode = mode === 'random' || mode === 'random_n';
  rejectUnknownKeys(
    value,
    mode === 'by_id'
      ? ['mode', 'id']
      : randomMode
        ? ['mode', 'count', 'allowRepeat', 'retarget']
        : ['mode'],
    path,
    issues,
  );
  if (mode === 'by_id' && (typeof value.id !== 'string' || !value.id.trim()))
    addIssue(issues, `${path}.id`, 'INVALID_TARGET_SELECTOR', '指定目标必须提供非空敌人 ID');
  if (mode === 'random_n' && (!Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > 100))
    addIssue(issues, `${path}.count`, 'INVALID_TARGET_SELECTOR', '随机目标次数必须是 1 到 100 的整数');
  if (value.allowRepeat !== undefined && typeof value.allowRepeat !== 'boolean')
    addIssue(issues, `${path}.allowRepeat`, 'INVALID_TARGET_SELECTOR', 'allowRepeat 必须是布尔值');
  if (value.retarget !== undefined && value.retarget !== 'locked' && value.retarget !== 'each_hit')
    addIssue(issues, `${path}.retarget`, 'INVALID_TARGET_SELECTOR', 'retarget 只能是 locked 或 each_hit');
}

function validateTargetSelectorForNode(value: Record<string, any>, path: string, issues: EffectValidationIssue[]): void {
  if (value.targetSelector === undefined) return;
  if (value.target !== 'opponent' && value.target !== 'self')
    addIssue(issues, `${path}.targetSelector`, 'INVALID_TARGET_SELECTOR', '实体集合选择器必须绑定 self 或 opponent');
  validateEnemyTargetSelector(value.targetSelector, `${path}.targetSelector`, issues);
}

function validateNestedEffectList(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'INVALID_EFFECT_LIST', '嵌套效果必须是数组');
    return;
  }
  if (value.length > 64) {
    addIssue(issues, path, 'TOO_MANY_EFFECTS', '嵌套效果不能超过 64 项');
    return;
  }
  value.forEach((effect, index) => validateEffectNode(effect, `${path}[${index}]`, issues, depth + 1, counter));
}

function validateStanceDefinition(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_STANCE', '姿态必须是对象或 null');
  rejectUnknownKeys(value, ['id', 'name', 'emoji', 'description', 'enterEffects', 'exitEffects', 'passiveEffects'], path, issues);
  if (typeof value.id !== 'string' || !STATUS_ID_PATTERN.test(value.id))
    addIssue(issues, `${path}.id`, 'INVALID_STANCE_ID', '姿态必须使用稳定英文 ID');
  if (typeof value.name !== 'string' || !value.name.trim())
    addIssue(issues, `${path}.name`, 'INVALID_STANCE_NAME', '姿态名称不能为空');
  if (value.emoji !== undefined && typeof value.emoji !== 'string')
    addIssue(issues, `${path}.emoji`, 'INVALID_STANCE_EMOJI', '姿态图标必须是文本');
  if (value.description !== undefined && typeof value.description !== 'string')
    addIssue(issues, `${path}.description`, 'INVALID_STANCE_DESCRIPTION', '姿态说明必须是文本');
  for (const field of ['enterEffects', 'exitEffects', 'passiveEffects'] as const) {
    if (value[field] !== undefined)
      validateNestedEffectList(value[field], `${path}.${field}`, issues, depth, counter);
  }
  if (Array.isArray(value.passiveEffects)) {
    const isContinuous = (node: unknown): boolean => {
      if (!isRecord(node)) return false;
      if (node.op === 'modify' || node.op === 'card_play_rule') return true;
      if (node.op !== 'if' || !Array.isArray(node.then)) return false;
      return node.then.every(isContinuous) && (!Array.isArray(node.else) || node.else.every(isContinuous));
    };
    value.passiveEffects.forEach((effect, index) => {
      if (!isContinuous(effect)) {
        addIssue(
          issues,
          `${path}.passiveEffects[${index}]`,
          'INVALID_STANCE_PASSIVE',
          '姿态持续效果只能包含持续修饰符或出牌规则',
        );
      }
    });
  }
}

function validateOrbDefinition(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_ORB', 'Orb 必须是对象');
  rejectUnknownKeys(value, ['id', 'name', 'emoji', 'description', 'value', 'passiveEffects', 'evokeEffects'], path, issues);
  if (typeof value.id !== 'string' || !STATUS_ID_PATTERN.test(value.id))
    addIssue(issues, `${path}.id`, 'INVALID_ORB_ID', 'Orb 必须使用稳定英文 ID');
  if (typeof value.name !== 'string' || !value.name.trim())
    addIssue(issues, `${path}.name`, 'INVALID_ORB_NAME', 'Orb 名称不能为空');
  if (value.emoji !== undefined && typeof value.emoji !== 'string')
    addIssue(issues, `${path}.emoji`, 'INVALID_ORB_EMOJI', 'Orb 图标必须是文本');
  if (value.description !== undefined && typeof value.description !== 'string')
    addIssue(issues, `${path}.description`, 'INVALID_ORB_DESCRIPTION', 'Orb 说明必须是文本');
  validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  for (const field of ['passiveEffects', 'evokeEffects'] as const) {
    if (value[field] !== undefined)
      validateNestedEffectList(value[field], `${path}.${field}`, issues, depth, counter);
  }
}

function validateOrbSelector(value: unknown, path: string, issues: EffectValidationIssue[]): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_ORB_SELECTOR', 'Orb 选择器必须是对象');
  rejectUnknownKeys(value, ['pick', 'count', 'id'], path, issues);
  if (!['first', 'last', 'all'].includes(String(value.pick)))
    addIssue(issues, `${path}.pick`, 'INVALID_ORB_PICK', 'Orb 选择方式必须是 first、last 或 all');
  if (value.count !== undefined && (!Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > 100))
    addIssue(issues, `${path}.count`, 'INVALID_ORB_COUNT', 'Orb 数量必须是 1 到 100 的整数');
  if (value.pick === 'all' && value.count !== undefined)
    addIssue(issues, `${path}.count`, 'INVALID_ORB_COUNT', '选择全部 Orb 时不能提供 count');
  if (value.id !== undefined && (typeof value.id !== 'string' || !STATUS_ID_PATTERN.test(value.id)))
    addIssue(issues, `${path}.id`, 'INVALID_ORB_ID', 'Orb 过滤 ID 必须是稳定英文 ID');
}

function validateSummonSelector(value: unknown, path: string, issues: EffectValidationIssue[]): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_SUMMON_SELECTOR', '召唤单位选择器必须是对象');
  rejectUnknownKeys(value, ['owner', 'pick', 'count', 'id', 'templateId', 'tags', 'slot', 'includeUntargetable'], path, issues);
  if (!['self', 'opponent', 'any'].includes(String(value.owner)))
    addIssue(issues, `${path}.owner`, 'INVALID_SUMMON_OWNER', '召唤单位 owner 必须是 self、opponent 或 any');
  if (!['left', 'right', 'choose', 'first', 'last', 'random', 'random_n', 'all', 'lowest_hp', 'highest_hp', 'by_id'].includes(String(value.pick)))
    addIssue(issues, `${path}.pick`, 'INVALID_SUMMON_PICK', '召唤单位选择方式无效');
  if (value.count !== undefined && (!Number.isSafeInteger(value.count) || Number(value.count) < 1))
    addIssue(issues, `${path}.count`, 'INVALID_SUMMON_COUNT', '召唤单位选择数量必须是正安全整数');
  if (value.pick === 'all' && value.count !== undefined)
    addIssue(issues, `${path}.count`, 'INVALID_SUMMON_COUNT', '选择全部召唤单位时不能提供 count');
  if (value.pick === 'by_id' && (typeof value.id !== 'string' || !STATUS_ID_PATTERN.test(value.id)))
    addIssue(issues, `${path}.id`, 'MISSING_SUMMON_ID', 'by_id 必须提供稳定实例 ID');
  for (const field of ['templateId', 'slot'] as const) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || !STATUS_ID_PATTERN.test(value[field] as string)))
      addIssue(issues, `${path}.${field}`, 'INVALID_SUMMON_ID', `${field} 必须是稳定英文 ID`);
  }
  if (value.tags !== undefined && (
    !Array.isArray(value.tags) || value.tags.length < 1 || value.tags.length > 32 ||
    value.tags.some(tag => typeof tag !== 'string' || !STATUS_ID_PATTERN.test(tag)) ||
    new Set(value.tags).size !== value.tags.length
  )) addIssue(issues, `${path}.tags`, 'INVALID_SUMMON_TAGS', '召唤单位标签必须是唯一稳定英文 ID 数组');
  if (value.includeUntargetable !== undefined && typeof value.includeUntargetable !== 'boolean')
    addIssue(issues, `${path}.includeUntargetable`, 'INVALID_SUMMON_SELECTOR', 'includeUntargetable 必须是布尔值');
}

function validateSummonDefinition(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_SUMMON_DEFINITION', '召唤单位定义必须是对象');
  rejectUnknownKeys(value, [
    'id', 'name', 'emoji', 'description', 'hasHp', 'maxHp', 'block', 'tags', 'resources', 'modifiers',
    'actionProgram', 'actions', 'abilities', 'actionsPerActivation', 'actionPriority', 'speed', 'intercept', 'slot',
    'onExisting', 'onDefeated', 'retainCorpse', 'capabilities',
  ], path, issues);
  if (typeof value.id !== 'string' || !STATUS_ID_PATTERN.test(value.id))
    addIssue(issues, `${path}.id`, 'INVALID_SUMMON_ID', '召唤单位必须使用稳定英文 ID');
  if (typeof value.name !== 'string' || !value.name.trim())
    addIssue(issues, `${path}.name`, 'INVALID_SUMMON_NAME', '召唤单位名称不能为空');
  if (typeof value.emoji !== 'string' || !value.emoji.trim())
    addIssue(issues, `${path}.emoji`, 'INVALID_SUMMON_EMOJI', '召唤单位 emoji 不能为空');
  if (value.description !== undefined && typeof value.description !== 'string')
    addIssue(issues, `${path}.description`, 'INVALID_SUMMON_DESCRIPTION', '召唤单位描述必须是文本');
  if (value.hasHp !== undefined && typeof value.hasHp !== 'boolean')
    addIssue(issues, `${path}.hasHp`, 'INVALID_SUMMON_HP_MODE', '召唤单位 hasHp 必须是布尔值');
  const hasHp = value.hasHp !== false;
  if (hasHp && (typeof value.maxHp !== 'number' || !Number.isFinite(value.maxHp) || value.maxHp <= 0))
    addIssue(issues, `${path}.maxHp`, 'INVALID_SUMMON_HP', '有生命召唤单位最大生命必须是正有限数');
  if (!hasHp && value.maxHp !== undefined && value.maxHp !== 0)
    addIssue(issues, `${path}.maxHp`, 'INVALID_SUMMON_HP', '无生命召唤单位必须省略 maxHp 或设为 0');
  if (value.block !== undefined && (typeof value.block !== 'number' || !Number.isFinite(value.block) || value.block < 0))
    addIssue(issues, `${path}.block`, 'INVALID_SUMMON_BLOCK', '召唤单位格挡必须是非负有限数');
  for (const field of ['actionsPerActivation', 'actionPriority', 'speed'] as const) {
    if (value[field] !== undefined && !Number.isInteger(value[field]))
      addIssue(issues, `${path}.${field}`, 'INVALID_SUMMON_ORDER', `${field} 必须是整数`);
  }
  if (Number(value.actionsPerActivation ?? 1) < 0 || Number(value.actionsPerActivation ?? 1) > 20)
    addIssue(issues, `${path}.actionsPerActivation`, 'INVALID_SUMMON_ACTION_COUNT', '每次激活行动数必须是 0 到 20');
  if (value.tags !== undefined && (
    !Array.isArray(value.tags) || value.tags.length > 32 || value.tags.some(tag => typeof tag !== 'string' || !STATUS_ID_PATTERN.test(tag))
  )) addIssue(issues, `${path}.tags`, 'INVALID_SUMMON_TAGS', '召唤单位标签必须使用稳定英文 ID');
  if (value.slot !== undefined && (typeof value.slot !== 'string' || !STATUS_ID_PATTERN.test(value.slot)))
    addIssue(issues, `${path}.slot`, 'INVALID_SUMMON_SLOT', '召唤槽必须是稳定英文 ID');
  if (value.onExisting !== undefined && !['reinforce', 'replace'].includes(String(value.onExisting)))
    addIssue(issues, `${path}.onExisting`, 'INVALID_SUMMON_POLICY', '槽内已有单位时只能 reinforce 或 replace');
  if (value.onDefeated !== undefined && !['new_instance', 'revive_reset', 'revive_reinforce'].includes(String(value.onDefeated)))
    addIssue(issues, `${path}.onDefeated`, 'INVALID_SUMMON_POLICY', '死亡后策略无效');
  if ((value.onExisting !== undefined || value.onDefeated !== undefined) && value.slot === undefined)
    addIssue(issues, path, 'MISSING_SUMMON_SLOT', '唯一召唤策略必须提供 slot');
  if (value.retainCorpse !== undefined && typeof value.retainCorpse !== 'boolean')
    addIssue(issues, `${path}.retainCorpse`, 'INVALID_SUMMON_POLICY', 'retainCorpse 必须是布尔值');
  if (value.intercept !== undefined) {
    if (!isRecord(value.intercept)) addIssue(issues, `${path}.intercept`, 'INVALID_SUMMON_INTERCEPT', '拦截规则必须是对象');
    else {
      rejectUnknownKeys(value.intercept, ['mode', 'priority', 'maxPerTurn'], `${path}.intercept`, issues);
      if (value.intercept.mode !== 'unblocked_attack')
        addIssue(issues, `${path}.intercept.mode`, 'INVALID_SUMMON_INTERCEPT', '只支持拦截格挡后的攻击伤害');
      if (value.intercept.priority !== undefined && !Number.isInteger(value.intercept.priority))
        addIssue(issues, `${path}.intercept.priority`, 'INVALID_SUMMON_INTERCEPT', '拦截优先级必须是整数');
      if (value.intercept.maxPerTurn !== undefined && (!Number.isInteger(value.intercept.maxPerTurn) || Number(value.intercept.maxPerTurn) < 1))
        addIssue(issues, `${path}.intercept.maxPerTurn`, 'INVALID_SUMMON_INTERCEPT', '每回合拦截次数必须是正整数');
    }
  }
  if (value.capabilities !== undefined) {
    if (!isRecord(value.capabilities)) addIssue(issues, `${path}.capabilities`, 'INVALID_SUMMON_CAPABILITY', '能力策略必须是对象');
    else {
      rejectUnknownKeys(value.capabilities, ['selectable', 'acceptsStatus', 'acts', 'intercepts'], `${path}.capabilities`, issues);
      for (const [key, entry] of Object.entries(value.capabilities))
        if (typeof entry !== 'boolean') addIssue(issues, `${path}.capabilities.${key}`, 'INVALID_SUMMON_CAPABILITY', '能力策略必须是布尔值');
    }
  }
  if (value.resources !== undefined) {
    if (!isRecord(value.resources) || Object.keys(value.resources).length > 16)
      addIssue(issues, `${path}.resources`, 'INVALID_SUMMON_RESOURCES', '召唤单位资源必须是至多 16 项的对象');
    else for (const [id, raw] of Object.entries(value.resources)) {
      if (!STATUS_ID_PATTERN.test(id) || id === 'energy' || !isRecord(raw) || raw.id !== id ||
          typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.emoji !== 'string' || !raw.emoji.trim() ||
          !Number.isInteger(raw.current) || Number(raw.current) < 0 || !Number.isInteger(raw.max) || Number(raw.max) < 1 ||
          Number(raw.current) > Number(raw.max) || !['reset', 'retain'].includes(String(raw.refresh)))
        addIssue(issues, `${path}.resources.${id}`, 'INVALID_SUMMON_RESOURCE', '召唤单位资源定义无效');
    }
  }
  if (value.modifiers !== undefined && (!isRecord(value.modifiers) || Object.values(value.modifiers).some(entry => typeof entry !== 'number' || !Number.isFinite(entry))))
    addIssue(issues, `${path}.modifiers`, 'INVALID_SUMMON_MODIFIER', '召唤单位修饰符必须是有限数字对象');
  if (value.actionProgram !== undefined) {
    if (!isRecord(value.actionProgram) || value.actionProgram.spec !== EFFECT_PROGRAM_SPEC)
      addIssue(issues, `${path}.actionProgram`, 'INVALID_SUMMON_ACTION', '召唤行动必须使用当前效果规范');
    else validateNestedEffectList(value.actionProgram.steps, `${path}.actionProgram.steps`, issues, depth + 1, counter);
  }
  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions) || value.actions.length > 20)
      addIssue(issues, `${path}.actions`, 'INVALID_SUMMON_ACTIONS', '召唤单位至多定义 20 个行动');
    else value.actions.forEach((action, index) => {
      const actionPath = `${path}.actions[${index}]`;
      if (!isRecord(action)) return addIssue(issues, actionPath, 'INVALID_SUMMON_ACTION', '召唤行动必须是对象');
      rejectUnknownKeys(action, ['id', 'name', 'emoji', 'description', 'weight', 'fixed', 'effectProgram'], actionPath, issues);
      if (typeof action.id !== 'string' || !STATUS_ID_PATTERN.test(action.id))
        addIssue(issues, `${actionPath}.id`, 'INVALID_SUMMON_ACTION', '召唤行动必须使用稳定英文 ID');
      if (typeof action.name !== 'string' || !action.name.trim())
        addIssue(issues, `${actionPath}.name`, 'INVALID_SUMMON_ACTION', '召唤行动名称不能为空');
      if (action.emoji !== undefined && (typeof action.emoji !== 'string' || !action.emoji.trim()))
        addIssue(issues, `${actionPath}.emoji`, 'INVALID_SUMMON_ACTION', '召唤行动 emoji 必须是文本');
      if (action.description !== undefined && typeof action.description !== 'string')
        addIssue(issues, `${actionPath}.description`, 'INVALID_SUMMON_ACTION', '召唤行动描述必须是文本');
      if (action.weight !== undefined && (typeof action.weight !== 'number' || !Number.isFinite(action.weight) || action.weight <= 0))
        addIssue(issues, `${actionPath}.weight`, 'INVALID_SUMMON_ACTION', '召唤行动权重必须是正数');
      if (action.fixed !== undefined && typeof action.fixed !== 'boolean')
        addIssue(issues, `${actionPath}.fixed`, 'INVALID_SUMMON_ACTION', '召唤行动 fixed 必须是布尔值');
      if (!isRecord(action.effectProgram) || action.effectProgram.spec !== EFFECT_PROGRAM_SPEC)
        addIssue(issues, `${actionPath}.effectProgram`, 'INVALID_SUMMON_ACTION', '召唤行动必须使用当前效果规范');
      else validateNestedEffectList(action.effectProgram.steps, `${actionPath}.effectProgram.steps`, issues, depth + 1, counter);
    });
  }
  if (value.abilities !== undefined) {
    if (!Array.isArray(value.abilities) || value.abilities.length > 20)
      addIssue(issues, `${path}.abilities`, 'INVALID_SUMMON_ABILITIES', '召唤单位至多定义 20 个触发能力');
    else value.abilities.forEach((ability, index) => {
      const abilityPath = `${path}.abilities[${index}]`;
      if (!isRecord(ability)) return addIssue(issues, abilityPath, 'INVALID_SUMMON_ABILITY', '召唤能力必须是对象');
      rejectUnknownKeys(ability, ['id', 'name', 'emoji', 'description', 'trigger', 'eventQuery', 'fixed', 'effectProgram'], abilityPath, issues);
      if (typeof ability.id !== 'string' || !STATUS_ID_PATTERN.test(ability.id))
        addIssue(issues, `${abilityPath}.id`, 'INVALID_SUMMON_ABILITY', '召唤能力必须使用稳定英文 ID');
      if (typeof ability.trigger !== 'string' || !ABILITY_TRIGGER_SET.has(ability.trigger))
        addIssue(issues, `${abilityPath}.trigger`, 'INVALID_TRIGGER', '召唤能力触发时机无效');
      if (ability.eventQuery !== undefined)
        validateEventQuery(ability.eventQuery, `${abilityPath}.eventQuery`, issues, { ordinal: true });
      if (ability.fixed !== undefined && typeof ability.fixed !== 'boolean')
        addIssue(issues, `${abilityPath}.fixed`, 'INVALID_SUMMON_ABILITY', '召唤能力 fixed 必须是布尔值');
      if (!isRecord(ability.effectProgram) || ability.effectProgram.spec !== EFFECT_PROGRAM_SPEC)
        addIssue(issues, `${abilityPath}.effectProgram`, 'INVALID_SUMMON_ABILITY', '召唤能力必须使用当前效果规范');
      else validateNestedEffectList(ability.effectProgram.steps, `${abilityPath}.effectProgram.steps`, issues, depth + 1, counter);
    });
  }
}

function validateEnemySpawnDefinition(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_ENEMY_DEFINITION', '敌人生成定义必须是对象');
  rejectUnknownKeys(value, [
    'id', 'name', 'emoji', 'description', 'max_hp', 'hp', 'max_lust', 'lust', 'block',
    'actions', 'abilities', 'status_effects', 'lust_effect', 'action_mode', 'action_config',
    'action_priority', 'speed', 'tags', 'resources', 'stance', 'orb_slots', 'orbs',
  ], path, issues);
  if (typeof value.id !== 'string' || !STATUS_ID_PATTERN.test(value.id))
    addIssue(issues, `${path}.id`, 'INVALID_ENEMY_ID', '生成敌人必须使用稳定英文 ID');
  if (typeof value.name !== 'string' || !value.name.trim())
    addIssue(issues, `${path}.name`, 'INVALID_ENEMY_NAME', '生成敌人名称不能为空');
  if (typeof value.emoji !== 'string' || !value.emoji.trim())
    addIssue(issues, `${path}.emoji`, 'INVALID_ENEMY_EMOJI', '生成敌人必须提供图标');
  if (typeof value.description !== 'undefined' && typeof value.description !== 'string')
    addIssue(issues, `${path}.description`, 'INVALID_ENEMY_DESCRIPTION', '生成敌人说明必须是文本');
  if (typeof value.max_hp !== 'number' || !Number.isFinite(value.max_hp) || value.max_hp <= 0)
    addIssue(issues, `${path}.max_hp`, 'INVALID_ENEMY_HP', '生成敌人最大生命必须为正数');
  for (const field of ['hp', 'max_lust', 'lust', 'block'] as const) {
    if (value[field] !== undefined && (
      typeof value[field] !== 'number' || !Number.isFinite(value[field]) || Number(value[field]) < 0
    )) addIssue(issues, `${path}.${field}`, 'INVALID_ENEMY_STAT', `${field} 必须是非负有限数值`);
  }
  if (!Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > 24) {
    addIssue(issues, `${path}.actions`, 'INVALID_ENEMY_ACTIONS', '生成敌人必须包含 1 到 24 个行动');
  } else {
    value.actions.forEach((action, index) => {
      const actionPath = `${path}.actions[${index}]`;
      if (!isRecord(action)) return addIssue(issues, actionPath, 'INVALID_ENEMY_ACTION', '敌人行动必须是对象');
      if (typeof action.name !== 'string' || !action.name.trim())
        addIssue(issues, `${actionPath}.name`, 'INVALID_ENEMY_ACTION', '敌人行动名称不能为空');
      if (action.weight !== undefined && (
        typeof action.weight !== 'number' || !Number.isFinite(action.weight) || action.weight <= 0
      )) addIssue(issues, `${actionPath}.weight`, 'INVALID_ENEMY_ACTION', '敌人行动权重必须为正数');
      if (action.effects === undefined)
        addIssue(issues, `${actionPath}.effects`, 'INVALID_ENEMY_ACTION', '敌人行动必须提供效果');
    });
  }
  if (value.abilities !== undefined && (!Array.isArray(value.abilities) || value.abilities.length > 24)) {
    addIssue(issues, `${path}.abilities`, 'INVALID_ENEMY_ABILITIES', '敌方被动必须是至多 24 项的数组');
  }
  if (!isRecord(value.lust_effect) || typeof value.lust_effect.name !== 'string' || !value.lust_effect.name.trim())
    addIssue(issues, `${path}.lust_effect`, 'INVALID_ENEMY_LUST_EFFECT', '生成敌人必须提供具名欲望效果');
  else if (value.lust_effect.effects === undefined)
    addIssue(issues, `${path}.lust_effect.effects`, 'INVALID_ENEMY_LUST_EFFECT', '欲望效果不能为空');
  if (value.action_config !== undefined && !isRecord(value.action_config))
    addIssue(issues, `${path}.action_config`, 'INVALID_ENEMY_ACTION_CONFIG', '行动配置必须是对象');
  for (const field of ['action_priority', 'speed'] as const) {
    if (value[field] !== undefined && (!Number.isInteger(value[field]) || Math.abs(Number(value[field])) > 999))
      addIssue(issues, `${path}.${field}`, 'INVALID_ENEMY_ORDER', `${field} 必须是 -999 到 999 的整数`);
  }
  if (value.tags !== undefined && (
    !Array.isArray(value.tags) || value.tags.length > 32 ||
    value.tags.some(tag => typeof tag !== 'string' || !STATUS_ID_PATTERN.test(tag)) ||
    new Set(value.tags).size !== value.tags.length
  )) addIssue(issues, `${path}.tags`, 'INVALID_ENEMY_TAGS', '敌人标签必须是唯一稳定英文 ID 数组');
}

function validateEffectNode(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  counter.value += 1;
  if (counter.value > MAX_AST_NODES)
    return addIssue(issues, path, 'TOO_MANY_NODES', `AST 节点不能超过 ${MAX_AST_NODES}`);
  if (depth > MAX_AST_DEPTH) return addIssue(issues, path, 'TOO_DEEP', `AST 深度不能超过 ${MAX_AST_DEPTH}`);
  if (!isRecord(value) || typeof value.op !== 'string')
    return addIssue(issues, path, 'INVALID_EFFECT', '效果必须是带 op 字段的对象');
  if (!EFFECT_OPS.has(value.op))
    return addIssue(issues, `${path}.op`, 'UNKNOWN_EFFECT_OPERATOR', `不支持的效果操作: ${value.op}`);
  else if (value.op === 'if') {
    rejectUnknownKeys(value, ['op', 'condition', 'then', 'else'], path, issues);
    validateCondition(value.condition, `${path}.condition`, issues, depth + 1, counter);
    if (!Array.isArray(value.then) || value.then.length === 0)
      addIssue(issues, `${path}.then`, 'EMPTY_EFFECT_BRANCH', 'then 至少需要一个效果');
    else
      value.then.forEach((effect, index) =>
        validateEffectNode(effect, `${path}.then[${index}]`, issues, depth + 1, counter),
      );
    if (value.else !== undefined) {
      if (!Array.isArray(value.else)) addIssue(issues, `${path}.else`, 'INVALID_EFFECT_BRANCH', 'else 必须是效果数组');
      else
        value.else.forEach((effect, index) =>
          validateEffectNode(effect, `${path}.else[${index}]`, issues, depth + 1, counter),
        );
    }
  } else if (value.op === 'narrate') {
    rejectUnknownKeys(value, ['op', 'text'], path, issues);
    if (typeof value.text !== 'string' || value.text.trim() === '')
      addIssue(issues, `${path}.text`, 'EMPTY_NARRATION', '叙事文本不能为空');
  } else if (value.op === 'set_stat') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'stat', 'value'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    if (!['hp', 'lust', 'energy', 'block'].includes(String(value.stat)))
      addIssue(issues, `${path}.stat`, 'INVALID_STAT', `不支持的属性: ${String(value.stat)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.op === 'gain_resource' || value.op === 'set_resource') {
    const amountField = value.op === 'gain_resource' ? 'amount' : 'value';
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'resource', amountField], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    if (typeof value.resource !== 'string' || !STATUS_ID_PATTERN.test(value.resource) || value.resource === 'energy')
      addIssue(issues, `${path}.resource`, 'INVALID_RESOURCE_ID', '自定义资源 ID 必须是稳定英文 ID 且不能是 energy');
    validateNumericExpression(value[amountField], `${path}.${amountField}`, issues, depth + 1, counter);
  } else if (value.op === 'apply_status') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'status', 'stacks'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    if (typeof value.status !== 'string' || !STATUS_ID_PATTERN.test(value.status))
      addIssue(issues, `${path}.status`, 'INVALID_STATUS_ID', `状态 ID 无效: ${String(value.status)}`);
    validateNumericExpression(value.stacks, `${path}.stacks`, issues, depth + 1, counter);
  } else if (value.op === 'remove_status') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'status'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    if (
      typeof value.status !== 'string' ||
      (!STATUS_ID_PATTERN.test(value.status) && !['all', 'buffs', 'debuffs'].includes(value.status))
    ) {
      addIssue(issues, `${path}.status`, 'INVALID_STATUS_ID', `状态 ID 无效: ${String(value.status)}`);
    }
  } else if (value.op === 'draw_cards' || value.op === 'scry_cards') {
    rejectUnknownKeys(value, ['op', 'amount'], path, issues);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  } else if (value.op === 'discard_cards' || value.op === 'exhaust_cards') {
    rejectUnknownKeys(value, ['op', 'selector', 'amount'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  } else if (value.op === 'recover_cards') {
    rejectUnknownKeys(value, ['op', 'source', 'pick', 'amount'], path, issues);
    if (value.source !== 'draw' && value.source !== 'discard' && value.source !== 'exhaust')
      addIssue(issues, `${path}.source`, 'INVALID_CARD_ZONE', '移入手牌的来源只能是 draw、discard 或 exhaust');
    if (value.pick !== 'random' && value.pick !== 'choose' && value.pick !== 'all')
      addIssue(issues, `${path}.pick`, 'INVALID_CARD_PICK', '取回选择只能是 random、choose 或 all');
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  } else if (value.op === 'reduce_card_cost') {
    rejectUnknownKeys(value, ['op', 'selector', 'amount'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  } else if (value.op === 'modify_card_value') {
    rejectUnknownKeys(value, ['op', 'selector', 'stat', 'operator', 'value'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    if (!CARD_VALUE_STATS.has(value.stat as CardValueStat)) {
      addIssue(issues, `${path}.stat`, 'INVALID_CARD_VALUE_STAT', `不支持的卡牌数值类型: ${String(value.stat)}`);
    }
    if (!CARD_VALUE_OPERATORS.has(value.operator as CardValueOperator)) {
      addIssue(issues, `${path}.operator`, 'INVALID_CARD_VALUE_OPERATOR', `不支持的卡牌数值运算: ${String(value.operator)}`);
    }
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.op === 'copy_cards' || value.op === 'double_card_effect') {
    rejectUnknownKeys(value, ['op', 'selector'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
  } else if (value.op === 'auto_play_cards') {
    rejectUnknownKeys(value, ['op', 'selector', 'free'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    if (value.free !== true && value.free !== false)
      addIssue(issues, `${path}.free`, 'INVALID_AUTO_PLAY_COST', '自动打出必须明确是否免费');
  } else if (value.op === 'set_card_destination') {
    rejectUnknownKeys(value, ['op', 'destination'], path, issues);
    if (!['discard', 'exhaust', 'draw_top', 'draw_bottom', 'hand', 'remove'].includes(String(value.destination)))
      addIssue(issues, `${path}.destination`, 'INVALID_CARD_DESTINATION', `不支持的结算后牌区: ${String(value.destination)}`);
  } else if (value.op === 'move_cards') {
    rejectUnknownKeys(value, ['op', 'selector', 'amount', 'destination', 'position'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    if (typeof value.amount !== 'number' || !Number.isInteger(value.amount) || value.amount < 1 || value.amount > 100)
      addIssue(issues, `${path}.amount`, 'INVALID_CARD_COUNT', '移动数量必须是 1 到 100 的整数');
    if (!['hand', 'drawPile', 'discardPile', 'exhaustPile'].includes(String(value.destination)))
      addIssue(issues, `${path}.destination`, 'INVALID_CARD_ZONE', `不支持的目标牌区: ${String(value.destination)}`);
    if (value.position !== 'top' && value.position !== 'bottom')
      addIssue(issues, `${path}.position`, 'INVALID_CARD_POSITION', '牌区位置只能是 top 或 bottom');
  } else if (value.op === 'remove_cards') {
    rejectUnknownKeys(value, ['op', 'selector', 'amount'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    if (typeof value.amount !== 'number' || !Number.isInteger(value.amount) || value.amount < 1 || value.amount > 100)
      addIssue(issues, `${path}.amount`, 'INVALID_CARD_COUNT', '移除数量必须是 1 到 100 的整数');
  } else if (value.op === 'transform_cards') {
    rejectUnknownKeys(value, ['op', 'selector', 'replacement'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    validateGeneratedCard(value.replacement, `${path}.replacement`, issues);
  } else if (value.op === 'apply_card_patch') {
    rejectUnknownKeys(value, ['op', 'selector', 'patch'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    validateEffectCardPatch(value.patch, `${path}.patch`, issues, depth, counter);
  } else if (value.op === 'apply_card_attachment') {
    rejectUnknownKeys(value, ['op', 'selector', 'attachment'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    validateEffectCardAttachment(value.attachment, `${path}.attachment`, issues, depth, counter);
  } else if (value.op === 'upgrade_cards') {
    rejectUnknownKeys(value, ['op', 'selector', 'scope', 'levels', 'maxLevel', 'changes'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    if (!['combat', 'run', 'permanent'].includes(String(value.scope)))
      addIssue(issues, `${path}.scope`, 'INVALID_CARD_UPGRADE_SCOPE', '升级作用域只能是 combat、run 或 permanent');
    if (!Number.isInteger(value.levels) || (value.levels as number) < 1 || (value.levels as number) > 99)
      addIssue(issues, `${path}.levels`, 'INVALID_CARD_UPGRADE_LEVEL', '升级层数必须是 1 到 99 的整数');
    if (value.maxLevel !== undefined && (!Number.isInteger(value.maxLevel) || (value.maxLevel as number) < 1 || (value.maxLevel as number) > 99))
      addIssue(issues, `${path}.maxLevel`, 'INVALID_CARD_UPGRADE_LEVEL', '升级上限必须是 1 到 99 的整数');
    if (!Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > 32)
      addIssue(issues, `${path}.changes`, 'INVALID_CARD_UPGRADE', '升级必须包含 1 到 32 项变化');
    else value.changes.forEach((change, index) =>
      validateEffectCardUpgradeChange(change, `${path}.changes[${index}]`, issues, depth + 1, counter));
  } else if (value.op === 'add_card') {
    rejectUnknownKeys(value, ['op', 'zone', 'card', 'count'], path, issues);
    if (value.zone !== 'hand' && value.zone !== 'draw')
      addIssue(issues, `${path}.zone`, 'INVALID_CARD_ZONE', '生成卡牌只能加入 hand 或 draw');
    if (!Number.isInteger(value.count) || (value.count as number) < 1 || (value.count as number) > 100)
      addIssue(issues, `${path}.count`, 'INVALID_CARD_COUNT', '生成数量必须是 1 到 100 的整数');
    validateGeneratedCard(value.card, `${path}.card`, issues);
  } else if (value.op === 'ensure_card') {
    rejectUnknownKeys(value, ['op', 'zone', 'card', 'minimum', 'includeCopies'], path, issues);
    if (value.zone !== 'hand' && value.zone !== 'draw')
      addIssue(issues, `${path}.zone`, 'INVALID_CARD_ZONE', '确保卡牌只能优先加入 hand 或 draw');
    if (!Number.isInteger(value.minimum) || (value.minimum as number) < 1 || (value.minimum as number) > 100)
      addIssue(issues, `${path}.minimum`, 'INVALID_CARD_COUNT', '最少实例数必须是 1 到 100 的整数');
    if (value.includeCopies !== undefined && typeof value.includeCopies !== 'boolean')
      addIssue(issues, `${path}.includeCopies`, 'INVALID_CARD_FILTER', 'includeCopies 必须是布尔值');
    validateGeneratedCard(value.card, `${path}.card`, issues);
  } else if (value.op === 'spawn_summon') {
    rejectUnknownKeys(value, ['op', 'target', 'summon', 'count', 'capacity', 'overflow'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateSummonDefinition(value.summon, `${path}.summon`, issues, depth + 1, counter);
    validateNumericExpression(value.count, `${path}.count`, issues, depth + 1, counter);
    if (value.capacity !== undefined && (!Number.isSafeInteger(value.capacity) || Number(value.capacity) < 1))
      addIssue(issues, `${path}.capacity`, 'INVALID_SUMMON_CAPACITY', '召唤容量必须是正安全整数');
    if (value.overflow !== undefined && !['reject', 'replace_oldest', 'replace_lowest_hp'].includes(String(value.overflow)))
      addIssue(issues, `${path}.overflow`, 'INVALID_SUMMON_OVERFLOW', '召唤溢出策略无效');
  } else if (value.op === 'spawn_enemy') {
    rejectUnknownKeys(value, ['op', 'enemy', 'count', 'capacity'], path, issues);
    validateEnemySpawnDefinition(value.enemy, `${path}.enemy`, issues);
    validateNumericExpression(value.count, `${path}.count`, issues, depth + 1, counter);
    if (value.capacity !== undefined && (!Number.isInteger(value.capacity) || Number(value.capacity) < 1 || Number(value.capacity) > 12))
      addIssue(issues, `${path}.capacity`, 'INVALID_ENEMY_CAPACITY', '敌人同时存活上限必须是 1 到 12 的整数');
  } else if (value.op === 'damage_summons' || value.op === 'heal_summons') {
    rejectUnknownKeys(value, ['op', 'selector', 'amount'], path, issues);
    validateSummonSelector(value.selector, `${path}.selector`, issues);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  } else if (value.op === 'modify_summons') {
    rejectUnknownKeys(value, ['op', 'selector', 'stat', 'operator', 'value'], path, issues);
    validateSummonSelector(value.selector, `${path}.selector`, issues);
    if (!['max_hp', 'block', 'actions_per_activation', 'speed', 'action_priority'].includes(String(value.stat)))
      addIssue(issues, `${path}.stat`, 'INVALID_SUMMON_STAT', '召唤单位修改属性无效');
    if (!['add', 'subtract', 'multiply', 'divide', 'set'].includes(String(value.operator)))
      addIssue(issues, `${path}.operator`, 'INVALID_SUMMON_OPERATOR', '召唤单位修改运算无效');
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.op === 'modify_summon_effects') {
    rejectUnknownKeys(value, ['op', 'selector', 'stat', 'operator', 'value'], path, issues);
    validateSummonSelector(value.selector, `${path}.selector`, issues);
    if (!CARD_VALUE_STATS.has(value.stat as CardValueStat))
      addIssue(issues, `${path}.stat`, 'INVALID_SUMMON_EFFECT_STAT', '召唤效果只支持 damage、block、lust、stacks');
    if (!CARD_VALUE_OPERATORS.has(value.operator as CardValueOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_SUMMON_EFFECT_OPERATOR', '召唤效果修改运算无效');
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.op === 'gain_summon_resource' || value.op === 'set_summon_resource') {
    const amountField = value.op === 'gain_summon_resource' ? 'amount' : 'value';
    rejectUnknownKeys(value, ['op', 'selector', 'resource', amountField], path, issues);
    validateSummonSelector(value.selector, `${path}.selector`, issues);
    if (typeof value.resource !== 'string' || !STATUS_ID_PATTERN.test(value.resource) || value.resource === 'energy')
      addIssue(issues, `${path}.resource`, 'INVALID_RESOURCE_ID', '召唤单位资源必须是稳定英文 ID 且不能是 energy');
    validateNumericExpression(value[amountField], `${path}.${amountField}`, issues, depth + 1, counter);
  } else if (value.op === 'apply_summon_status') {
    rejectUnknownKeys(value, ['op', 'selector', 'status', 'stacks'], path, issues);
    validateSummonSelector(value.selector, `${path}.selector`, issues);
    if (typeof value.status !== 'string' || !STATUS_ID_PATTERN.test(value.status))
      addIssue(issues, `${path}.status`, 'INVALID_STATUS_ID', '召唤单位状态必须引用已注册稳定 ID');
    validateNumericExpression(value.stacks, `${path}.stacks`, issues, depth + 1, counter);
  } else if (value.op === 'remove_summon_status') {
    rejectUnknownKeys(value, ['op', 'selector', 'status'], path, issues);
    validateSummonSelector(value.selector, `${path}.selector`, issues);
    if (typeof value.status !== 'string' || (!STATUS_ID_PATTERN.test(value.status) && value.status !== 'all'))
      addIssue(issues, `${path}.status`, 'INVALID_STATUS_ID', '召唤单位状态必须是稳定 ID 或 all');
  } else if (value.op === 'activate_summons') {
    rejectUnknownKeys(value, ['op', 'selector'], path, issues);
    validateSummonSelector(value.selector, `${path}.selector`, issues);
  } else if (value.op === 'dismiss_summons') {
    rejectUnknownKeys(value, ['op', 'selector', 'retainCorpse'], path, issues);
    validateSummonSelector(value.selector, `${path}.selector`, issues);
    if (value.retainCorpse !== undefined && typeof value.retainCorpse !== 'boolean')
      addIssue(issues, `${path}.retainCorpse`, 'INVALID_SUMMON_POLICY', 'retainCorpse 必须是布尔值');
  } else if (value.op === 'copy_summons') {
    rejectUnknownKeys(value, ['op', 'selector', 'targetOwner', 'capacity', 'overflow'], path, issues);
    validateSummonSelector(value.selector, `${path}.selector`, issues);
    if (value.targetOwner !== undefined && !['same', 'self', 'opponent'].includes(String(value.targetOwner)))
      addIssue(issues, `${path}.targetOwner`, 'INVALID_SUMMON_OWNER', '复制归属只能是 same、self 或 opponent');
    if (value.capacity !== undefined && (!Number.isSafeInteger(value.capacity) || Number(value.capacity) < 1))
      addIssue(issues, `${path}.capacity`, 'INVALID_SUMMON_CAPACITY', '召唤容量必须是正安全整数');
    if (value.overflow !== undefined && !['reject', 'replace_oldest', 'replace_lowest_hp'].includes(String(value.overflow)))
      addIssue(issues, `${path}.overflow`, 'INVALID_SUMMON_OVERFLOW', '召唤溢出策略无效');
  } else if (value.op === 'summoner_effects') {
    rejectUnknownKeys(value, ['op', 'effects'], path, issues);
    if (!Array.isArray(value.effects) || value.effects.length === 0) {
      addIssue(issues, `${path}.effects`, 'EMPTY_SUMMONER_EFFECTS', '召唤者效果至少需要一个效果');
    } else {
      value.effects.forEach((effect, index) => {
        if (isRecord(effect) && effect.op === 'summoner_effects') {
          addIssue(issues, `${path}.effects[${index}]`, 'NESTED_SUMMONER_EFFECTS', '召唤者效果不能直接嵌套自身');
        } else {
          validateEffectNode(effect, `${path}.effects[${index}]`, issues, depth + 1, counter);
        }
      });
    }
  } else if (value.op === 'modify') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'stat', 'operator', 'value'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    if (!MODIFIER_STATS.has(value.stat as ModifierStat))
      addIssue(issues, `${path}.stat`, 'INVALID_MODIFIER', `不支持的修饰项: ${String(value.stat)}`);
    if (!MODIFIER_OPERATORS.has(value.operator as EffectModifierOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_MODIFIER_OPERATOR', `不支持的修饰运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.op === 'card_play_rule') {
    rejectUnknownKeys(value, ['op', 'target', 'rule', 'limit', 'extra', 'selector', 'destination', 'priority', 'freeResources'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget)) {
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    }
    if (!CARD_PLAY_RULES.has(value.rule as CardPlayRuleKind)) {
      addIssue(issues, `${path}.rule`, 'INVALID_CARD_PLAY_RULE', `不支持的出牌规则: ${String(value.rule)}`);
    }
    const requiresLimit = ['replay', 'free', 'limit_draw', 'limit_block_gain', 'limit_energy_gain', 'limit_card_play'].includes(String(value.rule));
    const requiresSelector = ['deny_card_play', 'allow_card_play', 'limit_card_play', 'card_destination'].includes(String(value.rule));
    if (requiresLimit && value.limit === undefined)
      addIssue(issues, `${path}.limit`, 'MISSING_CARD_RULE_LIMIT', '该规则必须提供 limit');
    if (!requiresLimit && value.limit !== undefined)
      addIssue(issues, `${path}.limit`, 'UNEXPECTED_CARD_RULE_LIMIT', '该规则不接受 limit');
    if (value.limit !== undefined && value.limit !== 'all') {
      validateNumericExpression(value.limit, `${path}.limit`, issues, depth + 1, counter);
    }
    if (value.rule === 'replay') {
      if (value.extra === undefined) {
        addIssue(issues, `${path}.extra`, 'MISSING_CARD_REPLAY_COUNT', '重复结算规则必须提供 extra');
      } else {
        validateNumericExpression(value.extra, `${path}.extra`, issues, depth + 1, counter);
      }
    } else if (value.extra !== undefined) {
      addIssue(issues, `${path}.extra`, 'UNEXPECTED_CARD_REPLAY_COUNT', '只有 replay 规则接受 extra');
    }
    if (requiresSelector && value.selector === undefined)
      addIssue(issues, `${path}.selector`, 'MISSING_CARD_RULE_SELECTOR', '该规则必须提供卡牌选择器');
    if (value.selector !== undefined) validateCardSelector(value.selector, `${path}.selector`, issues);
    if (value.rule === 'card_destination') {
      if (!['discard', 'exhaust', 'draw_top', 'draw_bottom', 'hand', 'remove'].includes(String(value.destination)))
        addIssue(issues, `${path}.destination`, 'INVALID_CARD_DESTINATION', '去向规则必须提供合法 destination');
    } else if (value.destination !== undefined) {
      addIssue(issues, `${path}.destination`, 'UNEXPECTED_CARD_DESTINATION', '只有 card_destination 规则接受 destination');
    }
    if (value.priority !== undefined && (!Number.isInteger(value.priority) || Math.abs(Number(value.priority)) > 100000))
      addIssue(issues, `${path}.priority`, 'INVALID_RULE_PRIORITY', '规则优先级必须是绝对值不超过 100000 的整数');
    if (value.rule === 'free') {
      if (
        value.freeResources !== undefined &&
        value.freeResources !== 'all' &&
        (!Array.isArray(value.freeResources) || value.freeResources.length < 1 ||
          value.freeResources.some((id: unknown) => typeof id !== 'string' || !STATUS_ID_PATTERN.test(id)) ||
          new Set(value.freeResources).size !== value.freeResources.length)
      ) {
        addIssue(issues, `${path}.freeResources`, 'INVALID_RESOURCE_WAIVER', '免费资源必须是 all 或唯一资源 ID 数组');
      }
    } else if (value.freeResources !== undefined) {
      addIssue(issues, `${path}.freeResources`, 'UNEXPECTED_RESOURCE_WAIVER', '只有 free 规则接受 freeResources');
    }
  } else if (value.op === 'set_stance') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'stance'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    if (value.stance !== null) validateStanceDefinition(value.stance, `${path}.stance`, issues, depth + 1, counter);
  } else if (value.op === 'channel_orb') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'orb'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    validateOrbDefinition(value.orb, `${path}.orb`, issues, depth + 1, counter);
  } else if (value.op === 'evoke_orbs') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'selector'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    validateOrbSelector(value.selector, `${path}.selector`, issues);
  } else if (value.op === 'set_orb_slots') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'amount'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  } else if (value.op === 'modify_orbs') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'selector', 'operator', 'value'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    validateOrbSelector(value.selector, `${path}.selector`, issues);
    if (!CARD_VALUE_OPERATORS.has(value.operator as CardValueOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_ORB_VALUE_OPERATOR', `不支持的 Orb 数值运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.op === 'grant_extra_turn') {
    rejectUnknownKeys(value, ['op', 'target', 'amount'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  } else if (value.op === 'force_end_turn') {
    rejectUnknownKeys(value, ['op', 'target'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
  } else if (value.op === 'register_trigger') {
    rejectUnknownKeys(value, ['op', 'target', 'trigger', 'eventQuery', 'effects'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    if (!REGISTERABLE_EFFECT_TRIGGER_SET.has(value.trigger as string))
      addIssue(issues, `${path}.trigger`, 'INVALID_TRIGGER', `不支持的触发器: ${String(value.trigger)}`);
    if (value.eventQuery !== undefined)
      validateEventQuery(value.eventQuery, `${path}.eventQuery`, issues, { ordinal: true });
    if (!Array.isArray(value.effects) || value.effects.length === 0) {
      addIssue(issues, `${path}.effects`, 'EMPTY_TRIGGER_EFFECTS', '触发器至少需要一个效果');
    } else {
      value.effects.forEach((effect, index) => {
        if (isRecord(effect) && effect.op === 'register_trigger') {
          addIssue(issues, `${path}.effects[${index}]`, 'NESTED_TRIGGER', '触发器不能嵌套触发器');
        } else {
          validateEffectNode(effect, `${path}.effects[${index}]`, issues, depth + 1, counter);
        }
      });
    }
  } else if (value.op === 'schedule_effect') {
    rejectUnknownKeys(
      value,
      ['op', 'afterTurns', 'phase', 'priority', 'repeatEvery', 'repeats', 'effects'],
      path,
      issues,
    );
    const afterTurns = value.afterTurns;
    const priority = value.priority;
    const repeatEvery = value.repeatEvery;
    const repeats = value.repeats;
    if (typeof afterTurns !== 'number' || !Number.isInteger(afterTurns) || afterTurns < 0 || afterTurns > 999)
      addIssue(issues, `${path}.afterTurns`, 'INVALID_SCHEDULE_DELAY', '延迟回合必须是 0 到 999 的整数');
    if (!['turn_start', 'before_draw', 'after_draw', 'turn_end'].includes(String(value.phase)))
      addIssue(issues, `${path}.phase`, 'INVALID_SCHEDULE_PHASE', `不支持的调度阶段: ${String(value.phase)}`);
    if (priority !== undefined && (typeof priority !== 'number' || !Number.isInteger(priority) || Math.abs(priority) > 100000))
      addIssue(issues, `${path}.priority`, 'INVALID_SCHEDULE_PRIORITY', '调度优先级必须是绝对值不超过 100000 的整数');
    if (repeatEvery !== undefined && (typeof repeatEvery !== 'number' || !Number.isInteger(repeatEvery) || repeatEvery < 1 || repeatEvery > 999))
      addIssue(issues, `${path}.repeatEvery`, 'INVALID_SCHEDULE_REPEAT', '重复间隔必须是 1 到 999 的整数');
    if (repeats !== undefined && (typeof repeats !== 'number' || !Number.isInteger(repeats) || repeats < 1 || repeats > 999))
      addIssue(issues, `${path}.repeats`, 'INVALID_SCHEDULE_REPEAT', '重复次数必须是 1 到 999 的整数');
    if ((repeatEvery === undefined) !== (repeats === undefined))
      addIssue(issues, path, 'INCOMPLETE_SCHEDULE_REPEAT', '重复调度必须同时提供 repeatEvery 与 repeats');
    if (!Array.isArray(value.effects) || value.effects.length === 0) {
      addIssue(issues, `${path}.effects`, 'EMPTY_SCHEDULE_EFFECTS', '预约效果至少需要一个效果');
    } else {
      value.effects.forEach((effect, index) => {
        if (isRecord(effect) && effect.op === 'schedule_effect')
          addIssue(issues, `${path}.effects[${index}]`, 'NESTED_SCHEDULE', '预约效果不能直接嵌套预约效果');
        else validateEffectNode(effect, `${path}.effects[${index}]`, issues, depth + 1, counter);
      });
    }
  } else if (value.op === 'choose_one') {
    rejectUnknownKeys(value, ['op', 'choiceId', 'options'], path, issues);
    if (typeof value.choiceId !== 'string' || !STATUS_ID_PATTERN.test(value.choiceId))
      addIssue(issues, `${path}.choiceId`, 'INVALID_CHOICE_ID', '选择分支需要稳定英文 ID');
    if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 8) {
      addIssue(issues, `${path}.options`, 'INVALID_CHOICE_OPTIONS', '选择分支必须提供 2 到 8 个选项');
    } else {
      const ids = new Set<string>();
      value.options.forEach((option, optionIndex) => {
        const optionPath = `${path}.options[${optionIndex}]`;
        if (!isRecord(option)) {
          addIssue(issues, optionPath, 'INVALID_CHOICE_OPTION', '选项必须是对象');
          return;
        }
        rejectUnknownKeys(option, ['id', 'label', 'effects'], optionPath, issues);
        if (typeof option.id !== 'string' || !STATUS_ID_PATTERN.test(option.id))
          addIssue(issues, `${optionPath}.id`, 'INVALID_CHOICE_ID', '选项需要稳定英文 ID');
        else if (ids.has(option.id)) addIssue(issues, `${optionPath}.id`, 'DUPLICATE_CHOICE_ID', `选项 ID 重复: ${option.id}`);
        else ids.add(option.id);
        if (typeof option.label !== 'string' || !option.label.trim())
          addIssue(issues, `${optionPath}.label`, 'INVALID_CHOICE_LABEL', '选项需要非空显示文本');
        if (!Array.isArray(option.effects) || option.effects.length === 0)
          addIssue(issues, `${optionPath}.effects`, 'EMPTY_CHOICE_EFFECTS', '选项至少需要一个效果');
        else option.effects.forEach((effect, effectIndex) =>
          validateEffectNode(effect, `${optionPath}.effects[${effectIndex}]`, issues, depth + 1, counter));
      });
    }
  } else if (value.op === 'execute' || value.op === 'kill') {
    rejectUnknownKeys(
      value,
      value.op === 'execute'
        ? ['op', 'target', 'targetSelector', 'threshold', 'thresholdMode', 'excludeTags', 'triggerFatal']
        : ['op', 'target', 'targetSelector', 'excludeTags', 'triggerFatal'],
      path,
      issues,
    );
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    if (value.op === 'execute') {
      validateNumericExpression(value.threshold, `${path}.threshold`, issues, depth + 1, counter);
      if (value.thresholdMode !== 'hp' && value.thresholdMode !== 'hp_percent')
        addIssue(issues, `${path}.thresholdMode`, 'INVALID_EXECUTE_THRESHOLD', '处决阈值模式必须是 hp 或 hp_percent');
    }
    if (value.excludeTags !== undefined) {
      if (!Array.isArray(value.excludeTags) || value.excludeTags.length === 0 || value.excludeTags.length > 32)
        addIssue(issues, `${path}.excludeTags`, 'INVALID_ENTITY_TAGS', '排除标签必须是 1 到 32 项的数组');
      else if (value.excludeTags.some(tag => typeof tag !== 'string' || !STATUS_ID_PATTERN.test(tag)))
        addIssue(issues, `${path}.excludeTags`, 'INVALID_ENTITY_TAGS', '排除标签必须使用稳定英文 ID');
      else if (new Set(value.excludeTags).size !== value.excludeTags.length)
        addIssue(issues, `${path}.excludeTags`, 'DUPLICATE_ENTITY_TAG', '排除标签不能重复');
    }
    if (value.triggerFatal !== undefined && typeof value.triggerFatal !== 'boolean')
      addIssue(issues, `${path}.triggerFatal`, 'INVALID_FATAL_FLAG', 'triggerFatal 必须是布尔值');
  } else if (value.op === 'damage') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'amount', 'damageKind', 'bypassBlock', 'lifesteal'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
    if (value.damageKind !== undefined && !['attack', 'effect', 'hp_loss', 'retaliation', 'damage_over_time'].includes(String(value.damageKind)))
      addIssue(issues, `${path}.damageKind`, 'INVALID_DAMAGE_KIND', `不支持的伤害类型: ${String(value.damageKind)}`);
    if (value.bypassBlock !== undefined && typeof value.bypassBlock !== 'boolean')
      addIssue(issues, `${path}.bypassBlock`, 'INVALID_DAMAGE_PACKET', 'bypassBlock 必须是布尔值');
    if (value.lifesteal !== undefined) validateNumericExpression(value.lifesteal, `${path}.lifesteal`, issues, depth + 1, counter);
  } else {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'amount'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  }
}

export function isSupportedVariablePath(path: string): boolean {
  if (
    [
      'battle.turn_number',
      'battle.cards_played_this_turn',
      'battle.attacks_played_this_turn',
      'battle.skills_played_this_turn',
      'context.spent_energy',
      'context.x_value',
      'context.status_stacks',
      'context.orb_value',
    ].includes(path)
  )
    return true;
  if (/^context\.(spent_resource|x_resource)\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(path)) return true;
  if (/^(self|opponent)\.resource\.[a-zA-Z_][a-zA-Z0-9_]*\.(current|max)$/.test(path)) return true;
  if (/^(self|opponent)\.(hp|max_hp|lust|max_lust|energy|max_energy|block)$/.test(path)) return true;
  if (/^self\.(hand_size|draw_pile_size|discard_pile_size|exhaust_pile_size)$/.test(path)) return true;
  return /^(self|opponent)\.status\.[a-zA-Z0-9_]+\.stacks$/.test(path);
}

export function validateEffectProgram(value: unknown): EffectValidationResult {
  const issues: EffectValidationIssue[] = [];
  if (!isRecord(value))
    return { ok: false, issues: [{ path: '$', code: 'INVALID_PROGRAM', message: '效果程序必须是对象' }] };
  rejectUnknownKeys(value, ['spec', 'steps'], '$', issues);
  if (value.spec !== EFFECT_PROGRAM_SPEC)
    addIssue(issues, '$.spec', 'UNSUPPORTED_SPEC', `spec 必须是 ${EFFECT_PROGRAM_SPEC}`);
  if (!Array.isArray(value.steps) || value.steps.length === 0)
    addIssue(issues, '$.steps', 'EMPTY_PROGRAM', 'steps 至少需要一个效果');
  else {
    const counter = { value: 0 };
    value.steps.forEach((effect, index) => validateEffectNode(effect, `$.steps[${index}]`, issues, 0, counter));
  }
  return issues.length === 0 ? { ok: true, value: value as unknown as EffectProgram } : { ok: false, issues };
}

function readCombatantVariable(entity: CoreCombatantState, field: string, path: string): number {
  const fields: Record<string, number | undefined> = {
    hp: entity.hp,
    max_hp: entity.maxHp,
    lust: entity.lust,
    max_lust: entity.maxLust,
    energy: entity.energy,
    max_energy: entity.maxEnergy,
    block: entity.block,
    hand_size: entity.handSize,
    draw_pile_size: entity.drawPileSize,
    discard_pile_size: entity.discardPileSize,
    exhaust_pile_size: entity.exhaustPileSize,
  };
  const value = fields[field];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new EffectExecutionError('MISSING_VARIABLE', path, `变量没有有限数值: ${path}`);
  return value;
}

export function resolveNumericVariable(path: string, state: CoreEffectState, context: EffectExecutionContext): number {
  if (path === 'battle.turn_number') return state.currentTurn;
  if (path === 'battle.cards_played_this_turn') return state.cardsPlayedThisTurn;
  if (path === 'battle.attacks_played_this_turn') return state.attacksPlayedThisTurn;
  if (path === 'battle.skills_played_this_turn') return state.skillsPlayedThisTurn;
  if (path === 'context.spent_energy') return context.spentEnergy;
  const spentResource = path.match(/^context\.spent_resource\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (spentResource) return context.spentResources?.[spentResource[1]] ?? 0;
  const xResource = path.match(/^context\.x_resource\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (xResource) return context.xValues?.[xResource[1]] ?? 0;
  if (path === 'context.x_value') return context.xValue ?? context.spentEnergy;
  if (path === 'context.status_stacks') return context.statusStacks ?? 0;
  if (path === 'context.orb_value') return context.orbValue ?? 0;
  const statusMatch = path.match(/^(self|opponent)\.status\.([a-zA-Z0-9_]+)\.stacks$/);
  if (statusMatch) return state[statusMatch[1] as EffectTarget].statusStacks?.[statusMatch[2]] ?? 0;
  const resourceMatch = path.match(/^(self|opponent)\.resource\.([a-zA-Z_][a-zA-Z0-9_]*)\.(current|max)$/);
  if (resourceMatch) {
    const entity = state[resourceMatch[1] as EffectTarget];
    return resourceMatch[3] === 'max'
      ? entity.maxResources?.[resourceMatch[2]] ?? 0
      : entity.resources?.[resourceMatch[2]] ?? 0;
  }
  const entityMatch = path.match(/^(self|opponent)\.([a-z_]+)$/);
  if (!entityMatch) throw new EffectExecutionError('UNKNOWN_VARIABLE', path, `不支持的变量路径: ${path}`);
  return readCombatantVariable(state[entityMatch[1] as EffectTarget], entityMatch[2], path);
}

function coreCardMatchesFilter(card: CoreCardView, filter?: CardSelectorFilter): boolean {
  if (!filter) return true;
  if (filter.name !== undefined && card.name !== filter.name) return false;
  if (filter.types && (!card.type || !filter.types.includes(card.type))) return false;
  if (filter.rarities && (!card.rarity || !filter.rarities.includes(card.rarity))) return false;
  if (filter.cost !== undefined) {
    const same = card.cost === filter.cost || (
      typeof card.cost === 'object' && typeof filter.cost === 'object' &&
      JSON.stringify(Object.entries(card.cost).sort(([a], [b]) => a.localeCompare(b))) ===
        JSON.stringify(Object.entries(filter.cost).sort(([a], [b]) => a.localeCompare(b)))
    );
    if (!same) return false;
  }
  if (filter.minCost !== undefined && (typeof card.cost !== 'number' || card.cost < filter.minCost)) return false;
  if (filter.maxCost !== undefined && (typeof card.cost !== 'number' || card.cost > filter.maxCost)) return false;
  if (filter.tags && !filter.tags.every(tag => card.tags?.includes(tag))) return false;
  if (filter.templateId && (card.templateId || card.originalId) !== filter.templateId) return false;
  if (filter.runInstanceId && card.runInstanceId !== filter.runInstanceId) return false;
  if (filter.combatInstanceId && (card.combatInstanceId || card.id) !== filter.combatInstanceId) return false;
  if (filter.origin && card.origin !== filter.origin) return false;
  if (filter.rootOnly === true && card.origin === 'copied') return false;
  const upgraded = card.upgraded === true || (card.upgradeLevel || 0) > 0;
  return filter.upgraded === undefined || filter.upgraded === upgraded;
}

export function evaluateNumericExpression(
  expression: NumericExpression,
  state: CoreEffectState,
  context: EffectExecutionContext,
  path = '$',
): number {
  if (typeof expression === 'number') {
    if (!Number.isFinite(expression)) throw new EffectExecutionError('NON_FINITE_NUMBER', path, '数字必须是有限值');
    return expression;
  }
  if (expression.op === 'var') return resolveNumericVariable(expression.path, state, context);
  if (expression.op === 'negate') {
    const value = evaluateNumericExpression(expression.value, state, context, `${path}.value`);
    return -value;
  }
  if (expression.op === 'floor' || expression.op === 'ceil' || expression.op === 'abs') {
    const value = evaluateNumericExpression(expression.value, state, context, `${path}.value`);
    return expression.op === 'floor' ? Math.floor(value) : expression.op === 'ceil' ? Math.ceil(value) : Math.abs(value);
  }
  if (expression.op === 'clamp_min') {
    const value = evaluateNumericExpression(expression.value, state, context, `${path}.value`);
    return Math.max(expression.minimum, value);
  }
  if (expression.op === 'min' || expression.op === 'max') {
    const values = expression.values.map((entry, index) => evaluateNumericExpression(entry, state, context, `${path}.values[${index}]`));
    return expression.op === 'min' ? Math.min(...values) : Math.max(...values);
  }
  if (expression.op === 'count_cards') {
    const zones = state.cardZones;
    if (!zones) throw new EffectExecutionError('MISSING_VARIABLE', path, '卡牌集合未提供');
    const selectedZones = expression.selector.zone === 'all'
      ? ['hand', 'draw', 'discard'] as const
      : expression.selector.zone === 'combat'
        ? ['hand', 'draw', 'discard', 'exhaust'] as const
        : [expression.selector.zone] as const;
    const cards = selectedZones.flatMap(zone => zones[zone]);
    return cards.filter(card => coreCardMatchesFilter(card, expression.selector.filter)).length;
  }
  if (expression.op === 'count_statuses') {
    return Object.values(state[expression.target].statusStacks || {}).filter(stacks => stacks > 0).length;
  }
  if (expression.op === 'history') {
    const history = state.history;
    if (history?.eventJournal) {
      return readBattleEventHistoryValue(history.eventJournal, {
        metric: expression.metric,
        scope: expression.scope || 'combat',
        ...(expression.scope === 'turn' && expression.turn === undefined ? { turn: state.currentTurn } : {}),
        ...(expression.turn !== undefined ? { turn: expression.turn } : {}),
        ...(expression.cardInstanceId ? { cardInstanceId: expression.cardInstanceId } : {}),
        ...(expression.teamActorIds ? { teamActorIds: expression.teamActorIds } : {}),
        ...(expression.filter ? { filter: expression.filter } : {}),
      });
    }
    if (!history) throw new EffectExecutionError('MISSING_VARIABLE', path, '历史数值未提供');
    return {
      last_damage: history.lastDamage,
      last_hp_loss: history.lastHpLoss,
      last_heal: history.lastHeal,
      last_resource_spent: history.lastResourceSpent,
      count: 0,
      last_turn: 0,
      last_sequence: 0,
    }[expression.metric] ?? 0;
  }
  if (expression.op === 'intent_value') return state.enemyIntentValue ?? 0;
  const left = evaluateNumericExpression(expression.left, state, context, `${path}.left`);
  const right = evaluateNumericExpression(expression.right, state, context, `${path}.right`);
  let result: number;
  switch (expression.op) {
    case 'add':
      result = left + right;
      break;
    case 'subtract':
      result = left - right;
      break;
    case 'multiply':
      result = left * right;
      break;
    case 'divide':
      if (right === 0) throw new EffectExecutionError('DIVISION_BY_ZERO', path, '不能除以 0');
      result = left / right;
      break;
  }
  if (!Number.isFinite(result)) throw new EffectExecutionError('NON_FINITE_RESULT', path, '表达式结果必须是有限值');
  return result;
}

export function evaluateConditionExpression(
  condition: ConditionExpression,
  state: CoreEffectState,
  context: EffectExecutionContext,
  path = '$',
): boolean {
  if (condition.op === 'not')
    return !evaluateConditionExpression(condition.condition, state, context, `${path}.condition`);
  if (condition.op === 'all' || condition.op === 'any') {
    const values = condition.conditions.map((entry, index) =>
      evaluateConditionExpression(entry, state, context, `${path}.conditions[${index}]`),
    );
    return condition.op === 'all' ? values.every(Boolean) : values.some(Boolean);
  }
  if (condition.op === 'last_card_type') return state.history?.lastCardType === condition.cardType;
  if (condition.op === 'intent_type') return state.enemyIntentType === condition.intentType;
  if (!isComparisonCondition(condition)) {
    throw new EffectExecutionError('UNKNOWN_CONDITION_OPERATOR', path, `不支持的条件运算: ${condition.op}`);
  }
  const left = evaluateNumericExpression(condition.left, state, context, `${path}.left`);
  const right = evaluateNumericExpression(condition.right, state, context, `${path}.right`);
  switch (condition.relation) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
  }
}

function evaluateAmount(
  expression: NumericExpression,
  state: CoreEffectState,
  context: EffectExecutionContext,
  path: string,
  discrete = false,
  allowNegative = false,
): number {
  const evaluated = evaluateNumericExpression(expression, state, context, path);
  const value = discrete ? Math.floor(evaluated) : roundBattleValue(evaluated);
  if (!allowNegative && value < 0) throw new EffectExecutionError('NEGATIVE_AMOUNT', path, '该效果的数量不能为负数');
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStat(entity: CoreCombatantState, stat: 'hp' | 'lust' | 'energy' | 'block'): number {
  return stat === 'hp' ? entity.hp : stat === 'lust' ? entity.lust : stat === 'energy' ? entity.energy : entity.block;
}

function writeStat(entity: CoreCombatantState, stat: 'hp' | 'lust' | 'energy' | 'block', value: number): void {
  if (stat === 'hp') entity.hp = roundBattleValue(clamp(value, 0, entity.maxHp));
  else if (stat === 'lust') entity.lust = roundBattleValue(clamp(value, 0, entity.maxLust));
  else if (stat === 'energy') entity.energy = Math.max(0, Math.floor(value));
  else entity.block = roundBattleValue(Math.max(0, value));
}

function executeNode(
  node: EffectNode,
  state: CoreEffectState,
  context: EffectExecutionContext,
  events: CoreEffectEvent[],
  path: string,
): void {
  if (node.op === 'if') {
    const branch = evaluateConditionExpression(node.condition, state, context, `${path}.condition`)
      ? node.then
      : node.else || [];
    branch.forEach((effect, index) => executeNode(effect, state, context, events, `${path}.branch[${index}]`));
    return;
  }
  if (node.op === 'choose_one') {
    const selectedId = context.choiceSelections?.[node.choiceId];
    if (!selectedId) throw new EffectExecutionError('CHOICE_REQUIRED', path, `需要选择: ${node.choiceId}`);
    const selected = node.options.find(option => option.id === selectedId);
    if (!selected) throw new EffectExecutionError('INVALID_CHOICE', path, `无效选项: ${selectedId}`);
    events.push({ type: 'choice_selected', choiceId: node.choiceId, optionId: selected.id, label: selected.label });
    selected.effects.forEach((effect, index) => executeNode(effect, state, context, events, `${path}.options.${selected.id}[${index}]`));
    return;
  }
  if (node.op === 'narrate') {
    events.push({ type: 'narration', text: node.text });
    return;
  }
  if (node.op === 'schedule_effect') {
    events.push({
      type: 'schedule_effect',
      afterTurns: node.afterTurns,
      phase: node.phase,
      priority: node.priority || 0,
      ...(node.repeatEvery !== undefined ? { repeatEvery: node.repeatEvery } : {}),
      ...(node.repeats !== undefined ? { repeats: node.repeats } : {}),
      effects: clone(node.effects),
    });
    return;
  }
  if (node.op === 'draw_cards') {
    events.push({ type: 'draw_cards', amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true) });
    return;
  }
  if (node.op === 'scry_cards') {
    events.push({ type: 'scry_cards', amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true) });
    return;
  }
  if (node.op === 'discard_cards' || node.op === 'exhaust_cards') {
    events.push({
      type: node.op,
      selector: clone(node.selector),
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true),
    });
    return;
  }
  if (node.op === 'recover_cards') {
    events.push({
      type: 'recover_cards',
      source: node.source,
      pick: node.pick,
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true),
    });
    return;
  }
  if (node.op === 'reduce_card_cost') {
    events.push({
      type: 'reduce_card_cost',
      selector: clone(node.selector),
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true),
    });
    return;
  }
  if (node.op === 'modify_card_value') {
    events.push({
      type: 'modify_card_value',
      selector: clone(node.selector),
      stat: node.stat,
      operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    });
    return;
  }
  if (node.op === 'copy_cards' || node.op === 'double_card_effect') {
    events.push({ type: node.op, selector: clone(node.selector) });
    return;
  }
  if (node.op === 'auto_play_cards') {
    events.push({ type: 'auto_play_cards', selector: clone(node.selector), free: node.free });
    return;
  }
  if (node.op === 'set_card_destination') {
    events.push({ type: 'set_card_destination', destination: node.destination });
    return;
  }
  if (node.op === 'move_cards') {
    events.push({
      type: 'move_cards', selector: clone(node.selector), amount: node.amount,
      destination: node.destination, position: node.position,
    });
    return;
  }
  if (node.op === 'remove_cards') {
    events.push({ type: 'remove_cards', selector: clone(node.selector), amount: node.amount });
    return;
  }
  if (node.op === 'transform_cards') {
    events.push({ type: 'transform_cards', selector: clone(node.selector), replacement: clone(node.replacement) });
    return;
  }
  if (node.op === 'apply_card_patch') {
    const patch = clone(node.patch);
    if (patch.kind === 'numeric' || patch.kind === 'cost' || patch.kind === 'x_value') {
      patch.value = roundBattleValue(evaluateNumericExpression(patch.value, state, context, `${path}.patch.value`));
    } else if (patch.kind === 'replay') {
      patch.extra = Math.max(1, Math.floor(evaluateNumericExpression(patch.extra, state, context, `${path}.patch.extra`)));
    }
    events.push({ type: 'apply_card_patch', selector: clone(node.selector), patch });
    return;
  }
  if (node.op === 'apply_card_attachment') {
    const attachment = clone(node.attachment);
    attachment.changes.forEach((change, index) => {
      if (change.kind === 'numeric' || change.kind === 'cost' || change.kind === 'x_value') {
        change.value = roundBattleValue(evaluateNumericExpression(change.value, state, context, `${path}.attachment.changes[${index}].value`));
      } else if (change.kind === 'replay') {
        change.extra = Math.max(1, Math.floor(evaluateNumericExpression(change.extra, state, context, `${path}.attachment.changes[${index}].extra`)));
      }
    });
    events.push({ type: 'apply_card_attachment', selector: clone(node.selector), attachment });
    return;
  }
  if (node.op === 'upgrade_cards') {
    const changes = clone(node.changes);
    changes.forEach((change, index) => {
      if (change.kind === 'numeric' || change.kind === 'cost' || change.kind === 'x_value') {
        change.value = roundBattleValue(evaluateNumericExpression(change.value, state, context, `${path}.changes[${index}].value`));
      } else if (change.kind === 'replay') {
        change.extra = Math.max(1, Math.floor(evaluateNumericExpression(change.extra, state, context, `${path}.changes[${index}].extra`)));
      }
    });
    events.push({
      type: 'upgrade_cards', selector: clone(node.selector), scope: node.scope, levels: node.levels,
      ...(node.maxLevel !== undefined ? { maxLevel: node.maxLevel } : {}), changes,
    });
    return;
  }
  if (node.op === 'add_card') {
    events.push({ type: 'add_card', zone: node.zone, card: clone(node.card), count: node.count });
    return;
  }
  if (node.op === 'ensure_card') {
    events.push({
      type: 'ensure_card', zone: node.zone, card: clone(node.card), minimum: node.minimum,
      includeCopies: node.includeCopies === true,
    });
    return;
  }
  if (node.op === 'modify') {
    events.push({
      type: 'modify',
      target: node.target,
      stat: node.stat,
      operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    });
    return;
  }
  if (node.op === 'card_play_rule') {
    const limit = node.limit === undefined
      ? undefined
      : node.limit === 'all'
        ? 'all'
        : Math.max(0, Math.floor(evaluateNumericExpression(node.limit, state, context, `${path}.limit`)));
    const extra =
      node.rule === 'replay' && node.extra !== undefined
        ? Math.max(1, Math.floor(evaluateNumericExpression(node.extra, state, context, `${path}.extra`)))
        : 0;
    events.push({
      type: 'card_play_rule', target: node.target, rule: node.rule,
      ...(limit !== undefined ? { limit } : {}), extra,
      ...(node.selector ? { selector: clone(node.selector) } : {}),
      ...(node.destination ? { destination: node.destination } : {}),
      ...(node.freeResources ? { freeResources: clone(node.freeResources) } : {}),
      priority: node.priority || 0,
    });
    return;
  }
  if (node.op === 'set_stance') {
    events.push({ type: 'set_stance', target: node.target, stance: clone(node.stance) });
    return;
  }
  if (node.op === 'channel_orb') {
    const orb = clone(node.orb);
    orb.value = roundBattleValue(evaluateNumericExpression(node.orb.value, state, context, `${path}.orb.value`));
    events.push({ type: 'channel_orb', target: node.target, orb });
    return;
  }
  if (node.op === 'evoke_orbs') {
    events.push({ type: 'evoke_orbs', target: node.target, selector: clone(node.selector) });
    return;
  }
  if (node.op === 'set_orb_slots') {
    events.push({
      type: 'set_orb_slots', target: node.target,
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true),
    });
    return;
  }
  if (node.op === 'modify_orbs') {
    events.push({
      type: 'modify_orbs', target: node.target, selector: clone(node.selector), operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    });
    return;
  }
  if (node.op === 'grant_extra_turn') {
    events.push({
      type: 'grant_extra_turn', target: node.target,
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true),
    });
    return;
  }
  if (node.op === 'force_end_turn') {
    events.push({ type: 'force_end_turn', target: node.target });
    return;
  }
  if (node.op === 'register_trigger') {
    events.push({
      type: 'register_trigger',
      target: node.target,
      trigger: node.trigger,
      ...(node.eventQuery ? { eventQuery: clone(node.eventQuery) } : {}),
      effects: clone(node.effects),
    });
    return;
  }
  if (node.op === 'spawn_summon') {
    events.push({
      type: 'spawn_summon', target: node.target, summon: clone(node.summon),
      count: evaluateAmount(node.count, state, context, `${path}.count`, true),
      capacity: node.capacity ?? 3, overflow: node.overflow ?? 'replace_oldest',
    });
    return;
  }
  if (node.op === 'spawn_enemy') {
    events.push({
      type: 'spawn_enemy', enemy: clone(node.enemy),
      count: evaluateAmount(node.count, state, context, `${path}.count`, true),
      capacity: node.capacity ?? 8,
    });
    return;
  }
  if (node.op === 'damage_summons' || node.op === 'heal_summons') {
    events.push({
      type: node.op, selector: clone(node.selector),
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`),
    });
    return;
  }
  if (node.op === 'modify_summons') {
    events.push({
      type: 'modify_summons', selector: clone(node.selector), stat: node.stat, operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    });
    return;
  }
  if (node.op === 'modify_summon_effects') {
    events.push({
      type: 'modify_summon_effects', selector: clone(node.selector), stat: node.stat, operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    });
    return;
  }
  if (node.op === 'gain_summon_resource' || node.op === 'set_summon_resource') {
    const field = node.op === 'gain_summon_resource' ? 'amount' : 'value';
    const expression = node.op === 'gain_summon_resource' ? node.amount : node.value;
    events.push({
      type: node.op, selector: clone(node.selector), resource: node.resource,
      [field]: evaluateAmount(expression, state, context, `${path}.${field}`, true),
    } as Extract<CoreEffectEvent, { type: typeof node.op }>);
    return;
  }
  if (node.op === 'apply_summon_status') {
    events.push({
      type: 'apply_summon_status', selector: clone(node.selector), status: node.status,
      stacks: evaluateAmount(node.stacks, state, context, `${path}.stacks`, true),
    });
    return;
  }
  if (node.op === 'remove_summon_status') {
    events.push({ type: 'remove_summon_status', selector: clone(node.selector), status: node.status });
    return;
  }
  if (node.op === 'activate_summons') {
    events.push({ type: 'activate_summons', selector: clone(node.selector) });
    return;
  }
  if (node.op === 'dismiss_summons') {
    events.push({ type: 'dismiss_summons', selector: clone(node.selector), retainCorpse: node.retainCorpse === true });
    return;
  }
  if (node.op === 'copy_summons') {
    events.push({
      type: 'copy_summons', selector: clone(node.selector), targetOwner: node.targetOwner ?? 'same',
      capacity: node.capacity ?? 3, overflow: node.overflow ?? 'replace_oldest',
    });
    return;
  }
  if (node.op === 'summoner_effects') {
    events.push({ type: 'summoner_effects', effects: clone(node.effects) });
    return;
  }
  const entity = state[node.target];
  if (node.op === 'apply_status') {
    const stacks = evaluateAmount(node.stacks, state, context, `${path}.stacks`, true);
    entity.statusStacks = { ...(entity.statusStacks || {}) };
    entity.statusStacks[node.status] = (entity.statusStacks[node.status] || 0) + stacks;
    events.push({ type: 'apply_status', target: node.target, status: node.status, stacks });
    return;
  }
  if (node.op === 'remove_status') {
    entity.statusStacks = { ...(entity.statusStacks || {}) };
    if (node.status === 'all') entity.statusStacks = {};
    else if (node.status !== 'buffs' && node.status !== 'debuffs') delete entity.statusStacks[node.status];
    events.push({ type: 'remove_status', target: node.target, status: node.status });
    return;
  }
  if (node.op === 'set_stat') {
    const value = node.stat === 'energy'
      ? Math.floor(evaluateNumericExpression(node.value, state, context, `${path}.value`))
      : roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`));
    writeStat(entity, node.stat, value);
    events.push({ type: 'set_stat', target: node.target, stat: node.stat, value: readStat(entity, node.stat) });
    return;
  }
  if (node.op === 'gain_resource' || node.op === 'set_resource') {
    entity.resources = { ...(entity.resources || {}) };
    const maximum = Math.max(0, entity.maxResources?.[node.resource] ?? Number.POSITIVE_INFINITY);
    const previous = entity.resources[node.resource] || 0;
    const field = node.op === 'gain_resource' ? 'amount' : 'value';
    const expression = node.op === 'gain_resource' ? node.amount : node.value;
    const evaluated = evaluateNumericExpression(expression, state, context, `${path}.${field}`);
    const next = Math.max(
      0,
      Math.min(maximum, Math.floor(node.op === 'gain_resource' ? previous + evaluated : evaluated)),
    );
    entity.resources[node.resource] = next;
    if (node.op === 'gain_resource') {
      events.push({ type: 'gain_resource', target: node.target, resource: node.resource, amount: next - previous });
    } else {
      events.push({ type: 'set_resource', target: node.target, resource: node.resource, value: next });
    }
    return;
  }
  if (node.op === 'execute' || node.op === 'kill') {
    const previousHp = entity.hp;
    const excludedBy = node.excludeTags?.find(tag => entity.tags?.includes(tag));
    const threshold = node.op === 'execute'
      ? evaluateAmount(node.threshold, state, context, `${path}.threshold`)
      : undefined;
    const thresholdHp = node.op === 'execute'
      ? node.thresholdMode === 'hp_percent'
        ? roundBattleValue(entity.maxHp * (threshold || 0) / 100)
        : threshold || 0
      : Number.POSITIVE_INFINITY;
    const succeeded = !excludedBy && entity.hp > 0 && entity.hp <= thresholdHp;
    if (succeeded) entity.hp = 0;
    events.push({
      type: 'defeat', target: node.target, method: node.op, succeeded, previousHp,
      ...(node.op === 'execute' ? { threshold: threshold as number, thresholdMode: node.thresholdMode } : {}),
      fatal: succeeded && node.triggerFatal !== false,
      ...(excludedBy ? { excludedBy } : {}),
    });
    return;
  }
  const amount = evaluateAmount(
    node.amount,
    state,
    context,
    `${path}.amount`,
    node.op === 'gain_energy',
    node.op === 'gain_energy' || node.op === 'gain_lust',
  );
  if (node.op === 'damage') {
    const bypassBlock = node.bypassBlock === true || node.damageKind === 'hp_loss';
    const blocked = bypassBlock ? 0 : roundBattleValue(Math.min(entity.block, amount));
    entity.block = roundBattleValue(entity.block - blocked);
    const hpLost = roundBattleValue(Math.min(entity.hp, amount - blocked));
    entity.hp = roundBattleValue(entity.hp - hpLost);
    const lifesteal = node.lifesteal === undefined
      ? 0
      : evaluateAmount(node.lifesteal, state, context, `${path}.lifesteal`);
    events.push({
      type: 'damage', target: node.target, requested: amount, blocked, hpLost,
      ...(node.damageKind ? { damageKind: node.damageKind } : {}),
      ...(bypassBlock ? { bypassBlock: true } : {}),
      ...(lifesteal > 0 ? { lifesteal } : {}),
    });
    if (lifesteal > 0 && hpLost > 0) {
      const previous = state.self.hp;
      state.self.hp = roundBattleValue(clamp(state.self.hp + hpLost * lifesteal, 0, state.self.maxHp));
      events.push({ type: 'heal', target: 'self', requested: hpLost * lifesteal, hpGained: roundBattleValue(state.self.hp - previous) });
    }
  } else if (node.op === 'heal') {
    const previous = entity.hp;
    entity.hp = roundBattleValue(clamp(entity.hp + amount, 0, entity.maxHp));
    events.push({ type: 'heal', target: node.target, requested: amount, hpGained: roundBattleValue(entity.hp - previous) });
  } else if (node.op === 'gain_block') {
    entity.block = roundBattleValue(entity.block + amount);
    events.push({ type: 'gain_block', target: node.target, amount });
  } else if (node.op === 'gain_energy') {
    const previous = entity.energy;
    entity.energy = Math.max(0, entity.energy + amount);
    events.push({ type: 'gain_energy', target: node.target, amount: entity.energy - previous });
  } else {
    const previous = entity.lust;
    entity.lust = roundBattleValue(clamp(entity.lust + amount, 0, entity.maxLust));
    events.push({ type: 'gain_lust', target: node.target, amount: roundBattleValue(entity.lust - previous) });
  }
}

export function executeEffectProgram(
  value: unknown,
  inputState: CoreEffectState,
  context: EffectExecutionContext,
): EffectExecutionResult {
  const original = clone(inputState);
  const validation = validateEffectProgram(value);
  if (!validation.ok) {
    const first = validation.issues[0];
    return {
      ok: false,
      error: new EffectExecutionError(first.code, first.path, first.message),
      state: original,
      events: [],
    };
  }
  const state = clone(inputState);
  const events: CoreEffectEvent[] = [];
  try {
    validation.value.steps.forEach((effect, index) => executeNode(effect, state, context, events, `$.steps[${index}]`));
    return { ok: true, state, events };
  } catch (error) {
    const executionError =
      error instanceof EffectExecutionError
        ? error
        : new EffectExecutionError('EXECUTION_FAILED', '$', error instanceof Error ? error.message : '效果执行失败');
    return { ok: false, error: executionError, state: original, events: [] };
  }
}
