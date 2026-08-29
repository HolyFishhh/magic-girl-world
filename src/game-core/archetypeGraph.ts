import {
  extractContentMechanicFeatures,
  mergeContentMechanicFeatures,
  type ContentMechanicFeatures,
  type ContentMechanicRole,
} from './contentMechanicFeatures';
import type { ContentDefinition, ContentPack } from './contentPack';
import { createContentMechanicsFingerprint } from './contentFingerprint';

export const ARCHETYPE_GRAPH_SPEC = 'mwg.archetype-graph/v1' as const;

export type ArchetypeFeatureField =
  | 'operations'
  | 'axes'
  | 'targets'
  | 'zones'
  | 'triggers'
  | 'roles'
  | 'statuses'
  | 'resources';

export interface ArchetypeFeaturePredicate {
  field: ArchetypeFeatureField;
  values?: string[];
  mode?: 'all' | 'any';
  minimum?: number;
}

export interface WeightedArchetypeFeature extends ArchetypeFeaturePredicate {
  weight: number;
}

export interface ArchetypeNeighbor {
  target: string;
  transitionCost: number;
  bridgeFeatures: string[];
}

export interface ArchetypeNode {
  id: string;
  label: string;
  description: string;
  requiredFeatures: ArchetypeFeaturePredicate[];
  optionalFeatures: WeightedArchetypeFeature[];
  payoffFeatures: ArchetypeFeaturePredicate[];
  genericRoles: ContentMechanicRole[];
  antiSynergies: string[];
  neighbors: ArchetypeNeighbor[];
}

export interface ArchetypeAffinity {
  id: string;
  label: string;
  description: string;
  score: number;
  share: number;
  supportingCards: string[];
  missingPayoffs: string[];
}

export interface DeckArchetypeProfile {
  spec: typeof ARCHETYPE_GRAPH_SPEC;
  fingerprint: string;
  affinities: ArchetypeAffinity[];
  scatterShare: number;
  primary: string[];
  bridges: Array<{ from: string; to: string; transitionCost: number; bridgeFeatures: string[] }>;
  cards: Array<{
    id: string;
    name: string;
    quantity: number;
    affinities: Array<Pick<ArchetypeAffinity, 'id' | 'label' | 'score'>>;
    /** Marginal total-deck score supplied by the reward planner. */
    scoreContribution?: number;
    scoreContributionRatio?: number;
  }>;
  evolutionSuggestions: Array<{
    from: string;
    to: string;
    label: string;
    description: string;
    transitionCost: number;
    bridgeFeatures: string[];
  }>;
}

export interface ArchetypeGraphIssue {
  code: 'DUPLICATE_ID' | 'SELF_EDGE' | 'DANGLING_EDGE' | 'DUPLICATE_EDGE' | 'EMPTY_REQUIREMENT';
  nodeId: string;
  detail: string;
}

type RawNode = Omit<ArchetypeNode, 'neighbors'> & { neighborHints?: string[] };

const op = (...values: string[]): ArchetypeFeaturePredicate => ({ field: 'operations', values, mode: 'all' });
const anyOp = (...values: string[]): ArchetypeFeaturePredicate => ({ field: 'operations', values, mode: 'any' });
const axis = (...values: string[]): ArchetypeFeaturePredicate => ({ field: 'axes', values, mode: 'all' });
const anyAxis = (...values: string[]): ArchetypeFeaturePredicate => ({ field: 'axes', values, mode: 'any' });
const trigger = (...values: string[]): ArchetypeFeaturePredicate => ({ field: 'triggers', values, mode: 'any' });
const zone = (...values: string[]): ArchetypeFeaturePredicate => ({ field: 'zones', values, mode: 'any' });
const count = (field: 'statuses' | 'resources', minimum = 1): ArchetypeFeaturePredicate => ({ field, minimum });
const weighted = (predicate: ArchetypeFeaturePredicate, weight: number): WeightedArchetypeFeature => ({ ...predicate, weight });

/**
 * Mechanic-combination archetypes. Names are UI labels only: matching never relies on
 * a concrete status/card/enemy name, so a new poison, burn, curse or custom resource
 * automatically participates through its effect structure.
 */
