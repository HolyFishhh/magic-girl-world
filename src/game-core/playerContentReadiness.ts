import { analyzeContentDefinition } from './contentAnalysis';
import { contentPathToBattlePath, validateContentPackContract, type ContentContractIssue } from './contentContract';
import type { ContentPack } from './contentPack';
import { assessDeckPlayability, type DeckPlayabilityAssessment } from './deckPlayability';
import { formatBoundedContentRepairPrompt } from './contentRepair';

export interface PlayerContentReadinessIssue {
  path: string;
  code: string;
  message: string;
}

export interface PlayerContentReadiness {
  ok: boolean;
  issues: PlayerContentReadinessIssue[];
  deck: DeckPlayabilityAssessment;
}

export interface InitialPlayerStateInput {
  hp: unknown;
  maxHp: unknown;
  lust: unknown;
  maxLust: unknown;
  level: unknown;
  exp: unknown;
}

const INITIAL_DECK_QUANTITY = 10;

const ISSUE_LABELS: Readonly<Record<string, string>> = {
  INVALID_ID: 'ID 格式错误',
  DUPLICATE_ID: 'ID 重复',
  INVALID_NAME: '名称不能为空',
  INVALID_CARD_TYPE: '卡牌类型不受支持',
  INVALID_CARD_RARITY: '卡牌稀有度不受支持',
  INVALID_CARD_COST: '费用必须是非负整数或 energy',
  INVALID_CURSE_COST: '诅咒牌不能填写费用',
  INVALID_QUANTITY: '数量必须是 1 到 100 的整数',
  INVALID_BOOLEAN: '关键词开关必须是布尔值',
  INVALID_DISCARD_REQUIREMENT: '弃牌需求必须是 0 到 100 的整数',
  INVALID_EFFECT_SOURCE: 'effects 必须是浅层对象或数组',
  MISSING_EFFECT_SOURCE: '缺少 effects',
  MULTIPLE_EFFECT_SOURCES: '只能使用一种效果格式',
  MULTIPLE_DISCARD_EFFECT_SOURCES: '弃牌效果只能使用一种格式',
  MISSING_TRIGGER: '现代遗物或能力缺少 trigger',
  INVALID_TRIGGER: 'trigger 不受支持',
  UNKNOWN_STATUS: '引用了未注册状态',
  INVALID_STATUS: '状态定义不合法',
  INVALID_ENTRY: '内容项必须是对象',
  INVALID_LIST: '内容集合必须是数组',
  INVALID_MAX_HP: '最大生命必须是大于 0 的有限数',
  INVALID_HP: '当前生命必须在 0 到最大生命之间',
  INVALID_MAX_LUST: '最大欲望必须是大于 0 的有限数',
  INVALID_LUST: '当前欲望必须在 0 到最大欲望之间',
  INVALID_LEVEL: '等级必须是正整数',
  INVALID_EXP: '经验必须是非负有限整数',
  MISSING_RELIC: '至少需要 1 个可执行初始遗物',
  MISSING_ITEM: '至少需要 1 个可执行初始道具',
  MISSING_DESIRE_EFFECT: '缺少玩家欲望满溢效果',
  DECK_TOO_SMALL: `初始牌组总 quantity 必须至少为 ${INITIAL_DECK_QUANTITY}`,
  NO_PLAYABLE_CARD: '没有能在基础 3 能量下打出的非诅咒牌',
  NO_VICTORY_PRESSURE: '缺少稳定的生命/欲望伤害或 Event 胜利手段',
  NO_DEFENSE_OR_RECOVERY: '缺少稳定的格挡或治疗手段',
};

function issueLabel(issue: Pick<PlayerContentReadinessIssue, 'code'>): string {
  return ISSUE_LABELS[issue.code] || '规则字段不符合浅层 effects 契约';
}

