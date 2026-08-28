import {
  analyzeContentDefinition,
  assessDeckPlayability,
  contentPathToBattlePath,
  diagnoseDescriptionEffects,
  formatBoundedContentRepairPrompt,
  hasContentMetric,
  validateContentPackContract,
  type ContentAnalysis,
} from '../../game-core';
import { createContentPackFromMvuBattle } from '../../runtime/contentPackAdapter';
import { normalizeMvuArray } from './mvuBattleAdapter';

export interface BattleContentIssue {
  path: string;
  code?: string;
  message: string;
}

export interface BattleContentPreflightResult {
  ok: boolean;
  issues: BattleContentIssue[];
  warnings: BattleContentIssue[];
}

const ENEMY_ACTION_MODES = new Set(['random', 'probability', 'sequence', 'sequence_then_probability']);

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasAuthoredBattlePrecision(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value * 10 - Math.round(value * 10)) < 1e-7;
}

function validateEntityNumbers(source: Record<string, any>, path: string, issues: BattleContentIssue[]): void {
  const hp = source.hp;
  const maxHp = source.max_hp;
  const lust = source.lust;
  const maxLust = source.max_lust;
  if (!hasAuthoredBattlePrecision(maxHp) || maxHp <= 0) {
    issues.push({
      path: `${path}.max_hp`,
      code: 'INVALID_MAX_HP',
      message: '最大生命必须是大于 0、最多一位小数的数值',
    });
  } else if (!hasAuthoredBattlePrecision(hp) || hp < 0 || hp > maxHp) {
    issues.push({
      path: `${path}.hp`,
      code: 'INVALID_HP',
      message: `当前生命必须是 0..${maxHp} 内、最多一位小数的数值`,
    });
  }
  if (!hasAuthoredBattlePrecision(maxLust) || maxLust <= 0) {
    issues.push({
      path: `${path}.max_lust`,
      code: 'INVALID_MAX_LUST',
      message: '最大欲望必须是大于 0、最多一位小数的数值',
    });
  } else if (!hasAuthoredBattlePrecision(lust) || lust < 0 || lust > maxLust) {
    issues.push({
      path: `${path}.lust`,
      code: 'INVALID_LUST',
      message: `当前欲望必须是 0..${maxLust} 内、最多一位小数的数值`,
    });
  }
}

function addDescriptionWarnings(warnings: BattleContentIssue[], value: unknown, path: string): void {
  diagnoseDescriptionEffects(value).forEach(diagnostic => {
    warnings.push({ path: `${path}.description`, code: 'DESCRIPTION_MISMATCH', message: diagnostic.message });
  });
}

function collectDescriptionWarnings(battle: Record<string, any>, warnings: BattleContentIssue[]): void {
  const groups: Array<[unknown, string]> = [
    [battle.cards, 'battle.cards'],
    [battle.artifacts, 'battle.artifacts'],
    [battle.items, 'battle.items'],
    [battle.player_abilities, 'battle.player_abilities'],
  ];
  for (const [values, path] of groups) {
    normalizeMvuArray(values).forEach((value, index) => addDescriptionWarnings(warnings, value, `${path}[${index}]`));
  }
  const enemy = isRecord(battle.enemy) ? battle.enemy : null;
  normalizeMvuArray(enemy?.actions).forEach((value, index) =>
    addDescriptionWarnings(warnings, value, `battle.enemy.actions[${index}]`),
  );
  normalizeMvuArray(enemy?.abilities).forEach((value, index) =>
    addDescriptionWarnings(warnings, value, `battle.enemy.abilities[${index}]`),
  );
  if (enemy?.lust_effect) {
    addDescriptionWarnings(warnings, enemy.lust_effect, 'battle.enemy.lust_effect');
  }
  if (battle.player_lust_effect)
    addDescriptionWarnings(warnings, battle.player_lust_effect, 'battle.player_lust_effect');
}

function validateEnemyActionConfig(enemy: Record<string, any>, issues: BattleContentIssue[]): void {
  const mode = String(enemy.action_mode || 'random');
  if (!ENEMY_ACTION_MODES.has(mode)) {
    issues.push({
      path: 'battle.enemy.action_mode',
      code: 'INVALID_ACTION_MODE',
      message: `不支持的行动模式: ${mode}`,
    });
    return;
  }
  const names = new Set(
    normalizeMvuArray(enemy.actions)
      .map(action => String(action.name || ''))
      .filter(Boolean),
  );
  const root = enemy.action_config || {};
  if (!isRecord(root)) {
    issues.push({ path: 'battle.enemy.action_config', code: 'INVALID_ACTION_CONFIG', message: '行动配置必须是对象' });
    return;
  }
  const config = isRecord(root[mode]) ? root[mode] : root;
  if (mode === 'sequence' || mode === 'sequence_then_probability') {
    if (!Array.isArray(config.sequence) || config.sequence.length === 0) {
      issues.push({
        path: 'battle.enemy.action_config.sequence',
        code: 'INVALID_SEQUENCE',
        message: '序列模式必须提供非空 sequence',
      });
    } else {
      config.sequence.forEach((name: unknown, index: number) => {
        if (typeof name !== 'string' || !names.has(name)) {
          issues.push({
            path: `battle.enemy.action_config.sequence[${index}]`,
            code: 'UNKNOWN_ACTION',
            message: '序列引用了不存在的行动',
          });
        }
      });
    }
  }
  if (mode === 'probability' || mode === 'sequence_then_probability') {
    const probability = isRecord(config.probability) ? config.probability : mode === 'probability' ? config : null;
    if (!probability) {
      issues.push({
        path: 'battle.enemy.action_config.probability',
        code: 'INVALID_PROBABILITY',
        message: '概率模式必须提供 probability 对象',
      });
    } else {
      for (const [name, weight] of Object.entries(probability)) {
        if (!names.has(name) || typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
          issues.push({
            path: `battle.enemy.action_config.probability.${name}`,
            code: 'INVALID_PROBABILITY',
            message: '行动概率必须引用现有行动并使用正数权重',
          });
        }
      }
    }
  }
}