const RAW_ARCHETYPES: RawNode[] = [
  {
    id: 'direct-pressure', label: '直接压制', description: '用稳定的即时伤害缩短战斗。',
    requiredFeatures: [op('damage')], optionalFeatures: [weighted(anyOp('draw', 'energy', 'resource'), 2)],
    payoffFeatures: [op('damage')], genericRoles: ['收益', '终结'], antiSynergies: ['stall-only'],
    neighborHints: ['multi-hit', 'critical-scaling', 'execute-finish', 'tempo-cycle'],
  },
  {
    id: 'multi-hit', label: '多段连击', description: '把一次行动拆成多次命中以放大命中触发。',
    requiredFeatures: [op('damage')], optionalFeatures: [weighted(anyOp('trigger', 'history_formula', 'apply_status'), 3)],
    payoffFeatures: [anyOp('trigger', 'history_formula', 'modify')], genericRoles: ['启动', '收益'], antiSynergies: ['single-hit-only'],
    neighborHints: ['direct-pressure', 'on-hit-engine', 'status-stack', 'replay-chain'],
  },
  {
    id: 'critical-scaling', label: '倍率爆发', description: '通过条件、修饰符或资源把普通伤害放大为爆发。',
    requiredFeatures: [op('damage'), anyOp('condition', 'modify', 'x_formula', 'history_formula')],
    optionalFeatures: [weighted(anyOp('resource', 'set_resource', 'apply_status'), 2)], payoffFeatures: [op('damage')],
    genericRoles: ['启动', '终结'], antiSynergies: ['flat-only'], neighborHints: ['direct-pressure', 'resource-cashout', 'status-detonation'],
  },
  {
    id: 'execute-finish', label: '斩杀终结', description: '把生命阈值或击杀事件转化为明确终结窗口。',
    requiredFeatures: [anyOp('execute', 'kill')], optionalFeatures: [weighted(anyOp('condition', 'damage'), 2)],
    payoffFeatures: [anyOp('execute', 'kill')], genericRoles: ['终结'], antiSynergies: ['nonlethal-only'],
    neighborHints: ['direct-pressure', 'status-detonation', 'missing-hp-pressure'],
  },
  {
    id: 'status-stack', label: '状态积累', description: '持续施加可叠层状态并围绕层数取得收益。',
    requiredFeatures: [op('apply_status'), count('statuses')], optionalFeatures: [weighted(anyOp('history_formula', 'trigger', 'modify'), 3)],
    payoffFeatures: [anyOp('damage', 'lust', 'modify', 'condition')], genericRoles: ['启动', '成长'], antiSynergies: ['status-purge'],
    neighborHints: ['status-detonation', 'status-conversion', 'status-scaling', 'enemy-status-benefit'],
  },
  {
    id: 'damage-over-time', label: '持续伤害', description: '让状态或延迟效果跨回合稳定制造压力。',
    requiredFeatures: [op('damage'), anyOp('trigger', 'schedule'), count('statuses')],
    optionalFeatures: [weighted(trigger('tick', 'turn_end', 'turn_start'), 3)], payoffFeatures: [op('damage')],
    genericRoles: ['成长', '收益'], antiSynergies: ['instant-purge'], neighborHints: ['status-stack', 'status-detonation', 'delayed-payoff'],
  },
  {
    id: 'status-detonation', label: '状态引爆', description: '消费或清除已积累状态，换取一次集中收益。',
    requiredFeatures: [op('remove_status'), count('statuses')], optionalFeatures: [weighted(anyOp('damage', 'lust', 'heal', 'block'), 4)],
    payoffFeatures: [anyOp('damage', 'lust', 'heal', 'block')], genericRoles: ['收益', '终结'], antiSynergies: ['status-preservation'],
    neighborHints: ['status-stack', 'damage-over-time', 'execute-finish', 'status-conversion'],
  },
  {
    id: 'status-conversion', label: '状态转化', description: '把状态层数转换为另一类资源、防护或压力。',
    requiredFeatures: [count('statuses'), anyOp('condition', 'history_formula', 'modify', 'remove_status')],
    optionalFeatures: [weighted(anyOp('resource', 'energy', 'block', 'heal', 'damage', 'lust'), 3)],
    payoffFeatures: [anyAxis('格挡', '恢复', '生命压制', '欲望压制', '自定义资源')], genericRoles: ['桥接', '收益'], antiSynergies: [],
    neighborHints: ['status-stack', 'status-detonation', 'resource-engine', 'block-conversion'],
  },
  {
    id: 'status-scaling', label: '状态成长', description: '持有或叠加状态时持续强化后续行动。',
    requiredFeatures: [count('statuses'), anyOp('modify', 'trigger', 'history_formula')],
    optionalFeatures: [weighted(op('apply_status'), 3)], payoffFeatures: [anyOp('damage', 'block', 'draw', 'energy')],
    genericRoles: ['成长', '收益'], antiSynergies: ['status-purge'], neighborHints: ['status-stack', 'on-hit-engine', 'power-engine'],
  },
  {
    id: 'enemy-status-benefit', label: '敌方状态反哺', description: '敌方持有或获得状态时，为己方提供额外收益。',
    requiredFeatures: [count('statuses'), anyOp('trigger', 'condition', 'history_formula')],
    optionalFeatures: [weighted(anyOp('heal', 'block', 'draw', 'energy', 'resource'), 3)],
    payoffFeatures: [anyAxis('格挡', '恢复', '牌序', '自定义资源')], genericRoles: ['桥接', '收益'], antiSynergies: ['status-purge'],
    neighborHints: ['status-stack', 'status-conversion', 'reactive-control'],
  },
  {
    id: 'desire-pressure', label: '欲望压制', description: '以欲望作为独立胜利或控制轴持续施压。',
    requiredFeatures: [op('lust')], optionalFeatures: [weighted(anyOp('apply_status', 'condition', 'trigger'), 2)],
    payoffFeatures: [op('lust')], genericRoles: ['收益', '终结'], antiSynergies: ['lust-reset-only'],
    neighborHints: ['desire-overflow', 'desire-conversion', 'mixed-pressure'],
  },
  {
    id: 'desire-overflow', label: '欲望溢出', description: '围绕欲望满溢效果安排终结、反转或叙事后果。',
    requiredFeatures: [axis('欲望压制'), anyOp('damage', 'apply_status', 'resource', 'heal', 'block')],
    optionalFeatures: [weighted(anyOp('trigger', 'condition'), 2)], payoffFeatures: [anyAxis('生命压制', '状态', '自定义资源')],
    genericRoles: ['终结', '桥接'], antiSynergies: [], neighborHints: ['desire-pressure', 'desire-conversion', 'status-stack'],
  },
  {
    id: 'desire-conversion', label: '欲望转化', description: '把欲望变化转换为生命、资源、防护或伤害。',
    requiredFeatures: [axis('欲望压制'), anyAxis('生命压制', '格挡', '恢复', '自定义资源')],
    optionalFeatures: [weighted(anyOp('condition', 'trigger', 'modify'), 3)], payoffFeatures: [anyOp('damage', 'block', 'heal', 'resource')],
    genericRoles: ['桥接', '收益'], antiSynergies: [], neighborHints: ['desire-pressure', 'desire-overflow', 'resource-engine'],
  },
  {
    id: 'mixed-pressure', label: '双轴压制', description: '在生命与欲望两条路线之间切换或同时推进。',
    requiredFeatures: [axis('生命压制', '欲望压制')], optionalFeatures: [weighted(anyOp('condition', 'trigger'), 2)],
    payoffFeatures: [anyOp('damage', 'lust')], genericRoles: ['桥接', '终结'], antiSynergies: [],
    neighborHints: ['direct-pressure', 'desire-pressure', 'desire-conversion'],
  },
  {
    id: 'block-engine', label: '格挡循环', description: '稳定生成格挡并把防守转化为节奏优势。',
    requiredFeatures: [op('block')], optionalFeatures: [weighted(anyOp('draw', 'energy', 'trigger', 'modify'), 2)],
    payoffFeatures: [op('block')], genericRoles: ['启动', '循环'], antiSynergies: ['block-disabled'],
    neighborHints: ['block-retention', 'block-conversion', 'retaliation', 'stall-control'],
  },
  {
    id: 'block-retention', label: '格挡留存', description: '跨回合保存防护并为延迟成长争取时间。',
    requiredFeatures: [axis('格挡'), anyOp('card_rule', 'trigger', 'modify')],
    optionalFeatures: [weighted(trigger('turn_start', 'turn_end'), 3)], payoffFeatures: [op('block')],
    genericRoles: ['循环', '成长'], antiSynergies: ['block-reset'], neighborHints: ['block-engine', 'delayed-payoff', 'stall-control'],
  },
  {
    id: 'block-conversion', label: '格挡转化', description: '把格挡量、格挡获得或格挡消耗转换为进攻与资源。',
    requiredFeatures: [axis('格挡'), anyAxis('生命压制', '欲望压制', '自定义资源')],
    optionalFeatures: [weighted(anyOp('history_formula', 'condition', 'trigger'), 3)], payoffFeatures: [anyOp('damage', 'lust', 'resource')],
    genericRoles: ['桥接', '收益'], antiSynergies: [], neighborHints: ['block-engine', 'status-conversion', 'resource-cashout'],
  },
  {
    id: 'retaliation', label: '反击', description: '在承受、格挡或避免伤害后反向制造压力。',
    requiredFeatures: [op('damage'), anyOp('trigger', 'history_formula')],
    optionalFeatures: [weighted(trigger('damaged', 'block_gained', 'hp_lost'), 4)], payoffFeatures: [op('damage')],
    genericRoles: ['控制', '收益'], antiSynergies: ['never-targeted'], neighborHints: ['block-engine', 'self-damage', 'reactive-control'],
  },
  {
    id: 'healing-engine', label: '恢复循环', description: '通过稳定恢复延长资源交换并支撑成长。',
    requiredFeatures: [op('heal')], optionalFeatures: [weighted(anyOp('trigger', 'resource', 'draw'), 2)],
    payoffFeatures: [op('heal')], genericRoles: ['循环', '成长'], antiSynergies: ['healing-disabled'],
    neighborHints: ['healing-conversion', 'self-damage', 'resource-engine'],
  },
  {
    id: 'healing-conversion', label: '恢复转化', description: '把治疗、过量治疗或生命变化转化为进攻与资源。',
    requiredFeatures: [axis('恢复'), anyAxis('生命压制', '欲望压制', '自定义资源')],
    optionalFeatures: [weighted(anyOp('trigger', 'history_formula', 'condition'), 3)], payoffFeatures: [anyOp('damage', 'lust', 'resource')],
    genericRoles: ['桥接', '收益'], antiSynergies: [], neighborHints: ['healing-engine', 'self-damage', 'resource-cashout'],
  },
  {
    id: 'self-damage', label: '自伤交换', description: '主动支付生命换取超额效率，并要求可靠回收手段。',
    requiredFeatures: [op('damage'), { field: 'targets', values: ['self'], mode: 'any' }],
    optionalFeatures: [weighted(anyOp('heal', 'block', 'resource', 'draw'), 3)], payoffFeatures: [anyAxis('生命压制', '恢复', '自定义资源')],
    genericRoles: ['风险', '收益'], antiSynergies: ['low-max-hp'], neighborHints: ['healing-engine', 'missing-hp-pressure', 'retaliation'],
  },
  {
    id: 'missing-hp-pressure', label: '残血爆发', description: '依据已损生命或低生命条件强化行动。',
    requiredFeatures: [op('condition'), anyOp('damage', 'block', 'heal')],
    optionalFeatures: [weighted(anyOp('history_formula', 'modify'), 2)], payoffFeatures: [anyOp('damage', 'block', 'heal')],
    genericRoles: ['风险', '终结'], antiSynergies: ['full-hp-only'], neighborHints: ['self-damage', 'execute-finish', 'healing-conversion'],
  },
  {
    id: 'draw-engine', label: '抽牌引擎', description: '提高看牌量与关键组件的到手稳定性。',
    requiredFeatures: [op('draw')], optionalFeatures: [weighted(anyOp('energy', 'resource', 'discard', 'exhaust'), 2)],
    payoffFeatures: [anyOp('damage', 'block', 'apply_status', 'trigger')], genericRoles: ['启动', '循环'], antiSynergies: ['draw-lock'],
    neighborHints: ['tempo-cycle', 'discard-engine', 'exhaust-engine', 'zero-cost-engine'],
  },
  {
    id: 'tempo-cycle', label: '快速轮转', description: '用抽牌、检索、占卜或回收快速重复关键牌。',
    requiredFeatures: [anyOp('draw', 'scry', 'seek', 'recover')], optionalFeatures: [weighted(zone('draw', 'discard', 'exhaust'), 2)],
    payoffFeatures: [anyOp('recover', 'move_card', 'draw')], genericRoles: ['循环', '启动'], antiSynergies: ['large-dead-deck'],
    neighborHints: ['draw-engine', 'topdeck-control', 'discard-engine', 'replay-chain'],
  },
  {
    id: 'discard-engine', label: '弃牌引擎', description: '主动弃牌触发收益并改善手牌质量。',
    requiredFeatures: [op('discard')], optionalFeatures: [weighted(anyOp('trigger', 'history_formula', 'draw', 'energy'), 3)],
    payoffFeatures: [anyOp('trigger', 'history_formula', 'draw', 'energy', 'damage')], genericRoles: ['启动', '循环', '收益'], antiSynergies: ['retain-everything'],
    neighborHints: ['draw-engine', 'discard-payoff', 'graveyard-recovery', 'auto-play-engine'],
  },
  {
    id: 'discard-payoff', label: '弃牌收益', description: '以本回合或本场弃牌事件作为主要收益来源。',
    requiredFeatures: [anyOp('history_formula', 'trigger'), op('discard')], optionalFeatures: [weighted(anyOp('damage', 'block', 'energy', 'draw'), 3)],
    payoffFeatures: [anyOp('damage', 'block', 'energy', 'draw')], genericRoles: ['收益', '终结'], antiSynergies: [],
    neighborHints: ['discard-engine', 'replay-chain', 'resource-engine'],
  },
  {
    id: 'exhaust-engine', label: '消耗引擎', description: '通过消耗精简循环并触发额外收益。',
    requiredFeatures: [op('exhaust')], optionalFeatures: [weighted(anyOp('trigger', 'history_formula', 'recover'), 3)],
    payoffFeatures: [anyOp('damage', 'block', 'draw', 'energy', 'recover')], genericRoles: ['启动', '循环', '收益'], antiSynergies: ['must-retain-all'],
    neighborHints: ['draw-engine', 'exhaust-recovery', 'thin-deck', 'curse-utilization'],
  },
  {
    id: 'exhaust-recovery', label: '消耗回收', description: '从消耗区取回卡牌，让一次性资源转为可控循环。',
    requiredFeatures: [op('recover'), zone('exhaust')], optionalFeatures: [weighted(op('exhaust'), 4)],
    payoffFeatures: [op('recover')], genericRoles: ['循环', '桥接'], antiSynergies: [], neighborHints: ['exhaust-engine', 'tempo-cycle', 'generated-card-engine'],
  },
  {
    id: 'graveyard-recovery', label: '弃牌堆回收', description: '从弃牌区定向取回关键组件并形成短循环。',
    requiredFeatures: [op('recover'), zone('discard')], optionalFeatures: [weighted(anyOp('discard', 'move_card'), 3)],
    payoffFeatures: [op('recover')], genericRoles: ['循环', '桥接'], antiSynergies: [], neighborHints: ['discard-engine', 'tempo-cycle', 'topdeck-control'],
  },
  {
    id: 'topdeck-control', label: '牌顶控制', description: '操纵抽牌堆顶部、底部与顺序来安排未来回合。',
    requiredFeatures: [anyOp('scry', 'seek', 'move_card'), zone('draw')], optionalFeatures: [weighted(anyOp('draw', 'card_destination'), 2)],
    payoffFeatures: [anyOp('draw', 'auto_play', 'condition')], genericRoles: ['控制', '启动'], antiSynergies: ['randomize-deck'],
    neighborHints: ['tempo-cycle', 'delayed-payoff', 'auto-play-engine'],
  },
  {
    id: 'thin-deck', label: '牌库精简', description: '移除、消耗或变形低效牌以提高核心循环密度。',
    requiredFeatures: [anyOp('remove_card', 'exhaust', 'transform_card')], optionalFeatures: [weighted(anyOp('draw', 'recover'), 2)],
    payoffFeatures: [anyOp('draw', 'history_formula', 'trigger')], genericRoles: ['循环', '成长'], antiSynergies: ['generated-clutter'],
    neighborHints: ['exhaust-engine', 'tempo-cycle', 'card-evolution'],
  },
  {
    id: 'zero-cost-engine', label: '零费连锁', description: '围绕免费或极低费用卡牌扩展单回合行动量。',
    requiredFeatures: [anyOp('free', 'reduce_cost')], optionalFeatures: [weighted(anyOp('draw', 'replay', 'history_formula'), 3)],
    payoffFeatures: [anyOp('draw', 'replay', 'damage', 'apply_status')], genericRoles: ['启动', '循环'], antiSynergies: ['play-limit'],
    neighborHints: ['draw-engine', 'replay-chain', 'cost-shift', 'on-play-engine'],
  },
  {
    id: 'cost-shift', label: '费用操纵', description: '动态调整卡牌费用以跨回合安排爆发。',
    requiredFeatures: [anyOp('reduce_cost', 'patch_card', 'modify_card', 'free')], optionalFeatures: [weighted(anyOp('retain', 'draw'), 2)],
    payoffFeatures: [anyOp('damage', 'draw', 'replay')], genericRoles: ['启动', '成长'], antiSynergies: ['fixed-cost-only'],
    neighborHints: ['zero-cost-engine', 'x-cost-engine', 'retain-engine', 'card-evolution'],
  },
  {
    id: 'x-cost-engine', label: 'X费爆发', description: '把可支配资源总量直接转换为可调节效果。',
    requiredFeatures: [anyOp('x_cost', 'x_formula')], optionalFeatures: [weighted(anyOp('resource', 'energy', 'set_resource'), 3)],
    payoffFeatures: [anyOp('damage', 'block', 'lust', 'apply_status')], genericRoles: ['终结', '桥接'], antiSynergies: ['resource-starved'],
    neighborHints: ['resource-hoard', 'resource-cashout', 'cost-shift'],
  },
  {
    id: 'retain-engine', label: '保留蓄势', description: '保留关键牌，跨回合等待资源或条件成熟。',
    requiredFeatures: [anyOp('retain', 'card_destination')], optionalFeatures: [weighted(anyOp('condition', 'reduce_cost', 'patch_card'), 2)],
    payoffFeatures: [anyOp('damage', 'block', 'x_formula', 'apply_status')], genericRoles: ['成长', '终结'], antiSynergies: ['forced-discard'],
    neighborHints: ['cost-shift', 'delayed-payoff', 'topdeck-control'],
  },
  {
    id: 'replay-chain', label: '回响连锁', description: '让卡牌完整重复结算，并放大出牌触发与组合。',
    requiredFeatures: [anyOp('replay', 'double')], optionalFeatures: [weighted(anyOp('trigger', 'history_formula', 'free'), 3)],
    payoffFeatures: [anyOp('damage', 'block', 'apply_status', 'draw')], genericRoles: ['收益', '循环'], antiSynergies: ['single-resolution'],
    neighborHints: ['multi-hit', 'zero-cost-engine', 'on-play-engine', 'auto-play-engine'],
  },
  {
    id: 'auto-play-engine', label: '自动出牌', description: '从弃牌、抽牌或触发器自动打出卡牌。',
    requiredFeatures: [op('auto_play')], optionalFeatures: [weighted(anyOp('discard', 'move_card', 'trigger', 'free'), 3)],
    payoffFeatures: [anyOp('damage', 'block', 'apply_status', 'draw')], genericRoles: ['循环', '收益'], antiSynergies: ['manual-only'],
    neighborHints: ['discard-engine', 'topdeck-control', 'replay-chain', 'generated-card-engine'],
  },
  {
    id: 'on-play-engine', label: '出牌触发', description: '按出牌次数、类型或顺序持续积累收益。',
    requiredFeatures: [anyOp('trigger', 'history_formula')], optionalFeatures: [weighted(trigger('card_played', 'attack_played', 'skill_played'), 4)],
    payoffFeatures: [anyOp('damage', 'block', 'draw', 'energy', 'apply_status')], genericRoles: ['成长', '收益'], antiSynergies: ['play-limit'],
    neighborHints: ['zero-cost-engine', 'replay-chain', 'multi-hit', 'power-engine'],
  },
  {
    id: 'on-hit-engine', label: '命中触发', description: '每次造成实际伤害时追加状态、资源或防护。',
    requiredFeatures: [op('damage'), anyOp('trigger', 'history_formula')], optionalFeatures: [weighted(trigger('damage_dealt', 'hp_lost'), 4)],
    payoffFeatures: [anyOp('apply_status', 'resource', 'block', 'draw')], genericRoles: ['成长', '收益'], antiSynergies: ['non-damage'],
    neighborHints: ['multi-hit', 'status-scaling', 'resource-engine'],
  },
  {
    id: 'power-engine', label: '持续能力', description: '用能力或被动改变后续回合的规则与收益。',
    requiredFeatures: [op('trigger')], optionalFeatures: [weighted(anyOp('modify', 'card_rule', 'register_trigger'), 3)],
    payoffFeatures: [anyOp('damage', 'block', 'draw', 'energy', 'resource')], genericRoles: ['成长'], antiSynergies: ['short-fight'],
    neighborHints: ['on-play-engine', 'status-scaling', 'delayed-payoff', 'rule-control'],
  },
  {
    id: 'delayed-payoff', label: '延迟收益', description: '预约未来回合的爆发、防护或资源变化。',
    requiredFeatures: [op('schedule')], optionalFeatures: [weighted(anyOp('damage', 'block', 'heal', 'draw', 'resource'), 3)],
    payoffFeatures: [anyOp('damage', 'block', 'heal', 'draw', 'resource')], genericRoles: ['成长', '收益'], antiSynergies: ['forced-short-fight'],
    neighborHints: ['power-engine', 'retain-engine', 'topdeck-control', 'block-retention'],
  },
  {
    id: 'resource-engine', label: '资源引擎', description: '生成并稳定循环一种或多种战斗资源。',
    requiredFeatures: [anyOp('resource', 'set_resource', 'energy'), count('resources')],
    optionalFeatures: [weighted(anyOp('trigger', 'draw', 'condition'), 2)], payoffFeatures: [anyOp('damage', 'block', 'draw', 'heal')],
    genericRoles: ['启动', '循环'], antiSynergies: ['resource-lock'], neighborHints: ['resource-hoard', 'resource-cashout', 'multi-resource'],
  },
  {
    id: 'resource-hoard', label: '资源蓄积', description: '跨回合保存资源，等待高收益的集中消费窗口。',
    requiredFeatures: [count('resources'), anyOp('trigger', 'condition', 'set_resource')],
    optionalFeatures: [weighted(anyOp('retain', 'x_cost', 'x_formula'), 3)], payoffFeatures: [anyOp('x_formula', 'damage', 'block')],
    genericRoles: ['成长', '终结'], antiSynergies: ['resource-reset'], neighborHints: ['resource-engine', 'resource-cashout', 'x-cost-engine'],
  },
  {
    id: 'resource-cashout', label: '资源兑现', description: '消费已积累资源，换取集中伤害、防护或控制。',
    requiredFeatures: [count('resources'), anyOp('x_formula', 'condition', 'set_resource')],
    optionalFeatures: [weighted(anyOp('damage', 'lust', 'block', 'apply_status'), 3)], payoffFeatures: [anyOp('damage', 'lust', 'block', 'apply_status')],
    genericRoles: ['收益', '终结'], antiSynergies: ['resource-hoard-only'], neighborHints: ['resource-engine', 'resource-hoard', 'x-cost-engine'],
  },
  {
    id: 'multi-resource', label: '多资源编织', description: '让不同资源互相供给、转换或共同支付。',
    requiredFeatures: [{ field: 'resources', minimum: 2 }], optionalFeatures: [weighted(anyOp('resource', 'set_resource', 'x_formula'), 3)],
    payoffFeatures: [anyOp('damage', 'block', 'draw', 'apply_status')], genericRoles: ['桥接', '循环'], antiSynergies: ['single-resource-lock'],
    neighborHints: ['resource-engine', 'resource-cashout', 'stance-engine', 'orb-engine'],
  },
  {
    id: 'generated-card-engine', label: '衍生牌', description: '生成、确保或复制临时卡牌来扩展战术选择。',
    requiredFeatures: [anyOp('add_card', 'ensure_card', 'copy')], optionalFeatures: [weighted(anyOp('exhaust', 'auto_play', 'free'), 2)],
    payoffFeatures: [anyOp('damage', 'block', 'draw', 'apply_status')], genericRoles: ['启动', '桥接'], antiSynergies: ['hand-clog'],
    neighborHints: ['auto-play-engine', 'card-evolution', 'exhaust-engine'],
  },
  {
    id: 'card-evolution', label: '卡牌成长', description: '升级、附着、补丁或变形卡牌，使其跨阶段演化。',
    requiredFeatures: [anyOp('upgrade_card', 'patch_card', 'attach_card', 'transform_card')],
    optionalFeatures: [weighted(anyOp('history_formula', 'trigger', 'condition'), 2)], payoffFeatures: [anyOp('damage', 'block', 'draw', 'resource')],
    genericRoles: ['成长', '桥接'], antiSynergies: ['temporary-only'], neighborHints: ['generated-card-engine', 'cost-shift', 'enchantment-engine', 'affliction-engine'],
  },
  {
    id: 'enchantment-engine', label: '附魔构筑', description: '用正面附着改变单张卡的数值、费用或规则。',
    requiredFeatures: [anyOp('enchantment', 'attach_card')], optionalFeatures: [weighted(anyOp('patch_card', 'upgrade_card'), 2)],
    payoffFeatures: [anyOp('damage', 'block', 'draw', 'replay', 'free')], genericRoles: ['成长'], antiSynergies: ['transform-away'],
    neighborHints: ['card-evolution', 'cost-shift', 'replay-chain'],
  },
  {
    id: 'affliction-engine', label: '负面附着', description: '围绕可移除或可利用的卡牌负面附着进行交换。',
    requiredFeatures: [anyOp('affliction', 'attach_card')], optionalFeatures: [weighted(anyOp('remove_card', 'transform_card', 'trigger'), 3)],
    payoffFeatures: [anyOp('damage', 'draw', 'resource', 'remove_card')], genericRoles: ['风险', '桥接'], antiSynergies: ['unremovable-affliction'],
    neighborHints: ['card-evolution', 'curse-utilization', 'thin-deck'],
  },
  {
    id: 'curse-utilization', label: '诅咒利用', description: '把不可控或负面卡牌转化为触发、资源与收益。',
    requiredFeatures: [op('curse')], optionalFeatures: [weighted(anyOp('discard', 'exhaust', 'transform_card', 'trigger'), 3)],
    payoffFeatures: [anyOp('damage', 'block', 'draw', 'energy', 'resource')], genericRoles: ['风险', '收益'], antiSynergies: ['curse-purge-only'],
    neighborHints: ['discard-engine', 'exhaust-engine', 'affliction-engine', 'deck-pollution'],
  },
  {
    id: 'deck-pollution', label: '牌库污染', description: '向牌区加入负面牌或干扰牌，限制对手行动质量。',
    requiredFeatures: [anyOp('add_card', 'ensure_card'), op('curse')], optionalFeatures: [weighted(anyOp('auto_play', 'card_rule'), 2)],
    payoffFeatures: [anyOp('discard', 'exhaust', 'end_turn')], genericRoles: ['控制'], antiSynergies: ['thin-deck-opponent'],
    neighborHints: ['curse-utilization', 'rule-control', 'stall-control'],
  },
  {
    id: 'stance-engine', label: '姿态切换', description: '在互斥形态间切换，改变资源、修饰符或效果规则。',
    requiredFeatures: [op('stance')], optionalFeatures: [weighted(anyOp('trigger', 'modify', 'resource'), 3)],
    payoffFeatures: [anyOp('damage', 'block', 'draw', 'resource')], genericRoles: ['桥接', '成长'], antiSynergies: ['stance-lock'],
    neighborHints: ['multi-resource', 'power-engine', 'reactive-control'],
  },
  {
    id: 'orb-engine', label: 'Orb循环', description: '围绕槽位、被动值与主动激发管理独立容器。',
    requiredFeatures: [anyOp('channel_orb', 'evoke_orb', 'modify_orb', 'orb_slots')],
    optionalFeatures: [weighted(anyOp('trigger', 'resource', 'extra_turn'), 2)], payoffFeatures: [anyOp('damage', 'block', 'draw', 'resource')],
    genericRoles: ['启动', '循环', '收益'], antiSynergies: ['no-orb-slots'], neighborHints: ['multi-resource', 'delayed-payoff', 'summon-engine'],
  },
  {
    id: 'summon-engine', label: '召唤协同', description: '召唤独立单位承担攻击、防护与触发职责。',
    requiredFeatures: [op('spawn_summon')], optionalFeatures: [weighted(anyOp('activate_summon', 'heal_summon', 'modify_summon', 'modify_summon_effect', 'copy_summon', 'set_summon_resource', 'remove_summon_status'), 3)],
    payoffFeatures: [anyOp('activate_summon', 'damage_summon', 'summon_resource', 'summoner_effects')], genericRoles: ['启动', '成长'], antiSynergies: ['summon-capacity'],
    neighborHints: ['summon-swarm', 'summon-sacrifice', 'orb-engine'],
  },
  {
    id: 'summon-swarm', label: '召唤群攻', description: '通过多个召唤单位与额外行动形成持续压制。',
    requiredFeatures: [op('spawn_summon'), anyOp('activate_summon', 'trigger')],
    optionalFeatures: [weighted(anyOp('modify_summon', 'modify_summon_effect', 'copy_summon', 'summon_resource', 'set_summon_resource'), 2)], payoffFeatures: [anyOp('damage', 'apply_summon_status', 'remove_summon_status', 'summoner_effects')],
    genericRoles: ['成长', '收益'], antiSynergies: ['summon-capacity'], neighborHints: ['summon-engine', 'on-play-engine', 'multi-target'],
  },
  {
    id: 'summon-sacrifice', label: '召唤献祭', description: '消耗、伤害或解散召唤单位，换取集中收益。',
    requiredFeatures: [anyOp('damage_summon', 'dismiss_summon')], optionalFeatures: [weighted(anyOp('trigger', 'resource', 'damage', 'draw'), 3)],
    payoffFeatures: [anyOp('damage', 'draw', 'resource', 'spawn_summon')], genericRoles: ['风险', '终结'], antiSynergies: ['single-irreplaceable-summon'],
    neighborHints: ['summon-engine', 'resource-cashout', 'self-damage'],
  },
  {
    id: 'multi-target', label: '多目标压制', description: '通过全体、随机或条件选敌处理多敌人战斗。',
    requiredFeatures: [{ field: 'targets', values: ['all', 'random', 'random_n', 'lowest_hp', 'highest_hp', 'by_id'], mode: 'any' }],
    optionalFeatures: [weighted(anyOp('damage', 'lust', 'apply_status'), 3)], payoffFeatures: [anyOp('damage', 'lust', 'apply_status')],
    genericRoles: ['控制', '收益'], antiSynergies: ['single-boss-only'], neighborHints: ['direct-pressure', 'status-stack', 'summon-swarm'],
  },
  {
    id: 'reactive-control', label: '意图反制', description: '读取条件、行动或事件，在正确窗口进行防守与反击。',
    requiredFeatures: [anyOp('condition', 'trigger', 'history_formula'), anyOp('block', 'apply_status', 'end_turn', 'card_rule')],
    optionalFeatures: [weighted(anyOp('damage', 'draw', 'energy'), 2)], payoffFeatures: [anyOp('block', 'damage', 'apply_status')],
    genericRoles: ['控制', '收益'], antiSynergies: ['untelegraphed-random'], neighborHints: ['retaliation', 'rule-control', 'stall-control', 'enemy-status-benefit'],
  },
  {
    id: 'rule-control', label: '规则控制', description: '限制、替换或改写抽牌、出牌、费用与回合规则。',
    requiredFeatures: [anyOp('card_rule', 'end_turn', 'extra_turn', 'card_destination')],
    optionalFeatures: [weighted(anyOp('condition', 'trigger'), 3)], payoffFeatures: [anyOp('damage', 'block', 'draw')],
    genericRoles: ['控制', '成长'], antiSynergies: ['rule-immunity'], neighborHints: ['reactive-control', 'deck-pollution', 'power-engine', 'extra-turn-engine'],
  },
  {
    id: 'stall-control', label: '拖延控制', description: '通过减益、防护与规则限制延长成长窗口。',
    requiredFeatures: [anyOp('apply_status', 'block', 'card_rule'), anyOp('trigger', 'condition', 'schedule')],
    optionalFeatures: [weighted(anyOp('heal', 'draw', 'resource'), 2)], payoffFeatures: [anyOp('damage', 'execute', 'x_formula')],
    genericRoles: ['控制', '成长'], antiSynergies: ['hard-enrage'], neighborHints: ['block-engine', 'block-retention', 'reactive-control', 'delayed-payoff'],
  },
  {
    id: 'extra-turn-engine', label: '额外回合', description: '通过额外回合或强制结束回合重排双方行动节奏。',
    requiredFeatures: [anyOp('extra_turn', 'end_turn')], optionalFeatures: [weighted(anyOp('trigger', 'resource', 'card_rule'), 3)],
    payoffFeatures: [anyOp('damage', 'draw', 'block', 'resource')], genericRoles: ['控制', '终结'], antiSynergies: ['turn-cap'],
    neighborHints: ['rule-control', 'zero-cost-engine', 'resource-cashout'],
  },
  {
    id: 'random-gamble', label: '随机博弈', description: '用随机目标、随机牌或不确定收益换取更高上限。',
    requiredFeatures: [{ field: 'targets', values: ['random', 'random_n'], mode: 'any' }],
    optionalFeatures: [weighted(anyOp('choose', 'draw', 'add_card'), 2)], payoffFeatures: [anyOp('damage', 'block', 'draw', 'resource')],
    genericRoles: ['风险', '收益'], antiSynergies: ['precision-combo'], neighborHints: ['generated-card-engine', 'multi-target', 'tempo-cycle'],
  },
];

