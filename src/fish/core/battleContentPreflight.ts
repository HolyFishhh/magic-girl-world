import {
  analyzeContentDefinition,
  assessDeckPlayability,
  compileCompactEffectList,
  contentPathToBattlePath,
  diagnoseDescriptionEffects,
  extractContentMechanicFeatures,
  formatBoundedContentRepairPrompt,
  hasContentMetric,
  isCompactEffectList,
  normalizeCompactNamedEffectInput,
  resolveTriggerInput,
  validateContentPackContract,
  validateCombatResourceDefinitions,
  validateCardCost,
  type ContentAnalysis,
  type EffectProgram,
} from '../../game-core';
import { createContentPackFromMvuBattle } from '../../runtime/contentPackAdapter';
import { convertMvuOrbContainer, convertMvuStance, normalizeMvuArray } from './mvuBattleAdapter';

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

function validateSpecialContainers(
  source: Record<string, any>,
  path: string,
  issues: BattleContentIssue[],
  options: { enemyCollectionTarget?: 'self' | 'opponent' } = {},
): void {
  if (
    source.stance !== undefined &&
    source.stance !== null &&
    !convertMvuStance(source.stance, 1, options)
  ) {
    issues.push({ path: `${path}.stance`, code: 'INVALID_STANCE', message: '姿态需要稳定英文 ID、名称和合法的进入/退出/持续效果' });
  }
  if (
    source.orb_slots !== undefined &&
    (!Number.isInteger(source.orb_slots) || source.orb_slots < 0 || source.orb_slots > 20)
  ) {
    issues.push({ path: `${path}.orb_slots`, code: 'INVALID_ORB_SLOTS', message: 'Orb 槽位必须是 0 到 20 的整数' });
  }
  if (source.orbs !== undefined && !Array.isArray(source.orbs)) {
    issues.push({ path: `${path}.orbs`, code: 'INVALID_ORBS', message: 'Orb 必须是数组' });
    return;
  }
  const authoredOrbs = normalizeMvuArray(source.orbs);
  authoredOrbs.forEach((orb, index) => {
    if (convertMvuOrbContainer(1, [orb], options).orbs.length !== 1) {
      issues.push({
        path: `${path}.orbs[${index}]`,
        code: 'INVALID_ORB',
        message: 'Orb 需要稳定英文 ID、名称、非负数值和合法的被动/激发效果',
      });
    }
  });
  if (Number.isInteger(source.orb_slots) && authoredOrbs.length > source.orb_slots) {
    issues.push({ path: `${path}.orbs`, code: 'ORB_SLOT_OVERFLOW', message: '初始 Orb 数量不能超过槽位数' });
  }
  validateCombatResourceDefinitions(source.resources, `${path}.resources`).forEach(issue => issues.push(issue));
}

function validatePlayerCardResourceCosts(battle: Record<string, any>, issues: BattleContentIssue[]): void {
  const core = isRecord(battle.core) ? battle.core : {};
  const known = new Set(normalizeMvuArray(core.resources).map(resource => String(resource.id || '')).filter(Boolean));
  normalizeMvuArray(battle.cards).forEach((card, index) => {
    const path = `battle.cards[${index}].cost`;
    const costIssue = validateCardCost(card.cost ?? (card.type === 'Curse' ? undefined : 0));
    if (costIssue) {
      issues.push({ path, code: 'INVALID_CARD_COST', message: costIssue });
      return;
    }
    if (!card.cost || typeof card.cost !== 'object' || Array.isArray(card.cost)) return;
    for (const id of Object.keys(card.cost)) {
      if (id !== 'energy' && !known.has(id)) {
        issues.push({ path: `${path}.${id}`, code: 'UNKNOWN_CARD_RESOURCE', message: `卡牌费用引用了未注册资源: ${id}` });
      }
    }
  });
}

interface ResourceOwner {
  id: string;
  path: string;
  resources: ReadonlySet<string>;
}

interface ResourceProgramScope {
  self: ResourceOwner[];
  opponents: ResourceOwner[];
  enemyCollectionTarget?: 'self' | 'opponent';
  enemyCollection?: ResourceOwner[];
}