function portableIssue(issue: ContentContractIssue): PlayerContentReadinessIssue {
  return {
    path: contentPathToBattlePath(issue.path),
    code: issue.code,
    message: issueLabel(issue),
  };
}

/** Validate player-owned content from the first AI response before opening the run. */
export function assessInitialPlayerContent(
  pack: ContentPack,
  player?: InitialPlayerStateInput,
): PlayerContentReadiness {
  const playerPack: ContentPack = {
    ...pack,
    enemy: null,
    desireEffects: { player: pack.desireEffects.player, enemy: null },
  };
  const contract = validateContentPackContract(playerPack, { requireExecutable: true });
  const issues = contract.ok ? [] : contract.issues.map(portableIssue);
  const deck = assessDeckPlayability(
    pack.cards.map(card => ({
      type: card && typeof card === 'object' ? card.type : undefined,
      cost: card && typeof card === 'object' ? card.cost : undefined,
      quantity: card && typeof card === 'object' ? card.quantity : undefined,
      analysis: card && typeof card === 'object' ? analyzeContentDefinition(card) : null,
    })),
  );

  const addDeckIssue = (code: string): void => {
    issues.push({ path: 'battle.cards', code, message: issueLabel({ code }) });
  };
  const addIssue = (path: string, code: string): void => {
    issues.push({ path, code, message: issueLabel({ code }) });
  };
  if (pack.relics.length === 0) addIssue('battle.artifacts', 'MISSING_RELIC');
  if (pack.items.length === 0) addIssue('battle.items', 'MISSING_ITEM');
  if (pack.desireEffects.player === null) addIssue('battle.player_lust_effect', 'MISSING_DESIRE_EFFECT');
  if (player) {
    const maxHp = Number(player.maxHp);
    const hp = Number(player.hp);
    const maxLust = Number(player.maxLust);
    const lust = Number(player.lust);
    if (!Number.isFinite(maxHp) || maxHp <= 0) addIssue('battle.core.max_hp', 'INVALID_MAX_HP');
    if (!Number.isFinite(hp) || hp < 0 || hp > maxHp) addIssue('battle.core.hp', 'INVALID_HP');
    if (!Number.isFinite(maxLust) || maxLust <= 0) addIssue('battle.core.max_lust', 'INVALID_MAX_LUST');
    if (!Number.isFinite(lust) || lust < 0 || lust > maxLust) addIssue('battle.core.lust', 'INVALID_LUST');
    if (!Number.isInteger(player.level) || Number(player.level) < 1) addIssue('battle.level', 'INVALID_LEVEL');
    if (!Number.isInteger(player.exp) || Number(player.exp) < 0) addIssue('battle.exp', 'INVALID_EXP');
  }
  if (deck.deckQuantity < INITIAL_DECK_QUANTITY) addDeckIssue('DECK_TOO_SMALL');
  if (!deck.hasPlayableCard) addDeckIssue('NO_PLAYABLE_CARD');
  if (!deck.hasVictoryPressure) addDeckIssue('NO_VICTORY_PRESSURE');
  if (!deck.hasDefenseOrRecovery) addDeckIssue('NO_DEFENSE_OR_RECOVERY');

  return { ok: issues.length === 0, issues, deck };
}

export function formatPlayerContentReadiness(readiness: PlayerContentReadiness, limit = 3): string {
  if (readiness.ok) return '初始战斗内容已就绪';
  const shown = readiness.issues.slice(0, limit).map(issue => `${issue.path}：${issue.message}`);
  if (readiness.issues.length > limit) shown.push(`另有 ${readiness.issues.length - limit} 处`);
  return shown.join('；');
}

/** Build a bounded repair request without echoing untrusted AI field values. */
export function formatPlayerContentRepairPrompt(readiness: PlayerContentReadiness, limit = 4): string {
  if (readiness.ok) return '';
  return formatBoundedContentRepairPrompt('[战斗内容修复]', readiness.issues, limit);
}