function valuesFor(features: ContentMechanicFeatures, field: ArchetypeFeatureField): readonly string[] {
  return features[field] as readonly string[];
}

function predicateMatches(features: ContentMechanicFeatures, predicate: ArchetypeFeaturePredicate): boolean {
  const actual = valuesFor(features, predicate.field);
  if (predicate.minimum !== undefined) return actual.length >= predicate.minimum;
  const values = predicate.values || [];
  if (values.length === 0) return true;
  return predicate.mode === 'any'
    ? values.some(value => actual.includes(value))
    : values.every(value => actual.includes(value));
}

function predicateLabel(predicate: ArchetypeFeaturePredicate): string {
  if (predicate.minimum !== undefined) return `${predicate.field}≥${predicate.minimum}`;
  return `${predicate.field}:${(predicate.values || []).join(predicate.mode === 'any' ? '|' : '+')}`;
}

function nodeFeatureKeys(node: RawNode): Set<string> {
  return new Set([
    ...node.requiredFeatures.flatMap(predicate => (predicate.values || []).map(value => `${predicate.field}:${value}`)),
    ...node.optionalFeatures.flatMap(predicate => (predicate.values || []).map(value => `${predicate.field}:${value}`)),
    ...node.payoffFeatures.flatMap(predicate => (predicate.values || []).map(value => `${predicate.field}:${value}`)),
  ]);
}