function readResourceOwner(source: Record<string, any>, path: string, fallbackId: string): ResourceOwner {
  return {
    id: String(source.id || source.name || fallbackId),
    path,
    resources: new Set(
      normalizeMvuArray(source.resources)
        .map(resource => String(resource.id || ''))
        .filter(Boolean),
    ),
  };
}

function selectResourceOpponents(
  owners: readonly ResourceOwner[],
  selector: unknown,
): ResourceOwner[] {
  if (!isRecord(selector) || selector.mode !== 'by_id' || typeof selector.id !== 'string') return [...owners];
  return owners.filter(owner => owner.id === selector.id);
}

function validateResourceOnOwners(
  resource: string,
  owners: readonly ResourceOwner[],
  path: string,
  issues: BattleContentIssue[],
): void {
  if (!resource || resource === 'energy') return;
  if (owners.length === 0) {
    issues.push({ path, code: 'UNKNOWN_RESOURCE_TARGET', message: `资源 ${resource} 没有可解析的作用目标` });
    return;
  }
  const missing = owners.filter(owner => !owner.resources.has(resource));
  if (missing.length === 0) return;
  issues.push({
    path,
    code: 'UNKNOWN_TARGET_RESOURCE',
    message: `资源 ${resource} 未在目标 ${missing.map(owner => owner.id).join('、')} 注册`,
  });
}