function addPlayabilityWarnings(battle: Record<string, any>, warnings: BattleContentIssue[]): void {
  const cards = normalizeMvuArray(battle.cards).map(card => ({
    type: String(card.type || 'Skill'),
    cost: card.cost as number | 'energy' | undefined,
    quantity: Number(card.quantity ?? 1),
    analysis: analyzeContentDefinition(card),
  }));
  const assessment = assessDeckPlayability(cards);
  if (!assessment.hasPlayableCard)
    warnings.push({ path: 'battle.cards', code: 'NO_PLAYABLE_CARD', message: '没有能在基础 3 能量下打出的非诅咒牌' });
  if (!assessment.hasVictoryPressure)
    warnings.push({
      path: 'battle.cards',
      code: 'NO_VICTORY_PRESSURE',
      message: '未发现直接生命/欲望伤害或 Event，战斗可能无法结束',
    });

  const enemyActions = normalizeMvuArray(battle.enemy?.actions);
  const enemyHasPressure = enemyActions.some(action => {
    const analysis: ContentAnalysis = analyzeContentDefinition(action);
    return hasContentMetric(analysis, 'attack');
  });
  if (!enemyHasPressure)
    warnings.push({
      path: 'battle.enemy.actions',
      code: 'NO_ENEMY_PRESSURE',
      message: '敌人没有直接生命/欲望压力，可能形成无风险无限战斗',
    });
}

/** Validate the strict shallow-JSON contract before a battle mutates MUV state. */
export function preflightBattleContent(battleData: unknown): BattleContentPreflightResult {
  const issues: BattleContentIssue[] = [];
  const warnings: BattleContentIssue[] = [];
  if (!isRecord(battleData)) {
    return { ok: false, issues: [{ path: 'battle', code: 'INVALID_BATTLE', message: '战斗数据必须是对象' }], warnings };
  }

  const pack = createContentPackFromMvuBattle(battleData);
  const contract = validateContentPackContract(pack, { requireEnemy: true, requireExecutable: true });
  if (!contract.ok) {
    contract.issues.forEach(issue => issues.push({ ...issue, path: contentPathToBattlePath(issue.path) }));
  }
  validateEntityNumbers(isRecord(battleData.core) ? battleData.core : {}, 'battle.core', issues);
  const playerEmoji = isRecord(battleData.core) ? battleData.core.emoji : undefined;
  if (typeof playerEmoji !== 'string' || !playerEmoji.trim()) {
    issues.push({ path: 'battle.core.emoji', code: 'MISSING_PLAYER_EMOJI', message: '玩家战斗形象不能为空' });
  }
  if (isRecord(battleData.enemy)) {
    validateEntityNumbers(battleData.enemy, 'battle.enemy', issues);
    validateEnemyActionConfig(battleData.enemy, issues);
  }
  collectDescriptionWarnings(battleData, warnings);
  addPlayabilityWarnings(battleData, warnings);
  return { ok: issues.length === 0, issues, warnings };
}

export function formatBattleContentIssues(issues: BattleContentIssue[], limit = 4): string {
  const shown = issues.slice(0, limit).map(issue => `${issue.path}: ${issue.message}`);
  if (issues.length > limit) shown.push(`另有 ${issues.length - limit} 项错误`);
  return shown.join('；');
}

export function formatBattleContentRepairPrompt(issues: readonly BattleContentIssue[], limit = 8): string {
  const playerPrefixes = [
    'battle.core',
    'battle.cards',
    'battle.artifacts',
    'battle.items',
    'battle.statuses',
    'battle.player_abilities',
    'battle.player_status_effects',
    'battle.player_lust_effect',
    'battle.level',
    'battle.exp',
  ];
  const playerIssues = issues.filter(issue => playerPrefixes.some(prefix => issue.path.startsWith(prefix)));
  const sceneIssues = issues.filter(issue => !playerIssues.includes(issue));
  const prompts: string[] = [];
  if (playerIssues.length > 0) {
    prompts.push(formatBoundedContentRepairPrompt('[战斗内容修复]', playerIssues, limit));
  }
  if (sceneIssues.length > 0) {
    prompts.push(formatBoundedContentRepairPrompt('[战斗场景修复]', sceneIssues, limit));
  }
  return prompts.filter(Boolean).join('\n');
}