function graphNodes(): ArchetypeNode[] {
  const byId = new Map(RAW_ARCHETYPES.map(node => [node.id, node]));
  return RAW_ARCHETYPES.map(node => {
    const sourceKeys = nodeFeatureKeys(node);
    const candidateIds = new Set(node.neighborHints || []);
    for (const other of RAW_ARCHETYPES) {
      if (other.id === node.id) continue;
      const otherKeys = nodeFeatureKeys(other);
      const shared = [...sourceKeys].filter(key => otherKeys.has(key));
      if (shared.length >= 2) candidateIds.add(other.id);
    }
    const neighbors = [...candidateIds]
      .map(target => byId.get(target))
      .filter((target): target is RawNode => Boolean(target))
      .map(target => {
        const targetKeys = nodeFeatureKeys(target);
        const shared = [...sourceKeys].filter(key => targetKeys.has(key));
        const union = new Set([...sourceKeys, ...targetKeys]);
        const similarity = union.size ? shared.length / union.size : 0;
        const added = target.requiredFeatures
          .filter(predicate => !predicateMatches({
            operations: [...sourceKeys].filter(key => key.startsWith('operations:')).map(key => key.slice(11)),
            axes: [...sourceKeys].filter(key => key.startsWith('axes:')).map(key => key.slice(5)),
            targets: [...sourceKeys].filter(key => key.startsWith('targets:')).map(key => key.slice(8)),
            zones: [...sourceKeys].filter(key => key.startsWith('zones:')).map(key => key.slice(6)),
            triggers: [...sourceKeys].filter(key => key.startsWith('triggers:')).map(key => key.slice(9)),
            roles: [], statuses: [], resources: [], complexity: 0,
          }, predicate))
          .map(predicateLabel);
        return {
          target: target.id,
          transitionCost: Math.round(Math.max(0.1, 1 - similarity) * 100) / 100,
          bridgeFeatures: added.slice(0, 4),
        };
      })
      .sort((left, right) => left.transitionCost - right.transitionCost || left.target.localeCompare(right.target))
      .slice(0, 8);
    const { neighborHints: _neighborHints, ...stable } = node;
    return { ...stable, neighbors };
  });
}