function validateProgramResourceUsage(
  program: EffectProgram,
  path: string,
  scope: ResourceProgramScope,
  issues: BattleContentIssue[],
): void {
  const visit = (value: unknown, valuePath: string, opponents: readonly ResourceOwner[]): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${valuePath}[${index}]`, opponents));
      return;
    }
    if (!isRecord(value)) return;

    const collectionOwners = scope.enemyCollection || scope.opponents;
    const selectedOpponents = 'targetSelector' in value
      ? selectResourceOpponents(collectionOwners, value.targetSelector)
      : [...opponents];
    if ((value.op === 'gain_resource' || value.op === 'set_resource') && typeof value.resource === 'string') {
      const targets = value.target === scope.enemyCollectionTarget && 'targetSelector' in value
        ? selectedOpponents
        : value.target === 'opponent'
          ? scope.opponents
          : scope.self;
      validateResourceOnOwners(value.resource, targets, `${valuePath}.resource`, issues);
    }
    if (value.op === 'var' && typeof value.path === 'string') {
      const matched = value.path.match(/^(self|opponent)\.resource\.([A-Za-z_][A-Za-z0-9_]*)\.(current|max)$/);
      if (matched) {
        validateResourceOnOwners(
          matched[2],
          matched[1] === 'self' ? scope.self : selectedOpponents,
          `${valuePath}.path`,
          issues,
        );
      }
    }
    Object.entries(value).forEach(([key, entry]) => {
      if (key !== 'targetSelector') visit(entry, `${valuePath}.${key}`, selectedOpponents);
    });
  };
  visit(program, path, scope.opponents);
}

function compileDefinitionPrograms(
  value: unknown,
  options: { enemyCollectionTarget?: 'self' | 'opponent' } = {},
): EffectProgram[] {
  if (!isRecord(value)) return [];
  const resolved = resolveTriggerInput(value);
  const trigger = typeof resolved.trigger === 'string' && !['battle_start', 'passive'].includes(resolved.trigger)
    ? resolved.trigger
    : undefined;
  const sources: Array<{ effects: unknown; trigger?: string }> = resolved.structured
    ? [
        { effects: resolved.immediateEffects },
        { effects: resolved.triggeredEffects, trigger },
      ]
    : [{ effects: resolved.triggeredEffects, trigger }];
  if (value.discard_effects !== undefined) sources.push({ effects: value.discard_effects });
  return sources.flatMap(source => {
    if (!isCompactEffectList(source.effects)) return [];
    const compiled = compileCompactEffectList(source.effects, {
      trigger: source.trigger,
      when: source.trigger ? undefined : value.when,
      creates: value.creates,
      enemyCollectionTarget: options.enemyCollectionTarget,
    });
    return compiled.ok ? [compiled.value] : [];
  });
}

function validateDefinitionResourceUsage(
  value: unknown,
  path: string,
  scope: ResourceProgramScope,
  issues: BattleContentIssue[],
): void {
  compileDefinitionPrograms(value, { enemyCollectionTarget: scope.enemyCollectionTarget }).forEach((program, index) =>
    validateProgramResourceUsage(program, `${path}.programs[${index}]`, scope, issues));
}

function collectAppliedStatusOwners(
  value: unknown,
  scope: ResourceProgramScope,
  ownersByStatus: Map<string, Map<string, ResourceOwner>>,
): number {
  let added = 0;
  const add = (status: string, owners: readonly ResourceOwner[]): void => {
    if (!status) return;
    const current = ownersByStatus.get(status) || new Map<string, ResourceOwner>();
    for (const owner of owners) {
      if (current.has(owner.id)) continue;
      current.set(owner.id, owner);
      added += 1;
    }
    ownersByStatus.set(status, current);
  };
  const visit = (entry: unknown, opponents: readonly ResourceOwner[]): void => {
    if (Array.isArray(entry)) {
      entry.forEach(item => visit(item, opponents));
      return;
    }
    if (!isRecord(entry)) return;
    const collectionOwners = scope.enemyCollection || scope.opponents;
    const selectedOpponents = 'targetSelector' in entry
      ? selectResourceOpponents(collectionOwners, entry.targetSelector)
      : [...opponents];
    if (entry.op === 'apply_status' && typeof entry.status === 'string') {
      add(
        entry.status,
        entry.target === scope.enemyCollectionTarget && 'targetSelector' in entry
          ? selectedOpponents
          : entry.target === 'opponent'
            ? scope.opponents
            : scope.self,
      );
    }
    Object.entries(entry).forEach(([key, child]) => {
      if (key !== 'targetSelector') visit(child, selectedOpponents);
    });
  };
  compileDefinitionPrograms(value, { enemyCollectionTarget: scope.enemyCollectionTarget })
    .forEach(program => visit(program, scope.enemyCollection || scope.opponents));
  return added;
}

function activeStatusIds(value: unknown): string[] {
  return normalizeMvuArray(value)
    .map(entry => typeof entry === 'string' ? entry : isRecord(entry) ? String(entry.id || '') : '')
    .filter(Boolean);
}

function validateContainerResourceUsage(
  source: Record<string, any>,
  path: string,
  scope: ResourceProgramScope,
  issues: BattleContentIssue[],
): void {
  const containerOptions = { enemyCollectionTarget: scope.enemyCollectionTarget };
  const stance = convertMvuStance(source.stance, 1, containerOptions);
  if (stance) {
    for (const [field, effects] of [
      ['enter', stance.enterEffects],
      ['exit', stance.exitEffects],
      ['passive', stance.passiveEffects],
    ] as const) {
      if (effects?.length) validateProgramResourceUsage(
        { spec: 'mwg.effect/v1', steps: effects },
        `${path}.stance.${field}`,
        scope,
        issues,
      );
    }
  }
  const orbs = convertMvuOrbContainer(source.orb_slots, source.orbs, containerOptions);
  orbs.orbs.forEach((orb, index) => {
    for (const [field, effects] of [
      ['passive', orb.passiveEffects],
      ['evoke', orb.evokeEffects],
    ] as const) {
      if (effects?.length) validateProgramResourceUsage(
        { spec: 'mwg.effect/v1', steps: effects },
        `${path}.orbs[${index}].${field}`,
        scope,
        issues,
      );
    }
  });
}

function validateBattleResourceUsage(battle: Record<string, any>, issues: BattleContentIssue[]): void {
  const core = isRecord(battle.core) ? battle.core : {};
  const player = readResourceOwner(core, 'battle.core', 'player');
  const enemyValues = Array.isArray(battle.enemies) && battle.enemies.length > 0 ? battle.enemies : [battle.enemy];
  const enemies = enemyValues.flatMap((enemy, index) => {
    if (!isRecord(enemy)) return [];
    const path = Array.isArray(battle.enemies) ? `battle.enemies[${index}]` : 'battle.enemy';
    return [readResourceOwner(enemy, path, `enemy_${index}`)];
  });
  const playerScope: ResourceProgramScope = {
    self: [player],
    opponents: enemies,
    enemyCollectionTarget: 'opponent',
    enemyCollection: enemies,
  };
  const statusOwners = new Map<string, Map<string, ResourceOwner>>();
  const registerStatusOwner = (status: string, owner: ResourceOwner): void => {
    const current = statusOwners.get(status) || new Map<string, ResourceOwner>();
    current.set(owner.id, owner);
    statusOwners.set(status, current);
  };
  activeStatusIds(battle.player_status_effects).forEach(status => registerStatusOwner(status, player));
  const playerGroups: Array<[unknown, string]> = [
    [battle.cards, 'battle.cards'],
    [battle.artifacts, 'battle.artifacts'],
    [battle.items, 'battle.items'],
    [battle.player_abilities, 'battle.player_abilities'],
  ];
  for (const [values, path] of playerGroups) {
    normalizeMvuArray(values).forEach((value, index) => {
      validateDefinitionResourceUsage(value, `${path}[${index}]`, playerScope, issues);
      collectAppliedStatusOwners(value, playerScope, statusOwners);
    });
  }
  const playerDesire = normalizeCompactNamedEffectInput(battle.player_lust_effect, '欲望满溢');
  validateDefinitionResourceUsage(playerDesire, 'battle.player_lust_effect', playerScope, issues);
  collectAppliedStatusOwners(playerDesire, playerScope, statusOwners);
  validateContainerResourceUsage(core, 'battle.core', playerScope, issues);

  enemyValues.forEach((enemy, index) => {
    if (!isRecord(enemy)) return;
    const path = Array.isArray(battle.enemies) ? `battle.enemies[${index}]` : 'battle.enemy';
    const owner = enemies.find(candidate => candidate.path === path);
    if (!owner) return;
    const scope: ResourceProgramScope = {
      self: [owner],
      opponents: [player],
      enemyCollectionTarget: 'self',
      enemyCollection: enemies,
    };
    activeStatusIds(enemy.status_effects).forEach(status => registerStatusOwner(status, owner));
    for (const [values, groupPath] of [
      [enemy.actions, `${path}.actions`],
      [enemy.abilities, `${path}.abilities`],
    ] as const) {
      normalizeMvuArray(values).forEach((value, valueIndex) => {
        validateDefinitionResourceUsage(value, `${groupPath}[${valueIndex}]`, scope, issues);
        collectAppliedStatusOwners(value, scope, statusOwners);
      });
    }
    const enemyDesire = normalizeCompactNamedEffectInput(enemy.lust_effect, '欲望爆发');
    validateDefinitionResourceUsage(
      enemyDesire,
      `${path}.lust_effect`,
      scope,
      issues,
    );
    collectAppliedStatusOwners(enemyDesire, scope, statusOwners);
    validateContainerResourceUsage(enemy, path, scope, issues);
  });

  const allOwners = [player, ...enemies];
  const statuses = normalizeMvuArray(battle.statuses);
  // Propagate ownership through statuses that apply another status. Unknown or
  // currently unused definitions remain authorable without forcing every
  // combatant to register their private resources.
  for (let pass = 0; pass < statuses.length; pass += 1) {
    let added = 0;
    statuses.forEach(status => {
      if (!isRecord(status) || !isRecord(status.triggers)) return;
      const owners = [...(statusOwners.get(String(status.id || ''))?.values() || [])];
      if (owners.length === 0) return;
      const opponents = allOwners.filter(owner => !owners.some(current => current.id === owner.id));
      const scope: ResourceProgramScope = { self: owners, opponents };
      Object.values(status.triggers).forEach(effects => {
        if (isCompactEffectList(effects)) added += collectAppliedStatusOwners({ effects }, scope, statusOwners);
      });
    });
    if (added === 0) break;
  }
  statuses.forEach((status, statusIndex) => {
    if (!isRecord(status.triggers)) return;
    const owners = [...(statusOwners.get(String(status.id || ''))?.values() || [])];
    if (owners.length === 0) return;
    const opponents = allOwners.filter(owner => !owners.some(current => current.id === owner.id));
    Object.entries(status.triggers).forEach(([trigger, effects]) => {
      if (!isCompactEffectList(effects)) return;
      const compiled = compileCompactEffectList(effects, { implicitTarget: 'self' });
      if (compiled.ok) validateProgramResourceUsage(
        compiled.value,
        `battle.statuses[${statusIndex}].triggers.${trigger}`,
        { self: owners, opponents },
        issues,
      );
    });
  });
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
  const enemies = Array.isArray(battle.enemies) && battle.enemies.length > 0 ? battle.enemies : [battle.enemy];
  enemies.forEach((enemy, enemyIndex) => {
    if (!isRecord(enemy)) return;
    const enemyPath = Array.isArray(battle.enemies) ? `battle.enemies[${enemyIndex}]` : 'battle.enemy';
    normalizeMvuArray(enemy.actions).forEach((value, index) =>
      addDescriptionWarnings(warnings, value, `${enemyPath}.actions[${index}]`),
    );
    normalizeMvuArray(enemy.abilities).forEach((value, index) =>
      addDescriptionWarnings(warnings, value, `${enemyPath}.abilities[${index}]`),
    );
    if (enemy.lust_effect) addDescriptionWarnings(warnings, enemy.lust_effect, `${enemyPath}.lust_effect`);
  });
  if (battle.player_lust_effect)
    addDescriptionWarnings(warnings, battle.player_lust_effect, 'battle.player_lust_effect');
}

function validateEnemyActionConfig(enemy: Record<string, any>, issues: BattleContentIssue[], path = 'battle.enemy'): void {
  const mode = String(enemy.action_mode || 'random');
  if (!ENEMY_ACTION_MODES.has(mode)) {
    issues.push({
      path: `${path}.action_mode`,
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
    issues.push({ path: `${path}.action_config`, code: 'INVALID_ACTION_CONFIG', message: '行动配置必须是对象' });
    return;
  }
  const config = isRecord(root[mode]) ? root[mode] : root;
  if (mode === 'sequence' || mode === 'sequence_then_probability') {
    if (!Array.isArray(config.sequence) || config.sequence.length === 0) {
      issues.push({
        path: `${path}.action_config.sequence`,
        code: 'INVALID_SEQUENCE',
        message: '序列模式必须提供非空 sequence',
      });
    } else {
      config.sequence.forEach((name: unknown, index: number) => {
        if (typeof name !== 'string' || !names.has(name)) {
          issues.push({
            path: `${path}.action_config.sequence[${index}]`,
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
        path: `${path}.action_config.probability`,
        code: 'INVALID_PROBABILITY',
        message: '概率模式必须提供 probability 对象',
      });
    } else {
      for (const [name, weight] of Object.entries(probability)) {
        if (!names.has(name) || typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
          issues.push({
            path: `${path}.action_config.probability.${name}`,
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
    cost: card.cost,
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

  const enemies = Array.isArray(battle.enemies) && battle.enemies.length > 0 ? battle.enemies : [battle.enemy];
  enemies.forEach((enemy, index) => {
    if (!isRecord(enemy)) return;
    const path = Array.isArray(battle.enemies) ? `battle.enemies[${index}]` : 'battle.enemy';
    const enemyHasPressure = normalizeMvuArray(enemy.actions).some(action => {
      const analysis: ContentAnalysis = analyzeContentDefinition(action, { enemyCollectionTarget: 'self' });
      return hasContentMetric(analysis, 'attack');
    });
    if (!enemyHasPressure)
      warnings.push({
        path: `${path}.actions`,
        code: 'NO_ENEMY_PRESSURE',
        message: '敌人没有直接生命/欲望压力，可能形成无风险无限战斗',
      });
    if (isRecord(enemy.lust_effect)) {
      const desire = analyzeContentDefinition(enemy.lust_effect, { enemyCollectionTarget: 'self' });
      const operations = new Set(extractContentMechanicFeatures(enemy.lust_effect).operations);
      const decisiveOperation = ['kill', 'execute', 'spawn_summon', 'spawn_enemy', 'extra_turn']
        .some(operation => operations.has(operation));
      const targetMaxHp = Math.max(1, Number(battle.core?.max_hp) || 100);
      const obviouslyWeak = desire.dynamicMetrics.size === 0 && desire.statusIds.length === 0 && !decisiveOperation &&
        desire.damage < Math.max(14, targetMaxHp * 0.18) &&
        desire.metrics.defense + desire.metrics.sustain < Math.max(16, targetMaxHp * 0.2) &&
        !(desire.metrics.energy >= 2 && desire.metrics.draw >= 2);
      if (obviouslyWeak) warnings.push({
        path: `${path}.lust_effect`,
        code: 'LUST_EFFECT_UNDERPOWERED',
        message: '欲望满溢触发困难，但当前收益只相当于普通小效果；应提升为足以逆转或结束战局的终极效果',
      });
    }
  });
}

interface SpawnedEnemyReference {
  path: string;
  enemy: Record<string, any>;
}

function collectSpawnedEnemyReferences(value: unknown, path = 'battle'): SpawnedEnemyReference[] {
  const result: SpawnedEnemyReference[] = [];
  const seen = new Set<object>();
  const visit = (entry: unknown, entryPath: string): void => {
    if (Array.isArray(entry)) {
      if (seen.has(entry)) return;
      seen.add(entry);
      entry.forEach((item, index) => visit(item, `${entryPath}[${index}]`));
      return;
    }
    if (!isRecord(entry) || seen.has(entry)) return;
    seen.add(entry);
    Object.entries(entry).forEach(([key, child]) => {
      const childPath = `${entryPath}.${key}`;
      if (key === 'spawn_enemy' && isRecord(child)) result.push({ path: childPath, enemy: child });
      visit(child, childPath);
    });
  };
  visit(value, path);
  return result;
}

function validateSpawnedEnemyDefinitions(
  battle: Record<string, any>,
  issues: BattleContentIssue[],
): void {
  const seenIssues = new Set(issues.map(issue => `${issue.path}\u0000${issue.code || ''}\u0000${issue.message}`));
  for (const reference of collectSpawnedEnemyReferences(battle)) {
    const enemy = Object.fromEntries(
      Object.entries(reference.enemy).filter(([key]) => key !== 'count' && key !== 'capacity'),
    );
    const nestedBattle = { ...battle, enemy, enemies: undefined };
    const nested = preflightBattleContentInternal(nestedBattle, false);
    for (const issue of nested.issues) {
      if (!issue.path.startsWith('battle.enemy')) continue;
      const mapped = {
        ...issue,
        path: `${reference.path}${issue.path.slice('battle.enemy'.length)}`,
      };
      const key = `${mapped.path}\u0000${mapped.code || ''}\u0000${mapped.message}`;
      if (seenIssues.has(key)) continue;
      seenIssues.add(key);
      issues.push(mapped);
    }
  }
}

/** Validate the strict shallow-JSON contract before a battle mutates MUV state. */
function preflightBattleContentInternal(
  battleData: unknown,
  validateSpawnedEnemies: boolean,
): BattleContentPreflightResult {
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
  validateSpecialContainers(
    isRecord(battleData.core) ? battleData.core : {},
    'battle.core',
    issues,
    { enemyCollectionTarget: 'opponent' },
  );
  validatePlayerCardResourceCosts(battleData, issues);
  validateBattleResourceUsage(battleData, issues);
  const playerEmoji = isRecord(battleData.core) ? battleData.core.emoji : undefined;
  if (typeof playerEmoji !== 'string' || !playerEmoji.trim()) {
    issues.push({ path: 'battle.core.emoji', code: 'MISSING_PLAYER_EMOJI', message: '玩家战斗形象不能为空' });
  }
  const enemies = Array.isArray(battleData.enemies) && battleData.enemies.length > 0 ? battleData.enemies : [battleData.enemy];
  enemies.forEach((enemy, index) => {
    if (!isRecord(enemy)) return;
    const path = Array.isArray(battleData.enemies) ? `battle.enemies[${index}]` : 'battle.enemy';
    validateEntityNumbers(enemy, path, issues);
    validateSpecialContainers(enemy, path, issues, { enemyCollectionTarget: 'self' });
    validateEnemyActionConfig(enemy, issues, path);
  });
  if (validateSpawnedEnemies) validateSpawnedEnemyDefinitions(battleData, issues);
  collectDescriptionWarnings(battleData, warnings);
  addPlayabilityWarnings(battleData, warnings);
  return { ok: issues.length === 0, issues, warnings };
}

export function preflightBattleContent(battleData: unknown): BattleContentPreflightResult {
  return preflightBattleContentInternal(battleData, true);
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