export const ARCHETYPE_GRAPH: readonly ArchetypeNode[] = graphNodes();

function definitionLabel(definition: ContentDefinition, index: number): string {
  return String(definition.name || definition.id || `内容${index + 1}`);
}

function scoreNode(features: ContentMechanicFeatures, node: ArchetypeNode): { score: number; missingPayoffs: string[] } {
  const requiredMatches = node.requiredFeatures.filter(predicate => predicateMatches(features, predicate)).length;
  const requiredRatio = node.requiredFeatures.length ? requiredMatches / node.requiredFeatures.length : 1;
  if (requiredRatio < 0.5) return { score: 0, missingPayoffs: [] };
  const optionalTotal = node.optionalFeatures.reduce((sum, feature) => sum + feature.weight, 0);
  const optionalScore = node.optionalFeatures.reduce(
    (sum, feature) => sum + (predicateMatches(features, feature) ? feature.weight : 0),
    0,
  );
  const payoffMatches = node.payoffFeatures.filter(predicate => predicateMatches(features, predicate)).length;
  const payoffRatio = node.payoffFeatures.length ? payoffMatches / node.payoffFeatures.length : 1;
  const score = Math.round(Math.min(100, requiredRatio * 50 + (optionalTotal ? optionalScore / optionalTotal : 0) * 25 + payoffRatio * 25));
  return {
    score,
    missingPayoffs: node.payoffFeatures.filter(predicate => !predicateMatches(features, predicate)).map(predicateLabel),
  };
}

function expandedContentFeatures(definition: ContentDefinition, pack?: ContentPack): ContentMechanicFeatures {
  const base = extractContentMechanicFeatures(definition);
  if (!pack || base.statuses.length === 0) return base;
  const referenced = pack.statuses.filter(status => base.statuses.includes(String(status.id || '')));
  return mergeContentMechanicFeatures([base, ...referenced.map(extractContentMechanicFeatures)]);
}

export function scoreContentArchetypes(definition: ContentDefinition, pack?: ContentPack): ArchetypeAffinity[] {
  const features = expandedContentFeatures(definition, pack);
  return ARCHETYPE_GRAPH
    .map(node => {
      const result = scoreNode(features, node);
      return {
        id: node.id,
        label: node.label,
        description: node.description,
        score: result.score,
        share: 0,
        supportingCards: [],
        missingPayoffs: result.missingPayoffs,
      } satisfies ArchetypeAffinity;
    })
    .filter(result => result.score >= 35)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function quantity(definition: ContentDefinition): number {
  const value = Number(definition.quantity);
  return Number.isInteger(value) && value > 0 ? Math.min(100, value) : 1;
}

export function profileDeckArchetypes(pack: ContentPack): DeckArchetypeProfile {
  const scores = new Map<string, { total: number; cards: Set<string>; missing: Set<string> }>();
  const definitions: Array<{ value: ContentDefinition; weight: number; label: string }> = [
    ...pack.cards.map((value, index) => ({ value, weight: quantity(value), label: definitionLabel(value, index) })),
    ...pack.relics.map((value, index) => ({ value, weight: 1.5, label: definitionLabel(value, index) })),
    ...pack.abilities.map((value, index) => ({ value, weight: 1.25, label: definitionLabel(value, index) })),
    ...pack.activeStatuses.map((value, index) => ({ value, weight: 0.75, label: definitionLabel(value, index) })),
  ];
  let weightedContent = 0;
  for (const definition of definitions) {
    weightedContent += definition.weight;
    for (const affinity of scoreContentArchetypes(definition.value, pack).slice(0, 6)) {
      const entry = scores.get(affinity.id) || { total: 0, cards: new Set<string>(), missing: new Set<string>() };
      entry.total += affinity.score * definition.weight;
      entry.cards.add(definition.label);
      affinity.missingPayoffs.forEach(value => entry.missing.add(value));
      scores.set(affinity.id, entry);
    }
  }
  const nodes = new Map(ARCHETYPE_GRAPH.map(node => [node.id, node]));
  const affinities = [...scores.entries()]
    .map(([id, entry]) => {
      const node = nodes.get(id)!;
      return {
        id,
        label: node.label,
        description: node.description,
        score: Math.round(entry.total / Math.max(1, weightedContent)),
        share: entry.total,
        supportingCards: [...entry.cards].slice(0, 8),
        missingPayoffs: [...entry.missing].slice(0, 5),
      } satisfies ArchetypeAffinity;
    })
    .filter(value => value.score >= 8)
    .sort((left, right) => right.share - left.share || left.id.localeCompare(right.id));
  const represented = affinities.reduce((sum, value) => sum + value.share, 0);
  const capacity = Math.max(1, weightedContent * 100 * 2.2);
  const scatterShare = Math.round(Math.max(0, Math.min(1, 1 - represented / capacity)) * 1000) / 10;
  const shareBase = Math.max(1, affinities.reduce((sum, value) => sum + value.share, 0));
  affinities.forEach(value => { value.share = Math.round(value.share / shareBase * (100 - scatterShare) * 10) / 10; });
  const primary = affinities.slice(0, 5).map(value => value.id);
  const bridges = primary.flatMap((from, index) => primary.slice(index + 1).flatMap(to => {
    const edge = nodes.get(from)?.neighbors.find(neighbor => neighbor.target === to)
      || nodes.get(to)?.neighbors.find(neighbor => neighbor.target === from);
    return edge ? [{ from, to, transitionCost: edge.transitionCost, bridgeFeatures: edge.bridgeFeatures }] : [];
  }));
  const cards = pack.cards.map((card, index) => ({
    id: String(card.id || `card_${index + 1}`),
    name: definitionLabel(card, index),
    quantity: quantity(card),
    affinities: scoreContentArchetypes(card, pack).slice(0, 6).map(({ id, label, score }) => ({ id, label, score })),
  }));
  const present = new Set(primary);
  const evolutionSuggestions = primary
    .flatMap(from => (nodes.get(from)?.neighbors || []).map(neighbor => ({ from, neighbor })))
    .filter(({ neighbor }) => !present.has(neighbor.target))
    .sort((left, right) => left.neighbor.transitionCost - right.neighbor.transitionCost || left.neighbor.target.localeCompare(right.neighbor.target))
    .filter((entry, index, values) => values.findIndex(value => value.neighbor.target === entry.neighbor.target) === index)
    .slice(0, 6)
    .flatMap(({ from, neighbor }) => {
      const target = nodes.get(neighbor.target);
      return target ? [{
        from,
        to: target.id,
        label: target.label,
        description: target.description,
        transitionCost: neighbor.transitionCost,
        bridgeFeatures: neighbor.bridgeFeatures,
      }] : [];
    });
  return {
    spec: ARCHETYPE_GRAPH_SPEC,
    fingerprint: createContentMechanicsFingerprint({ cards: pack.cards, statuses: pack.statuses }),
    affinities,
    scatterShare,
    primary,
    bridges,
    cards,
    evolutionSuggestions,
  };
}

export function validateArchetypeGraph(graph: readonly ArchetypeNode[] = ARCHETYPE_GRAPH): ArchetypeGraphIssue[] {
  const issues: ArchetypeGraphIssue[] = [];
  const ids = new Set<string>();
  for (const node of graph) {
    if (ids.has(node.id)) issues.push({ code: 'DUPLICATE_ID', nodeId: node.id, detail: '流派 ID 重复。' });
    ids.add(node.id);
    if (node.requiredFeatures.length === 0) {
      issues.push({ code: 'EMPTY_REQUIREMENT', nodeId: node.id, detail: '流派缺少可判定的必要机制。' });
    }
  }
  for (const node of graph) {
    const targets = new Set<string>();
    for (const neighbor of node.neighbors) {
      if (neighbor.target === node.id) issues.push({ code: 'SELF_EDGE', nodeId: node.id, detail: '流派不能指向自身。' });
      if (!ids.has(neighbor.target)) issues.push({ code: 'DANGLING_EDGE', nodeId: node.id, detail: `未知目标 ${neighbor.target}。` });
      if (targets.has(neighbor.target)) issues.push({ code: 'DUPLICATE_EDGE', nodeId: node.id, detail: `重复目标 ${neighbor.target}。` });
      targets.add(neighbor.target);
    }
  }
  return issues;
}
