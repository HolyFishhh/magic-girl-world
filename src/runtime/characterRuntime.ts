import { redactDiagnosticText } from './diagnosticRedaction';
import { renderGenerationEvidencePage } from './generationEvidenceView';
import { assessMeasuredBuild } from '../game-core/buildAssessment';
import { commitMvuUpdate } from './mvuWriteCoordinator';
type RuntimeViewName = 'start' | 'common' | 'fish' | 'update';

type RuntimeViewAsset = Readonly<{
  title: string;
  bodyHtml: string;
  styles: string;
  script: string;
}>;

type RuntimeBuildInfo = Readonly<{
  cardVersion: string;
  views: Record<RuntimeViewName, { bodyBytes: number; styleBytes: number; scriptBytes: number }>;
}>;

type HostReadinessOptions = Readonly<{
  mvuTimeoutMs?: number;
  battleDataTimeoutMs?: number;
  requireBattleData?: boolean;
}>;

declare const __MWG_VIEW_ASSETS__: Record<RuntimeViewName, RuntimeViewAsset>;
declare const __MWG_BUILD_INFO__: RuntimeBuildInfo;
declare function initializeGlobal(global: string, value: unknown): void;
declare function eventOn(eventType: string, listener: (...args: any[]) => void): unknown;
declare function eventRemoveListener(eventType: string, listener: (...args: any[]) => void): void;

type SettlementRecord = Record<string, any>;

type BattleSettlementGuardResult = Readonly<{
  active: boolean;
  restoredPaths: readonly string[];
}>;

function isSettlementRecord(value: unknown): value is SettlementRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneSettlementValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeEmbeddedBattleVariables(variables: unknown): boolean {
  if (
    !isSettlementRecord(variables) ||
    !isSettlementRecord(variables.stat_data) ||
    !isSettlementRecord(variables.stat_data.battle)
  ) return false;
  const battle = cloneSettlementValue(variables.stat_data.battle);
  const rawStatuses = Array.isArray(battle.statuses)
    ? battle.statuses
    : isSettlementRecord(battle.statuses)
      ? Object.entries(battle.statuses).map(([key, entry]) =>
          isSettlementRecord(entry) && typeof entry.id !== 'string' ? { id: key, ...entry } : entry)
      : [];
  const statuses = rawStatuses.filter(isSettlementRecord);
  const used = new Set(
    statuses
      .map(status => status.id)
      .filter((id): id is string => typeof id === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(id)),
  );
  const aliases = new Map<string, string>();
  const hash = (value: string): string => {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  };
  battle.statuses = statuses.map((status, index) => {
    const originalId = typeof status.id === 'string' ? status.id.trim() : '';
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(originalId)) return status;
    const name = typeof status.name === 'string' ? status.name.trim() : '';
    const base = `status_${hash(`${originalId || name || 'status'}:${index}`)}`;
    let replacement = base;
    let suffix = 2;
    while (used.has(replacement)) replacement = `${base}_${suffix++}`;
    used.add(replacement);
    if (originalId) aliases.set(originalId, replacement);
    if (name && !aliases.has(name)) aliases.set(name, replacement);
    return { ...status, id: replacement };
  });
  const formulaKeys = new Set([
    'damage', 'heal', 'block', 'energy', 'lust', 'stacks', 'draw', 'scry', 'seek',
    'set_hp', 'set_lust', 'set_energy', 'set_block', 'count', 'limit', 'extra',
    'add', 'subtract', 'multiply', 'divide', 'minimum', 'maximum',
  ]);
  type FormulaActor = 'self' | 'opponent';
  const opponentDefaultOperations = new Set([
    'damage', 'lust', 'execute', 'kill', 'apply_status', 'remove_status',
  ]);
  const selfDefaultOperations = new Set([
    'heal', 'block', 'energy', 'draw', 'scry', 'seek',
  ]);
  const inferFormulaActor = (
    value: Readonly<Record<string, unknown>>,
    inherited?: FormulaActor,
  ): FormulaActor | undefined => {
    if (value.to === 'self' || value.to === 'opponent') return value.to;
    const keys = Object.keys(value);
    const opponent = keys.some(key => opponentDefaultOperations.has(key));
    const self = keys.some(key => selfDefaultOperations.has(key));
    if (opponent !== self) return opponent ? 'opponent' : 'self';
    return inherited;
  };
  const rewriteFormula = (value: string, actor?: FormulaActor): string => {
    let result = value.replace(/\bself\.opponent\./g, 'opponent.');
    if (actor) result = result.replace(/\b(?:self\|opponent|opponent\|self)\./g, `${actor}.`);
    aliases.forEach((replacement, alias) => {
      for (const actor of ['self', 'opponent']) {
        result = result.split(`${actor}.status.${alias}.stacks`).join(`${actor}.status.${replacement}.stacks`);
      }
    });
    return result;
  };
  const rewrite = (value: unknown, parentKey = '', inheritedActor?: FormulaActor): unknown => {
    if (typeof value === 'string') return rewriteFormula(value, inheritedActor);
    if (Array.isArray(value)) return value.map(entry => rewrite(entry, '', inheritedActor));
    if (!isSettlementRecord(value)) return value;
    const actor = inferFormulaActor(value, inheritedActor);
    if (
      formulaKeys.has(parentKey) &&
      Object.keys(value).length === 1 &&
      Object.prototype.hasOwnProperty.call(value, 'formula') &&
      (typeof value.formula === 'string' || typeof value.formula === 'number')
    ) return typeof value.formula === 'string' ? rewriteFormula(value.formula, actor) : value.formula;
    const result: Record<string, any> = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (key === 'id' && typeof entry === 'string' && aliases.has(entry)) result[key] = aliases.get(entry);
      else if ((key === 'apply_status' || key === 'remove_status') && typeof entry === 'string') {
        result[key] = aliases.get(entry) || entry;
      } else result[key] = rewrite(entry, key, actor);
    });
    for (const operation of ['apply_status', 'remove_status'] as const) {
      const nested = result[operation];
      if (!isSettlementRecord(nested) || typeof nested.id !== 'string') continue;
      const transferable = operation === 'apply_status' ? ['stacks', 'to', 'targets'] : ['to', 'targets'];
      const allowed = new Set([
        'id', 'name', 'emoji', 'description', 'type', 'stacks_change', 'tick_timing', 'maxStacks', 'stun', 'character_emoji', 'protection', 'triggers', '$meta',
        ...transferable,
      ]);
      if (Object.keys(nested).some(key => !allowed.has(key))) continue;
      if (transferable.some(key => result[key] !== undefined && nested[key] !== undefined && result[key] !== nested[key])) continue;
      result[operation] = aliases.get(nested.id) || nested.id;
      transferable.forEach(key => {
        if (result[key] === undefined && nested[key] !== undefined) result[key] = nested[key];
      });
    }
    const nestedModify = result.modify;
    if (isSettlementRecord(nestedModify)) {
      const attribute = typeof nestedModify.attribute === 'string'
        ? nestedModify.attribute
        : typeof nestedModify.stat === 'string'
          ? nestedModify.stat
          : '';
      const operators = ['add', 'subtract', 'multiply', 'divide', 'set'].filter(
        key => nestedModify[key] !== undefined,
      );
      const allowed = new Set(['attribute', 'stat', 'add', 'subtract', 'multiply', 'divide', 'set', 'to', 'targets']);
      if (
        attribute &&
        operators.length === 1 &&
        Object.keys(nestedModify).every(key => allowed.has(key)) &&
        ['to', 'targets', ...operators].every(
          key => result[key] === undefined || nestedModify[key] === undefined || result[key] === nestedModify[key],
        )
      ) {
        result.modify = attribute;
        ['to', 'targets', ...operators].forEach(key => {
          if (result[key] === undefined && nestedModify[key] !== undefined) result[key] = nestedModify[key];
        });
      }
    }
    return result;
  };
  variables.stat_data.battle = rewrite(battle);
  return true;
}

function stableSettlementValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSettlementValue);
  if (!isSettlementRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSettlementValue(value[key])]));
}

function equalSettlementValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableSettlementValue(left)) === JSON.stringify(stableSettlementValue(right));
}

function restoreSettlementField(target: SettlementRecord, source: SettlementRecord, key: string): void {
  if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = cloneSettlementValue(source[key]);
  else delete target[key];
}

/**
 * A battle result is already committed before the settlement model runs.
 * Preserve only deterministic settlement values; all cards, artifacts,
 * statuses, inventory and other story consequences remain model-controlled.
 */
function reconcileBattleSettlementUpdate(
  currentVariables: SettlementRecord | undefined,
  previousVariables: SettlementRecord | undefined,
): BattleSettlementGuardResult {
  const previousStat = previousVariables?.stat_data;
  const currentStat = currentVariables?.stat_data;
  const request = previousStat?.reward?.request;
  if (
    !isSettlementRecord(previousStat) ||
    !isSettlementRecord(currentStat) ||
    !isSettlementRecord(request) ||
    request.marker !== '[MVU_BATTLE_SETTLEMENT]'
  ) {
    return { active: false, restoredPaths: [] };
  }

  const previousBattle = isSettlementRecord(previousStat.battle) ? previousStat.battle : {};
  const currentBattle = isSettlementRecord(currentStat.battle) ? currentStat.battle : {};
  const restoredPaths: string[] = [];
  for (const key of ['core', 'exp', 'enemy', 'items']) {
    if (!equalSettlementValue(currentBattle[key], previousBattle[key])) restoredPaths.push(`battle.${key}`);
    restoreSettlementField(currentBattle, previousBattle, key);
  }
  // Reward growth may replace an existing offensive desire payoff after victory;
  // it cannot create one for an unrelated build or erase the existing definition.
  if (request.result !== 'victory' || !isSettlementRecord(previousBattle.player_lust_effect)
    || !isSettlementRecord(currentBattle.player_lust_effect)) {
    if (!equalSettlementValue(currentBattle.player_lust_effect, previousBattle.player_lust_effect)) {
      restoredPaths.push('battle.player_lust_effect');
    }
    restoreSettlementField(currentBattle, previousBattle, 'player_lust_effect');
  }
  currentStat.battle = currentBattle;
  return { active: true, restoredPaths };
}

function splitMvuArguments(source: string): string[] {
  const values: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{' || char === '[' || char === '(') depth += 1;
    else if (char === '}' || char === ']' || char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      values.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  values.push(source.slice(start).trim());
  return values;
}

function parseMvuLiteral(source: string): unknown {
  const value = source.trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    if (value.startsWith('"')) {
      try { return JSON.parse(value); } catch { /* fall through */ }
    }
    return value.slice(1, -1).replace(/\\([\\'"nrt])/g, (_match, token: string) => ({ n: '\n', r: '\r', t: '\t' }[token] || token));
  }
  if (value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  try { return JSON.parse(value); } catch { return value; }
}

function compactMvuValue(value: unknown): string {
  if (value === null || value === undefined) return '无';
  if (value === '') return '空';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '空';
    const names = value.map(entry => (entry && typeof entry === 'object' ? (entry as any).name : entry)).filter(Boolean);
    return names.length ? names.slice(0, 5).join('、') + (names.length > 5 ? ` 等${names.length}项` : '') : `${value.length}项`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.name === 'string' && record.name) return record.name;
    return `${Object.keys(record).length}个字段`;
  }
  return '已更新';
}

function mvuPathLabel(path: string): string {
  const exact: Record<string, string> = {
    'status.time': '当前时间', 'status.location': '当前地点', 'status.profession.name': '职业',
    'status.profession.ability': '职业能力', 'battle.core.hp': '生命', 'battle.core.max_hp': '生命上限',
    'battle.core.lust': '欲望', 'battle.core.max_lust': '欲望上限', 'battle.core.emoji': '角色形象',
    'battle.cards': '卡牌', 'battle.artifacts': '遗物', 'battle.items': '战斗道具', 'battle.statuses': '状态定义',
    'battle.player_abilities': '玩家能力', 'battle.player_status_effects': '玩家战斗状态',
    'battle.player_lust_effect': '玩家欲望效果', 'battle.enemy': '当前敌人', 'battle.enemy.lust_effect': '敌人欲望效果',
    'battle.level': '等级', 'battle.exp': '经验', 'status.inventory': '剧情物品',
    'status.permanent_status': '永久状态', 'status.temporary_status': '临时状态', 'factions.relations': '势力关系',
    'npcs': '角色记录', 'reward.card': '卡牌奖励', 'reward.artifact': '遗物奖励',
    'reward.item': '道具奖励', 'reward.limits': '奖励选择', 'reward.card_choice_groups': '卡牌自选奖励', 'reward.request': '战斗结算请求',
  };
  if (exact[path]) return exact[path];
  if (path.startsWith('status.clothing.')) return `服装·${path.split('.').at(-1)}`;
  if (path.startsWith('battle.enemy.')) return `敌人·${path.split('.').at(-1)}`;
  return path;
}

function summarizeMvuUpdate(result: unknown): string[] {
  const source = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  const summaries: string[] = [];
  const commandPattern = /_\.(set|assign|remove|add)\(([\s\S]*?)\);/g;
  for (const match of source.matchAll(commandPattern)) {
    const operation = match[1];
    const args = splitMvuArguments(match[2]);
    const path = String(parseMvuLiteral(args[0] || '') || '未知字段');
    if (path === 'reward.request' && operation === 'set') continue;
    const label = mvuPathLabel(path);
    if (operation === 'assign') {
      const value = parseMvuLiteral(args.length >= 3 ? args[2] : args[1] || '');
      summaries.push(`${label}：新增 ${compactMvuValue(value)}`);
    } else if (operation === 'remove') {
      summaries.push(`${label}：移除 ${compactMvuValue(parseMvuLiteral(args[1] || ''))}`);
    } else if (operation === 'add') {
      const delta = Number(parseMvuLiteral(args[1] || '0'));
      summaries.push(`${label}：${delta >= 0 ? '增加' : '减少'} ${Math.abs(delta)}`);
    } else {
      const oldValue = args.length >= 3 ? parseMvuLiteral(args[1]) : undefined;
      const newValue = parseMvuLiteral(args.length >= 3 ? args[2] : args[1] || '');
      const before = oldValue === undefined ? '' : `${compactMvuValue(oldValue)} → `;
      summaries.push(`${label}：${before}${compactMvuValue(newValue)}`);
    }
  }
  return [...new Set(summaries)];
}

(() => {
  const stateKey = '__MAGIC_GIRL_WORLD_CHARACTER_RUNTIME__';
  const host = globalThis as typeof globalThis & Record<string, any>;
  const registryHost = (() => {
    try {
      return (host.parent || host.window?.parent || host) as typeof host;
    } catch {
      return host;
    }
  })();
  const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const previousRuntime = registryHost[stateKey];
  if (previousRuntime && typeof previousRuntime.destroy === 'function') {
    try {
      previousRuntime.destroy();
    } catch {
      // A stale iframe must not prevent the replacement runtime from starting.
    }
  }
  const eventBindings: Array<readonly [string, (...args: any[]) => void]> = [];
  let destroyed = false;
  const listen = (eventType: string | undefined, listener: (...args: any[]) => void): void => {
    if (!eventType || destroyed || typeof eventOn !== 'function') return;
    const guardedListener = (...args: any[]): void => {
      if (destroyed) return;
      listener(...args);
    };
    eventOn(eventType, guardedListener);
    eventBindings.push([eventType, guardedListener]);
  };
  const removeEventBindings = (): void => {
    if (typeof eventRemoveListener === 'function') {
      for (const [eventType, listener] of eventBindings.splice(0)) {
        try {
          eventRemoveListener(eventType, listener);
        } catch {
          // The Tavern event bus may already have disposed an iframe listener.
        }
      }
      return;
    }
    eventBindings.length = 0;
  };
  const assets = __MWG_VIEW_ASSETS__;
  const build = __MWG_BUILD_INFO__;

  Object.values(assets).forEach(asset => Object.freeze(asset));
  Object.freeze(assets);
  Object.freeze(build.views);
  Object.freeze(build);

  const state = {
    status: 'loading',
    publishedAt: 0,
    lastError: '',
    battleHandoffReady: false,
  };
  let cardRepairHandler: ((requirement: string) => Promise<void>) | null = null;
  type TowerGenerationBridgeEvent = {
    type: 'status' | 'completed' | 'failed' | 'stateChanged';
    payload: unknown;
  };
  const towerGenerationListeners = new Set<(event: TowerGenerationBridgeEvent) => void>();
  const towerGenerationSnapshot: {
    status: unknown;
    completed: unknown;
    failed: unknown;
    stateChanged: unknown;
  } = { status: null, completed: null, failed: null, stateChanged: null };
  const publishTowerGenerationEvent = (event: TowerGenerationBridgeEvent): void => {
    towerGenerationSnapshot[event.type] = event.payload;
    for (const listener of towerGenerationListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[MagicGirlWorld] 爬塔生成监听器执行失败', error);
      }
    }
  };

  type MvuMonitorSettings = {
    showMvuWindow: boolean;
    difficultyPercent: number;
    autoCalibration: boolean;
    designAssistantEnabled: boolean;
    simulationSeeds: number;
    showNotifications: boolean;
    towerBattleNarrative: boolean;
    debug: boolean;
  };

  const requiredTowerExtensionVersion = '1.0.3';
  const towerExtensionRepositoryUrl = 'https://github.com/HolyFishhh/magic-girl-world.git';
  const towerExtensionManifestUrl =
    'https://raw.githubusercontent.com/HolyFishhh/magic-girl-world/extension/manifest.json';
  type TowerExtensionVersionStatus = {
    status: 'missing' | 'outdated' | 'current' | 'newer' | 'unknown';
    installedVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    capabilitiesReady: boolean;
    checkedAt: number;
    message: string;
  };
  const compareTowerExtensionVersions = (left: string, right: string): number => {
    const normalize = (value: string) => value.split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
    const leftParts = normalize(left);
    const rightParts = normalize(right);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
      if (difference !== 0) return difference;
    }
    return 0;
  };
  let towerExtensionVersionCache: TowerExtensionVersionStatus | null = null;
  const checkPublishedTowerExtension = async (force = false): Promise<TowerExtensionVersionStatus> => {
    if (
      !force
      && towerExtensionVersionCache
      && Date.now() - towerExtensionVersionCache.checkedAt < 5 * 60_000
    ) return { ...towerExtensionVersionCache };
    const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
    const capabilities = typeof provider?.getCapabilities === 'function' ? provider.getCapabilities() : null;
    const installedVersion = typeof capabilities?.version === 'string' ? capabilities.version.trim() : '';
    const capabilitiesReady = capabilities?.towerGeneration === true
      && capabilities?.towerCoordinator === true
      && capabilities?.singleFloorStart === true;
    let latestVersion = '';
    let fetchError = '';
    try {
      const parentWindow = (host.parent || host.window?.parent || host) as any;
      const fetcher = typeof parentWindow?.fetch === 'function'
        ? parentWindow.fetch.bind(parentWindow)
        : typeof host.fetch === 'function'
          ? host.fetch.bind(host)
          : null;
      if (!fetcher) throw new Error('当前页面没有可用的版本检查接口');
      const response = await fetcher(`${towerExtensionManifestUrl}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response?.ok) throw new Error(`远端版本请求失败（${response?.status || 'network'}）`);
      const manifest = await response.json();
      latestVersion = typeof manifest?.version === 'string' ? manifest.version.trim() : '';
      if (!latestVersion) throw new Error('远端扩展清单缺少版本号');
    } catch (error) {
      fetchError = error instanceof Error ? error.message : String(error);
    }
    let status: TowerExtensionVersionStatus['status'];
    if (!installedVersion) status = 'missing';
    else if (!latestVersion) status = 'unknown';
    else if (compareTowerExtensionVersions(installedVersion, latestVersion) < 0) status = 'outdated';
    else if (compareTowerExtensionVersions(installedVersion, latestVersion) > 0) status = 'newer';
    else status = 'current';
    const result: TowerExtensionVersionStatus = {
      status,
      installedVersion,
      latestVersion,
      updateAvailable: status === 'outdated',
      capabilitiesReady,
      checkedAt: Date.now(),
      message: status === 'missing'
        ? `未安装爬塔组件，当前角色卡需要 ${requiredTowerExtensionVersion} 或更高版本。`
        : status === 'outdated'
          ? `当前组件 ${installedVersion}，最新版 ${latestVersion}，请先更新。`
          : status === 'current'
            ? `爬塔组件 ${installedVersion} 已是最新版。`
            : status === 'newer'
              ? `当前组件 ${installedVersion} 高于公开版 ${latestVersion}。`
              : `已安装组件 ${installedVersion}，但暂时无法检查远端版本：${fetchError}`,
    };
    towerExtensionVersionCache = result;
    return { ...result };
  };

  const installPublishedTowerExtension = async (): Promise<boolean> => {
    const version = await checkPublishedTowerExtension(true);
    const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
    if (
      typeof provider?.getCapabilities === 'function'
      && version.status !== 'outdated'
      && version.capabilitiesReady
      && compareTowerExtensionVersions(version.installedVersion, requiredTowerExtensionVersion) >= 0
    ) return true;
    const parentWindow = (host.parent || host.window?.parent || host) as any;
    if (typeof parentWindow?.Function !== 'function') {
      throw new Error('当前酒馆页面无法打开官方扩展安装器');
    }
    // Create the dynamic import in SillyTavern's top-window realm. This calls
    // the official installer, including its own third-party confirmation and
    // request headers, instead of duplicating a private HTTP endpoint.
    const loadOfficialInstaller = parentWindow.Function(
      'return Promise.all([import("/scripts/extensions.js"), import("/script.js")])',
    );
    const [extensionModule, scriptModule] = await loadOfficialInstaller();
    if (typeof extensionModule?.installExtension !== 'function') {
      throw new Error('当前酒馆版本没有提供官方扩展安装接口');
    }
    if (version.installedVersion) {
      if (typeof scriptModule?.getRequestHeaders !== 'function') {
        throw new Error('当前酒馆版本没有提供扩展更新请求接口');
      }
      const extensionNames = Array.isArray(extensionModule.extensionNames)
        ? extensionModule.extensionNames.map(String)
        : [];
      const installedExtensionName = extensionNames.find(
        (name: string) => /(?:^|[\\/])(?:magic-girl-world|magic-girl-design-assistant)$/i.test(name),
      ) || '';
      // SillyTavern exposes third-party extensions to the browser as
      // `third-party/<folder>`, while its update endpoint accepts only the
      // physical folder name. Passing the public id makes sanitize-filename
      // collapse it to `third-partymagic-girl-world` and produces a 404.
      const extensionName = installedExtensionName.split(/[\\/]/).filter(Boolean).pop()
        || 'magic-girl-world';
      const globalExtension = extensionModule?.extensionTypes?.[installedExtensionName] === 'global';
      if (/^magic-girl-design-assistant$/i.test(extensionName)) {
        throw new Error('旧手动安装不支持自动迁移，请手动安装当前版本组件后刷新酒馆。现有组件未改动。');
      }
      const response = await parentWindow.fetch('/api/extensions/update', {
        method: 'POST',
        headers: scriptModule.getRequestHeaders(),
        body: JSON.stringify({ extensionName, global: globalExtension }),
      });
      if (!response?.ok) {
        const detail = await response?.text?.();
        throw new Error(detail || `组件更新失败（${response?.status || 'network'}）`);
      }
      towerExtensionVersionCache = null;
      return true;
    }
    const installed = await extensionModule.installExtension(towerExtensionRepositoryUrl, false, 'extension');
    if (installed) towerExtensionVersionCache = null;
    return installed;
  };

  const installMvuMonitor = () => {
    const towerExtensionReleaseUrl = 'https://github.com/HolyFishhh/magic-girl-world/releases/latest';
    const storageKey = 'mwg:settings-center:v2';
    const defaultSettings: MvuMonitorSettings = {
      showMvuWindow: true,
      difficultyPercent: 80,
      autoCalibration: true,
      designAssistantEnabled: true,
      simulationSeeds: 8,
      showNotifications: true,
      towerBattleNarrative: true,
      debug: false,
    };
    let settings = { ...defaultSettings };
    let orbPosition: { x: number; y: number } | null = null;
    try {
      const stored = JSON.parse(String(host.localStorage?.getItem(storageKey) || '{}'));
      settings = { ...settings, ...(stored && typeof stored === 'object' ? stored : {}) };
      settings.difficultyPercent = Math.max(10, Math.min(110, Math.round(Number(settings.difficultyPercent) || 80)));
      settings.autoCalibration = settings.autoCalibration === true;
      settings.designAssistantEnabled = settings.designAssistantEnabled !== false;
      settings.simulationSeeds = [8, 12, 16, 24].includes(Number(settings.simulationSeeds))
        ? Number(settings.simulationSeeds)
        : 8;
      settings.showNotifications = settings.showNotifications !== false;
      settings.towerBattleNarrative = settings.towerBattleNarrative !== false;
      settings.debug = settings.debug === true;
      if (Number.isFinite(stored?.orbPosition?.x) && Number.isFinite(stored?.orbPosition?.y)) {
        orbPosition = { x: Number(stored.orbPosition.x), y: Number(stored.orbPosition.y) };
      }
    } catch {
      // UI preferences must never block the character runtime.
    }

    const monitorState = {
      chatId: String(registryHost.SillyTavern?.getContext?.()?.chatId || ''),
      phase: 'idle' as 'idle' | 'generating' | 'applying' | 'success' | 'error',
      generationId: '',
      output: '',
      rawOutput: '',
      pendingOutput: '',
      reasoning: '',
      requestContent: '',
      requestSource: '',
      requestCapturedAt: 0,
      timeline: [] as Array<{ label: string; detail: string; at: number }>,
      detail: '等待下一次变量更新',
      startedAt: 0,
      finishedAt: 0,
      candidateHasUpdateBlock: false,
      variableWriteObserved: false,
      open: false,
      background: false,
      settingsVisible: false,
      cardRepairFormVisible: false,
    };
    let root: HTMLElement | null = null;
    let orbViewportCleanup: (() => void) | undefined;
    let timer: number | undefined;
    let lifecycleTimer: number | undefined;
    let applyTimer: number | undefined;
    let streamRenderTimer: number | undefined;
    let extraAnalysisActive = false;
    let manualRepairActive = false;
    let manualRepairSession = 0;
    let manualRepairGenerationId: string | null = null;
    let manualRepairExportOutput: { generationId: string; rawOutput: string; capturedAt: number } | null = null;
    let cardRepairPending = false;
    let initialStartStopPending = false;
    let backgroundStopPending = false;
    let designAssistant: any = null;
    let designDashboard: any = null;
    let designSettingsSynchronized = false;
    let manualRepairFailureEvidence: { response: string; variableWriteObserved: boolean; eventActivityObserved: boolean; bareCommandObserved: boolean } | null = null;

    const clearApplyTimer = (): void => {
      if (applyTimer !== undefined) host.clearTimeout?.(applyTimer);
      applyTimer = undefined;
    };

    const queueStreamRender = (): void => {
      if (streamRenderTimer !== undefined) return;
      streamRenderTimer = host.setTimeout?.(() => {
        streamRenderTimer = undefined;
        render();
      }, 80) as number | undefined;
    };

    const stopElapsedTimer = (): void => {
      if (timer !== undefined) host.clearInterval?.(timer);
      timer = undefined;
    };

    const startElapsedTimer = (): void => {
      stopElapsedTimer();
      timer = host.setInterval?.(() => render(), 1000) as number | undefined;
    };

    const finishElapsedTimer = (): void => {
      if (monitorState.startedAt && !monitorState.finishedAt) monitorState.finishedAt = Date.now();
      stopElapsedTimer();
    };

    const getTopDocument = (): Document | null => {
      try {
        return host.parent?.document || host.window?.parent?.document || host.document || null;
      } catch {
        return host.document || null;
      }
    };

    const syncThinkingSetting = (): void => {
      const mvuSettings = host.SillyTavern?.extensionSettings?.mvu_settings;
      const extra = mvuSettings?.额外模型解析配置;
      if (!extra || typeof extra !== 'object') return;
      extra.关闭thinking = false;
      host.SillyTavern?.saveSettingsDebounced?.();
    };

    const saveSettings = (): void => {
      try {
        host.localStorage?.setItem(storageKey, JSON.stringify({ ...settings, orbPosition }));
      } catch {
        // localStorage can be unavailable in privacy-restricted WebViews.
      }
      syncThinkingSetting();
    };

    const applyRemoteSettings = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const remote = value as Record<string, unknown>;
      const next = {
        ...settings,
        difficultyPercent: Math.max(10, Math.min(110, Math.round(Number(remote.difficultyPercent) || settings.difficultyPercent))),
        autoCalibration: remote.autoCalibration !== false,
        designAssistantEnabled: remote.enabled !== false,
        simulationSeeds: [8, 12, 16, 24].includes(Number(remote.simulationSeeds))
          ? Number(remote.simulationSeeds)
          : settings.simulationSeeds,
        showNotifications: remote.showNotifications !== false,
        towerBattleNarrative: remote.towerBattleNarrative !== false,
        debug: remote.debug === true,
      };
      const changed = Object.keys(next).some(key => (next as any)[key] !== (settings as any)[key]);
      settings = next;
      if (changed) saveSettings();
    };

    const updateDesignSettings = (patch: Record<string, unknown>): void => {
      try {
        const updated = designAssistant?.updateSettings?.(patch);
        if (updated) applyRemoteSettings(updated);
        designDashboard = designAssistant?.getDashboard?.() || designDashboard;
      } catch (error) {
        console.warn('[MagicGirlWorld] 设计辅助器设置同步失败', error);
      }
    };

    const pushTimeline = (label: string, detail = ''): void => {
      const previous = monitorState.timeline.at(-1);
      if (previous?.label === label && previous.detail === detail) return;
      monitorState.timeline.push({ label, detail, at: Date.now() });
      monitorState.timeline = monitorState.timeline.slice(-40);
      persistDiagnostic();
    };

    const diagnosticText = (value: unknown): string => redactDiagnosticText(value).slice(0, 12000);
    const currentDiagnostic = () => ({
      spec: 'mwg.generation-diagnostic/v1', chatId: monitorState.chatId,
      generationId: monitorState.generationId, phase: monitorState.phase,
      startedAt: monitorState.startedAt, finishedAt: monitorState.finishedAt,
      detail: diagnosticText(monitorState.detail),
      timeline: monitorState.timeline.map(entry => ({ ...entry, detail: diagnosticText(entry.detail) })),
      note: '仅含阶段和校验信息，不含请求、正文、思考或完整模型响应；保存在本机浏览器。',
    });
    const diagnosticStorageKey = 'mwg-generation-diagnostics-v1';
    const readDiagnostics = (): any[] => {
      try {
        const records = JSON.parse(host.localStorage?.getItem(diagnosticStorageKey) || '[]');
        return Array.isArray(records) ? records.filter(entry => entry && typeof entry === 'object').slice(-20) : [];
      } catch { return []; }
    };
    const persistDiagnostic = (): void => {
      if (!monitorState.chatId) return;
      try {
        const records = readDiagnostics().filter(entry => entry.chatId !== monitorState.chatId
          || entry.generationId !== monitorState.generationId);
        records.push(currentDiagnostic());
        host.localStorage?.setItem(diagnosticStorageKey, JSON.stringify(records.slice(-20)));
      } catch { /* Storage unavailable: the live report remains readable. */ }
    };

    const phaseLabel = (): string => {
      if (monitorState.phase === 'generating') return monitorState.background ? '正在生成游戏内容' : '正在生成变量';
      if (monitorState.phase === 'applying') return monitorState.background ? '正在处理游戏内容' : '正在应用变量';
      if (monitorState.phase === 'success') return monitorState.background ? '游戏内容已准备完成' : '变量更新完成';
      if (monitorState.phase === 'error') return monitorState.background ? '游戏内容准备失败' : '变量生成失败';
      return '魔法少女世界设置';
    };

    const extractReturnedReasoning = (result: unknown): string => {
      if (result && typeof result === 'object') {
        const source = result as Record<string, any>;
        for (const key of ['reasoning', 'reasoning_content', 'thinking', 'analysis']) {
          if (typeof source[key] === 'string' && source[key].trim()) return source[key].trim();
        }
      }
      if (typeof result !== 'string') return '';
      const analysis = result.match(/<Analysis>([\s\S]*?)<\/Analysis>/i)?.[1]?.trim() || '';
      return /^(?:update\.?|更新。?)$/i.test(analysis) ? '' : analysis;
    };

    const extractUpdateOutput = (result: unknown): string => {
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const blocks = [
        ...text.matchAll(/<(?:UpdateVariable|VariableUpdate|Update)>[\s\S]*?<\/(?:UpdateVariable|VariableUpdate|Update)>/gi),
      ];
      return blocks.at(-1)?.[0] || text;
    };

    const serializeCapturedRequest = (value: unknown): string => {
      if (typeof value === 'string') return value;
      const seen = new WeakSet<object>();
      try {
        return JSON.stringify(value, (_key, entry) => {
          if (typeof entry === 'undefined') return '[undefined]';
          if (typeof entry === 'function') return `[Function ${entry.name || 'anonymous'}]`;
          if (typeof entry === 'bigint') return String(entry);
          if (typeof entry === 'symbol') return String(entry);
          if (typeof entry === 'number' && !Number.isFinite(entry)) return String(entry);
          if (entry && typeof entry === 'object') {
            if (seen.has(entry)) return '[Circular]';
            seen.add(entry);
          }
          return entry;
        }, 2);
      } catch (error) {
        return `请求对象无法序列化：${error instanceof Error ? error.message : String(error)}`;
      }
    };

    const setAllText = (selector: string, value: string): void => {
      root?.querySelectorAll<HTMLElement>(selector).forEach(element => {
        element.textContent = value;
      });
    };

    const replaceLines = (
      selector: string,
      lines: Array<{ title: string; detail?: string; value?: number | string }>,
      empty: string,
    ): void => {
      root?.querySelectorAll<HTMLElement>(selector).forEach(container => {
        const doc = container.ownerDocument;
        container.replaceChildren();
        if (lines.length === 0) {
          const note = doc.createElement('small');
          note.className = 'mwg-empty-note';
          note.textContent = empty;
          container.appendChild(note);
          return;
        }
        for (const line of lines) {
          const item = doc.createElement('div');
          item.className = 'mwg-data-line';
          const copy = doc.createElement('div');
          const title = doc.createElement('strong');
          title.textContent = line.title;
          copy.appendChild(title);
          if (line.detail) {
            const detail = doc.createElement('small');
            detail.textContent = line.detail;
            copy.appendChild(detail);
          }
          item.appendChild(copy);
          if (typeof line.value === 'string' || Number.isFinite(line.value)) {
            const score = doc.createElement('span');
            score.className = 'mwg-data-score';
            score.textContent = typeof line.value === 'string' ? line.value : String(Math.round(Number(line.value) * 10) / 10);
            item.appendChild(score);
          }
          container.appendChild(item);
        }
      });
    };

    let evidenceHistorySignature = '';
    let evidenceHistoryRequest = 0;
    let evidenceHistoryLimit = 5;
    let evidenceHistoryChat: string | null = null;
    const readEvidenceProvider = (): any => registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
    const readEvidenceHistory = (): any => readEvidenceProvider()?.getInitialGenerationEvidence?.() || null;
    const readTowerEvidenceHistory = (): any => readEvidenceProvider()?.getTowerGenerationEvidence?.() || null;
    // The extension owns this metadata and records only final output snapshots.
    // Whitelist its durable shape before combining it with a lightweight runtime
    // diagnostic, so request captures, headers and reasoning can never leak into
    // the primary error export through future provider-side additions.
    const finalEvidenceStages = new Set([
      'provider-final', 'repair-final', 'repair-slot-plan', 'merged-draft',
      'normalized-draft', 'compiled-result', 'semantic-observation', 'validation-errors',
    ]);
    const copyMatchingEvidenceRun = (candidate: unknown): any | null => {
      if (!candidate || typeof candidate !== 'object') return null;
      const run = candidate as Record<string, any>;
      if (typeof run.generationId !== 'string' || !run.generationId) return null;
      const records = Array.isArray(run.records) ? run.records.flatMap((record: unknown) => {
        if (!record || typeof record !== 'object') return [];
        const value = record as Record<string, any>;
        // Do not export unknown future record types. The only allowed stages are
        // the extension's final-output-only InitialEvidenceStage values.
        if (typeof value.stage !== 'string' || !finalEvidenceStages.has(value.stage) || typeof value.text !== 'string') return [];
        return [{
          stage: value.stage,
          // Preserve retained final-output bytes exactly; do not pass them through
          // diagnosticText(), which intentionally redacts and truncates display text.
          text: value.text,
          characters: value.text.length,
          truncated: false,
          capturedAt: Number(value.capturedAt) || 0,
        }];
      }) : [];
      const validationErrors = Array.isArray(run.validationErrors) ? run.validationErrors.flatMap((error: unknown) => {
        if (!error || typeof error !== 'object') return [];
        const value = error as Record<string, any>;
        return [{ code: String(value.code || ''), path: String(value.path || ''), message: String(value.message || '') }];
      }) : [];
      const archive = run.archive && typeof run.archive === 'object'
        && ['pending', 'saved', 'failed'].includes((run.archive as Record<string, any>).status)
        ? { status: (run.archive as Record<string, any>).status }
        : undefined;
      return {
        generationId: run.generationId,
        startedAt: Number(run.startedAt) || 0,
        updatedAt: Number(run.updatedAt) || 0,
        outcome: ['recording', 'completed', 'failed'].includes(run.outcome) ? run.outcome : 'recording',
        records,
        validationErrors,
        ...(archive ? { archive } : {}),
      };
    };
    const copyCurrentLiveOutput = (generationId: string): any | null => {
      // This is only a same-page fallback. It is never presented as a provider
      // original because structured stages may replace rawOutput before export.
      if (!generationId || monitorState.generationId !== generationId) return null;
      const source = monitorState.rawOutput || monitorState.pendingOutput;
      if (!source) return null;
      const isPartial = !monitorState.rawOutput && Boolean(monitorState.pendingOutput);
      const withoutReasoning = source
        .replace(/<(?:Analysis|Reasoning|Thinking)>[\s\S]*?<\/(?:Analysis|Reasoning|Thinking)>/gi, '')
        .trim();
      // Unlike the lightweight copy, the file export must not silently shorten
      // usable fallback output. It still redacts transport secrets and removes
      // embedded reasoning, and declares both transformations below.
      const text = redactDiagnosticText(withoutReasoning);
      if (!text) return null;
      return {
        source: 'mvu-monitor-live-output',
        stage: isPartial ? 'streaming-partial' : 'monitor-raw-output',
        completeness: isPartial ? 'partial' : 'latest-monitor-value',
        text,
        characters: text.length,
        truncated: false,
        reasoningRemoved: withoutReasoning.length !== source.trim().length,
        secretsRedacted: text !== withoutReasoning,
        note: isPartial
          ? '这是当前轮次尚未完成的流式片段，不是最终原文。'
          : '这是当前监视器最后收到的输出；结构化应用可能已替换该值，不能断言为提供方原始返回。',
      };
    };
    const copyManualRepairOutput = (): any | null => {
      const retained = manualRepairExportOutput;
      if (!retained?.generationId || !retained.rawOutput) return null;
      const withoutReasoning = retained.rawOutput
        .replace(/<(?:Analysis|Reasoning|Thinking)>[\s\S]*?<\/(?:Analysis|Reasoning|Thinking)>/gi, '')
        .trim();
      const text = redactDiagnosticText(withoutReasoning);
      if (!text) return null;
      return {
        source: 'manual-repair-structured-output',
        generationId: retained.generationId,
        stage: 'monitor-raw-output',
        completeness: 'latest-monitor-value',
        text,
        characters: text.length,
        capturedAt: retained.capturedAt,
        reasoningRemoved: withoutReasoning.length !== retained.rawOutput.trim().length,
        secretsRedacted: text !== withoutReasoning,
        note: '这是与手动修复归属 ID 匹配的最后结构化输出；后续后台任务不会替换它。',
      };
    };
    const retainManualRepairOutput = (generationId: string, rawOutput: unknown): void => {
      if (manualRepairGenerationId !== generationId || typeof rawOutput !== 'string' || !rawOutput.trim()) return;
      manualRepairExportOutput = { generationId, rawOutput, capturedAt: Date.now() };
    };
    const renderEvidenceHistory = (): void => {
      const container = root?.querySelector<HTMLElement>('[data-mwg-evidence-history]');
      if (!container || !monitorState.settingsVisible) return;
      const chatId = monitorState.chatId;
      if (evidenceHistoryChat !== chatId) { evidenceHistoryChat = chatId; evidenceHistoryLimit = 5; evidenceHistorySignature = ''; container.replaceChildren(); }
      const provider = readEvidenceProvider();
      if (typeof provider?.getRecentGenerationEvidence !== 'function') { container.textContent = '生成记录组件尚未就绪，请刷新完整酒馆页面。'; return; }
      const signature = JSON.stringify([chatId, evidenceHistoryLimit, provider.getGenerationEvidenceStatus?.()]);
      if (signature === evidenceHistorySignature && container.childElementCount) return;
      evidenceHistorySignature = signature;
      const request = ++evidenceHistoryRequest;
      const current = () => request === evidenceHistoryRequest && monitorState.chatId === chatId && root?.contains(container);
      if (!container.childElementCount) container.textContent = '正在读取生成记录索引…';
      void Promise.resolve().then(() => provider.getRecentGenerationEvidence(evidenceHistoryLimit)).then(page => {
        if (!current() || page.chatId !== chatId) return;
        renderGenerationEvidencePage(container, page,
          () => { evidenceHistoryLimit += 5; renderEvidenceHistory(); },
          async key => {
            const record = await provider.getGenerationEvidenceRecord(key);
            if (!current()) throw new Error('聊天或列表已变化，已取消旧原文读取');
            return { text: record.prompt ?? record.response ?? JSON.stringify({ outcome: record.outcome, error: record.error }, null, 2), full: record };
          });
        const status = container.ownerDocument.createElement('small');
        status.textContent = page.storage?.error
          ? `文件保存未完成：${page.storage.error}。未归档原文仍保留在聊天内。`
          : page.storage?.pending ? `有 ${page.storage.pending} 条爬塔或修改记录尚未归档，原文仍保留在聊天内。` : '爬塔及修改记录归档后保存在本地酒馆文件中，展开时读取并校验；开局记录沿用原存储方式。';
        container.prepend(status);
        if (page.storage?.error || page.storage?.pending) {
          const retry = container.ownerDocument.createElement('button'); retry.type = 'button'; retry.textContent = '重试保存完整记录';
          retry.addEventListener('click', () => {
            retry.disabled = true;
            void Promise.resolve().then(() => provider.retryGenerationEvidenceArchive()).then(() => {
              if (current()) { evidenceHistorySignature = ''; renderEvidenceHistory(); }
            }).catch(error => { if (current()) status.textContent = diagnosticText(error); })
              .finally(() => { retry.disabled = false; });
          });
          container.prepend(retry);
        }
      }).catch(error => {
        if (!current()) return;
        container.textContent = diagnosticText(error instanceof Error ? error.message : error);
        const retry = container.ownerDocument.createElement('button'); retry.type = 'button'; retry.textContent = '重试读取记录';
        retry.addEventListener('click', () => { evidenceHistorySignature = ''; renderEvidenceHistory(); }); container.append(retry);
      });
    };
    const renderMvuProcess = (): void => {
      // Generation evidence is diagnostic UI only. A malformed retained record
      // must never interrupt the active generation, parsing or validation path.
      try {
        renderEvidenceHistory();
      } catch (error) {
        console.warn('[MagicGirlWorld] generation evidence display failed', error);
      }
      const elapsedBase = monitorState.startedAt || Date.now();
      const timeline = monitorState.timeline.map(entry => {
        const seconds = Math.max(0, Math.round((entry.at - elapsedBase) / 100) / 10);
        return `${seconds.toFixed(1)}s  ${entry.label}${entry.detail ? ` · ${entry.detail}` : ''}`;
      }).join('\n');
      const liveOrRaw = monitorState.rawOutput || monitorState.pendingOutput;
      setAllText('[data-mwg-mvu-timeline]', timeline || '尚未开始新的 MVU 请求');
      setAllText('[data-mwg-mvu-summary]', monitorState.output || (monitorState.phase === 'generating' ? '等待模型返回…' : '本次尚无变量变化摘要'));
      setAllText('[data-mwg-mvu-raw]', liveOrRaw || '模型尚未返回完整内容');
      setAllText(
        '[data-mwg-mvu-request]',
        monitorState.requestContent
          || '尚未捕获本轮实际模型请求。',
      );
      setAllText(
        '[data-mwg-mvu-request-meta]',
        monitorState.requestCapturedAt
          ? `${monitorState.requestSource || '未知事件源'} · ${new Date(monitorState.requestCapturedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
          : '',
      );
      setAllText(
        '[data-mwg-mvu-reasoning]',
        monitorState.reasoning || '服务尚未返回可展示的分析内容；若模型或接口不提供 reasoning，前端无法还原隐藏思考。',
      );
      if (root) root.dataset.mvuHistory = monitorState.startedAt || liveOrRaw ? 'true' : 'false';
    };

    const renderDesignAssistant = (): void => {
      const dashboard = designDashboard;
      const available = dashboard?.available === true;
      const snapshot = available ? dashboard.snapshot : null;
      const profile = snapshot?.deckProfile;
      const lineage = snapshot?.lineage || dashboard?.state?.lineage;
      const capabilities = designAssistant?.getCapabilities?.() || null;
      const extensionVersion = typeof capabilities?.version === 'string' ? capabilities.version : '';
      const towerCapabilityReady = capabilities?.towerGeneration === true
        && capabilities?.towerCoordinator === true
        && capabilities?.singleFloorStart === true;
      const towerVersionReady = extensionVersion.length > 0
        && compareTowerExtensionVersions(extensionVersion, requiredTowerExtensionVersion) >= 0;
      const towerAvailable = towerCapabilityReady && towerVersionReady;
      const towerStatus = towerAvailable ? designAssistant?.getTowerCoordinatorStatus?.() : null;
      if (root) {
        root.dataset.designAvailable = available ? 'true' : 'false';
        root.dataset.deckAvailable = profile ? 'true' : 'false';
        root.dataset.lineageAvailable = Array.isArray(lineage?.families) && lineage.families.length > 0 ? 'true' : 'false';
        root.dataset.towerAvailable = towerAvailable ? 'true' : 'false';
      }
      const remoteSettings = dashboard?.settings;
      if (remoteSettings) applyRemoteSettings(remoteSettings);
      setAllText('[data-mwg-design-status]', /^卡组 [\d.]+ 分/.test(dashboard?.status?.message || '') ? '构筑分析已就绪' : dashboard?.status?.message || '等待设计辅助器连接');
      setAllText(
        '[data-mwg-tower-status]',
        towerAvailable
          ? towerStatus?.message || '爬塔后台已连接，等待本局启动'
          : '爬塔组件未安装或版本过低；剧情模式仍可正常使用。',
      );
      setAllText(
        '[data-mwg-tower-extension]',
        towerAvailable
          ? `设计辅助器 ${extensionVersion} · 爬塔组件已连接`
          : `需要设计辅助器 ${requiredTowerExtensionVersion} 或更高版本`,
      );
      setAllText(
        '[data-mwg-tower-requirement]',
        !extensionVersion
          ? `未检测到设计辅助器。下载 magic-girl-design-assistant-${requiredTowerExtensionVersion}.zip，安装后刷新酒馆。`
          : !towerVersionReady
            ? `当前版本 ${extensionVersion} 过低，需要 ${requiredTowerExtensionVersion} 或更高版本。更新后刷新酒馆。`
            : `当前扩展 ${extensionVersion} 缺少爬塔后台能力，请重新安装完整发布包后刷新酒馆。`,
      );
      setAllText(
        '[data-mwg-design-runtime]',
        available
          ? `${dashboard.threaded ? '后台模拟' : '兼容计算'} · 图谱 ${dashboard.graph?.nodes || 0} 节点 / ${dashboard.graph?.edges || 0} 关系`
          : '当前没有可用的角色卡专属设计组件',
      );
      const injectionAt = Number(dashboard?.state?.lastInjectionAt);
      const injectionSource = dashboard?.state?.lastInjectionSource === 'mvu-lifecycle'
        ? 'MVU 自动二阶段'
        : dashboard?.state?.lastInjectionSource === 'tavern-helper'
          ? '酒馆助手实时事件'
          : dashboard?.state?.lastInjectionSource === 'official'
            ? '酒馆官方事件'
            : '未知事件源';
      const injectionMessageId = dashboard?.state?.lastInjectionMessageId;
      const injectionCount = Math.max(0, Number(dashboard?.state?.lastInjectionCount) || 0);
      setAllText(
        '[data-mwg-design-injection]',
        Number.isFinite(injectionAt) && injectionAt > 0
          ? `最近注入：${injectionSource} · 楼层 ${injectionMessageId ?? '未知'} · ${new Date(injectionAt).toLocaleTimeString('zh-CN', { hour12: false })} · 本存档累计 ${injectionCount} 次`
          : '尚未捕获本存档的第二轮变量请求',
      );
      const measured = dashboard?.runtimeMeasurement;
      const measurement = measured?.fingerprint === snapshot?.deckFingerprint && measured?.status === 'ready'
        ? measured.value : null;
      const assessment = assessMeasuredBuild(measurement);
      const estimate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '暂无';
      setAllText('[data-mwg-player-estimate]', estimate(profile?.totalScore));
      setAllText('[data-mwg-enemy-estimate]', snapshot?.enemyPower?.enemyCount > 0 ? estimate(snapshot.enemyPower.currentEncounterScore) : '暂无敌人');
      const partialPower = true; // Never revive the superseded shadow score.
      setAllText('[data-mwg-deck-score]', assessment?.score != null ? `${assessment.score}%` : measured?.status === 'running' ? '实测中' : measured?.status === 'failed' ? '评估失败' : assessment ? `部分完成 ${assessment.completed}/${assessment.cases.length}` : '等待实测');
      setAllText('[data-mwg-deck-confidence]', assessment
        ? `测试表现达成度 · 已完成${assessment.completed}/${assessment.cases.length}类对手测试`
        : measured?.status === 'failed' ? `评估失败：${measured.error || '未知错误'}。可点击重新评估重试。`
          : '正在自动试打，不影响你当前的战斗和存档。');
      setAllText('[data-mwg-build-advice]', assessment?.recommendations.join('\n') || '');
      const labels: Record<string, string> = { burst: '首回合伤害', sustainedOutput: '每回合伤害', survival: '期末生命', economy: '每回合出牌', consistency: '有效行动回合', scaling: '实测场景', control: '欲望输出', combo: '样本胜利', flexibility: '最差场景' };
      for (const [key, label] of Object.entries(labels)) setAllText(`[data-mwg-dimension="${key}"]`, assessment?.dimensions[key] || `${label} 实测中`);
      document.querySelectorAll('.mwg-deck-overview').forEach(el => el.classList.toggle('mwg-incomplete-score', !assessment));
      const horizonLines = assessment?.cases.map(value => ({ title: value.label, detail: value.detail })) || [];
      const runtimeLines = (measurement?.evidence || []).flatMap((evidence: any, index: number) => {
        const trials = Array.isArray(evidence.trials) ? evidence.trials : [];
        const calibrated = measurement?.calibration?.cases?.[index];
        const caseName = calibrated?.label || (index === 0 ? '单敌' : '三敌');
        const median = (values: number[]): string => {
          const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
          if (!sorted.length) return '未测得';
          const mid = Math.floor(sorted.length / 2);
          return String(Math.round((sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10);
        };
        return ['tempo', 'survival', 'engine'].flatMap(policy => {
          const rows = trials.filter((trial: any) => trial.policy === policy && trial.outcome !== 'inconclusive');
          const score = calibrated?.policies?.find((entry: any) => entry.policy === policy);
          const calibrationText = score ? `基准生存（期末生命保全率） ${score.survival ?? '未完成'}%，最差样本 ${score.survivalFloor ?? '未完成'}%；基准输出（累计伤害/基准HP，胜利=100%） ${score.offense ?? '未完成'}%。${calibrated.turns}回合，敌方总HP ${calibrated.enemyHp}，${calibrated.pressure}。` : '';
          const name = policy === 'tempo' ? '抢攻' : policy === 'survival' ? '保命' : '展开';
          if (!rows.length) return [{ title: `${caseName} · ${name}`, detail: '没有完成的样本，不能按零收益计分。' }];
          return [{ title: `${caseName}压力 · ${name}策略 · ${rows.length} 个样本`,
            detail: `${calibrationText}各项中位数：输出 ${median(rows.map((r: any) => r.damageDealt))} · 玩家失血 ${median(rows.map((r: any) => r.hpLost))} · 玩家剩余生命 ${median(rows.map((r: any) => r.hpRemaining))} · 玩家格挡吸收 ${median(rows.map((r: any) => r.blocked))} · 召唤援护失血 ${median(rows.map((r: any) => r.summonHpLost))} · 召唤援护格挡 ${median(rows.map((r: any) => r.summonBlocked))} · 存活召唤物剩余生命 ${median(rows.map((r: any) => r.summonHpRemaining))}。胜利 ${rows.filter((r: any) => r.outcome === 'victory').length}，失败 ${rows.filter((r: any) => r.outcome === 'defeat').length}，达到回合上限 ${rows.filter((r: any) => r.outcome === 'horizon').length}。`,
          }];
        });
      });
      if (measurement) {
        const limitations = [...new Set<string>((measurement.evidence || []).flatMap((entry: any) => entry.limitations || []))];
        if (limitations.length) runtimeLines.push({ title: '本次策略与执行限制', detail: limitations.join('；') });
      }
      if (measurement) runtimeLines.push({ title: '正式引擎测量边界', detail:
        '满血开局；固定单敌/三敌/五敌、周期爆发及十回合续航基准，不随玩家HP提升偷偷增加敌方数值。开局有限正式引擎分支搜索，预算用完转启发式；这些百分比只描述标明场景的生命保全率和清敌进度，不是胜率，不合成为万能总分，也不是最优解或完整机制覆盖证明。使用持久构筑，不继承上场临时状态/能力。召唤援护失血是召唤物实际支付的生命，不等于替玩家减免的伤害；剩余召唤物生命也不保证都能拦截。' });
      replaceLines('[data-mwg-test-diagnostics]', runtimeLines, '暂无详细记录');
      replaceLines('[data-mwg-horizon-list]', [...horizonLines, ...(assessment?.methodology || []).map(detail => ({ title: '评分说明', detail }))],
        measured?.status === 'running' ? '正在独立 Worker 中执行正式战斗测量，不操作玩家存档…'
          : measured?.status === 'failed' ? `正式评估未完成：${measured.error || '未知错误'}；不显示零分。`
          : partialPower ? '机制未覆盖，暂不显示误导性的零收益曲线。' : '尚未生成回合曲线');
      const envelope = snapshot?.enemyEnvelope;
      const enemyPower = snapshot?.enemyPower;
      setAllText(
        '[data-mwg-balance-summary]',
        envelope
          ? `旧版预算估算 ${envelope.targetScore}（不代表爬塔节点目标） · 设置 ${envelope.requestedRatio}% · 参考 ${envelope.targetTurns?.[0] ?? '—'}~${envelope.targetTurns?.[1] ?? '—'} 回合${enemyPower?.enemyCount > 0 ? ` · 旧版敌人估算 ${enemyPower.currentEncounterScore}（当前血量）` : ' · 当前无可评估敌人'}`
          : '等待敌人数值预算',
      );
      replaceLines(
        '[data-mwg-unsupported-list]',
        Array.isArray(profile?.unsupportedFeatures)
          ? profile.unsupportedFeatures
            .map((feature: string) => {
              const labels: Record<string, string> = {
                self_target: '对自身生效的效果',
                trigger: '触发式效果',
                discard_lifecycle: '弃牌触发效果',
                desire_overflow_dynamic_payload: '欲望满溢的动态效果',
                desire_overflow_payload: '欲望满溢效果',
                container_formula: '容器数值公式',
                apply_status: '施加状态',
                remove_status: '移除状态',
                modify: '修改数值',
                modify_card: '强化卡牌',
                patch_card: '强化卡牌',
                attach_card: '附加卡牌效果',
                upgrade_card: '升级卡牌',
                copy: '复制卡牌',
                auto_play: '自动出牌',
                card_destination: '移动卡牌',
                move_card: '移动卡牌',
                add_card: '加入卡牌',
                ensure_card: '加入卡牌',
                card_rule: '改变卡牌规则',
                schedule: '延迟触发',
                execute: '处决效果',
                kill: '击杀效果',
                stance: '姿态切换',
                channel_orb: '生成容器',
                evoke_orb: '激发容器',
                orb_slots: '容器槽位',
                extra_turn: '额外回合',
                end_turn: '结束回合效果',
                spawn_summon: '召唤物效果',
                activate_summon: '召唤物行动',
                modify_summon: '强化召唤物',
                summon_resource: '召唤物资源',
                damage_summon: '召唤物受伤',
                heal_summon: '治疗召唤物',
                dismiss_summon: '解散召唤物',
              };
              if (feature.startsWith('axes:') || !labels[feature]) return null;
              const title = labels[feature];
              return {
                title,
                detail: '尚未计入这部分完整收益；当前参考分不能据此判断卡组变强或变弱。',
              };
            })
            .filter((entry): entry is { title: string; detail: string } => Boolean(entry))
            .slice(0, 8)
          : [],
        '当前构筑没有需要特别说明的复杂模拟机制。',
      );
      const calibration = dashboard?.state?.lastCalibration;
      replaceLines(
        '[data-mwg-calibration-list]',
        calibration
          ? [{
              title: calibration.mode === 'applied'
                ? `已校准 ×${calibration.appliedScale}`
                : calibration.mode === 'advisory'
                  ? '仅提供预算，未自动改写'
                  : '数值已验证，无需改写',
              detail: [
                `目标难度 ${calibration.requestedRatio}% / 有效 ${calibration.effectiveRatio}%`,
                calibration.winnableAtCurrentResources ? '当前资源可通关' : '当前资源存在通关风险',
                ...(Array.isArray(calibration.warnings) ? calibration.warnings.slice(0, 3) : []),
              ].join(' · '),
            }]
          : [],
        '尚未生成需要复评的新敌人。',
      );
      const archetypes = Array.isArray(profile?.archetypes) ? profile.archetypes.slice(0, 10) : [];
      const payoffLabels: Record<string, string> = {
        damage: '造成伤害', block: '获得防护', draw: '抽牌', resource: '获得资源',
        heal: '回复生命', apply_status: '施加状态', lust: '施加欲望',
      };
      const readablePayoff = (value: unknown): string => {
        const raw = String(value || '');
        const values = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1).split(/[|+]/) : [raw];
        const labels = values.map(token => payoffLabels[token] || '').filter(Boolean);
        return labels.length ? labels.join('或') : '';
      };
      replaceLines(
        '[data-mwg-archetype-list]',
        archetypes.map((entry: any) => ({
          title: `${Number(entry.share || 0) === Math.max(...(profile?.archetypes || []).map((value: any) => Number(value.share || 0))) ? '主轴 · ' : '关联 · '}${String(entry.label || entry.id || '未命名流派')}`,
          detail: [
            String(entry.description || ''),
            Array.isArray(entry.supportingCards) && entry.supportingCards.length ? `依据：${entry.supportingCards.join('、')}` : '',
            Array.isArray(entry.missingPayoffs) && entry.missingPayoffs.length
              ? `还可以补足：${entry.missingPayoffs.slice(0, 3).map(readablePayoff).filter(Boolean).join('、') || '更多核心收益'}` : '',
          ].filter(Boolean).join(' · '),
          value: `${Number(entry.share || 0).toFixed(1)}%`,
        })),
        '当前构筑尚未形成稳定流派，通用散卡仍可正常使用。',
      );
      setAllText('[data-mwg-scatter-share]', profile ? `按实际机制证据分配占比，同一张牌的多个作用分摊权重。通用散卡 ${Math.round(Number(profile.scatterShare || 0))}%；基础纯攻击／格挡不参与流派，仍参与战斗计算。` : '');
      const graphNodes = Array.isArray(snapshot?.knowledgeGraph?.nodes)
        ? snapshot.knowledgeGraph.nodes.filter((node: any) => node?.kind === 'archetype').slice(0, 8)
        : [];
      replaceLines(
        '[data-mwg-evolution-list]',
        graphNodes.map((node: any) => ({ title: String(node.label || node.id), detail: String(node.data?.description || '') })),
        '暂无明确的后续构筑建议。',
      );
      const families = Array.isArray(lineage?.families) ? lineage.families.slice(-8).reverse() : [];
      replaceLines(
        '[data-mwg-lineage-list]',
        families.map((family: any) => ({
          title: String(family.name || family.label || family.id || family.familyId || '未命名敌人族群'),
          detail: [
            Array.isArray(family.themeAxes) ? family.themeAxes.slice(0, 4).join('、') : '',
            Array.isArray(family.canonicalActions) ? `招牌行动：${family.canonicalActions.slice(-3).map((entry: any) => entry.name || entry.id || entry).join('、')}` : '',
          ].filter(Boolean).join(' · '),
        })),
        '尚未建立敌人谱系；只有剧情明确属于同族、上下位或首领关系时才会记录。',
      );
    };

    const render = (): void => {
      if (!root) return;
      root.dataset.phase = monitorState.phase;
      root.dataset.mvuOpen = monitorState.open ? 'true' : 'false';
      root.dataset.settingsOpen = monitorState.settingsVisible ? 'true' : 'false';
      root.dataset.busy = ['generating', 'applying'].includes(monitorState.phase) ? 'true' : 'false';
      root.style.display = '';
      renderDesignAssistant();
      const title = root.querySelector<HTMLElement>('[data-mwg-monitor-title]');
      const detail = root.querySelector<HTMLElement>('[data-mwg-monitor-detail]');
      const elapsed = root.querySelector<HTMLElement>('[data-mwg-monitor-elapsed]');
      const loading = root.querySelector<HTMLElement>('[data-mwg-monitor-loading]');
      const loadingTitle = root.querySelector<HTMLElement>('[data-mwg-monitor-loading-title]');
      const loadingDetail = root.querySelector<HTMLElement>('[data-mwg-monitor-loading-detail]');
      const waitAdvisory = root.querySelector<HTMLElement>('[data-mwg-initial-wait-advisory]');
      const initialStartStop = root.querySelector<HTMLButtonElement>('[data-action="cancel-tower-initial-start"]');
      const initialStartStopFeedback = root.querySelector<HTMLElement>('[data-mwg-initial-stop-feedback]');
      const completeState = root.querySelector<HTMLElement>('[data-mwg-monitor-complete]');
      const cardRepairForm = root.querySelector<HTMLElement>('[data-mwg-card-repair-form]');
      const cardRepairSubmit = root.querySelector<HTMLButtonElement>('[data-action="submit-card-repair"]');
      const cardRepairOpen = root.querySelector<HTMLButtonElement>('[data-action="open-card-repair"]');
      if (title) title.textContent = phaseLabel();
      if (detail) detail.textContent = monitorState.detail;
      if (elapsed) {
        const elapsedUntil = monitorState.finishedAt || Date.now();
        elapsed.textContent = monitorState.startedAt
          ? `${Math.max(0, Math.floor((elapsedUntil - monitorState.startedAt) / 1000))} 秒`
          : '';
      }
      const isLoading = monitorState.phase === 'generating' || monitorState.phase === 'applying';
      const backgroundStop = root.querySelector<HTMLButtonElement>('[data-action="cancel-tower-generation"]');
      if (backgroundStop) {
        backgroundStop.hidden = !isLoading || !/^tower-task:/.test(monitorState.generationId);
        backgroundStop.disabled = backgroundStopPending;
      }
      if (loading) loading.style.display = isLoading ? 'grid' : 'none';
      if (loadingTitle) loadingTitle.textContent = phaseLabel();
      if (loadingDetail) {
        loadingDetail.textContent =
          monitorState.background ? monitorState.detail : monitorState.phase === 'applying'
            ? '模型已经返回，正在校验并写入当前楼层。完成后会一次显示完整内容。'
            : '剧情正文已经完成，额外模型正在整理变量；服务返回的正文会在下方实时更新。';
      }
      const initialStartMatch = monitorState.phase === 'generating'
        ? /^mwg-single-floor-start-(\d+)-/.exec(monitorState.generationId)
        : null;
      const latestTimelineAt = monitorState.timeline.at(-1)?.at || monitorState.startedAt;
      const idleForSeconds = latestTimelineAt ? Math.floor(Math.max(0, Date.now() - latestTimelineAt) / 1000) : 0;
      if (waitAdvisory) {
        waitAdvisory.textContent = idleForSeconds >= 120
          ? initialStartMatch
            ? `本阶段已${idleForSeconds}秒没有新的进度记录；请求仍在等待，可继续等待或手动停止本次开局生成。`
            : `本阶段已${idleForSeconds}秒没有新的进度记录；请求仍在等待，可继续等待或查看排查记录。`
          : '';
        waitAdvisory.style.display = idleForSeconds >= 120 && monitorState.phase === 'generating' ? 'block' : 'none';
      }
      if (initialStartStop) {
        initialStartStop.hidden = !initialStartMatch;
        initialStartStop.style.display = initialStartMatch ? 'inline-flex' : 'none';
        initialStartStop.disabled = initialStartStopPending;
      }
      if (initialStartStopFeedback && !initialStartMatch) initialStartStopFeedback.textContent = '';
      if (completeState) completeState.style.display = monitorState.phase === 'success' ? 'grid' : 'none';
      if (cardRepairForm) cardRepairForm.style.display = monitorState.cardRepairFormVisible ? 'grid' : 'none';
      if (cardRepairSubmit) cardRepairSubmit.disabled = cardRepairPending;
      if (cardRepairOpen) cardRepairOpen.disabled = cardRepairPending;
      root.querySelectorAll<HTMLInputElement>('[data-mwg-monitor-setting]').forEach(input => {
        const key = input.dataset.mwgMonitorSetting as keyof MvuMonitorSettings;
        input.checked = !!settings[key];
      });
      const difficulty = root.querySelector<HTMLSelectElement>('[data-mwg-difficulty]');
      if (difficulty) difficulty.value = String(settings.difficultyPercent);
      root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-mwg-design-setting]').forEach(input => {
        const key = input.dataset.mwgDesignSetting as keyof MvuMonitorSettings;
        const value = settings[key];
        // Controls live in the parent SillyTavern document while this runtime
        // executes inside Tavern Helper's iframe. Cross-realm `instanceof`
        // fails even for real input elements, so use tag/type capabilities.
        if (input.tagName === 'INPUT' && input.type === 'checkbox') input.checked = Boolean(value);
        else input.value = String(value);
      });
      renderMvuProcess();
    };

    const ensureDom = (): void => {
      if (root?.isConnected) return;
      orbViewportCleanup?.();
      orbViewportCleanup = undefined;
      const doc = getTopDocument();
      if (!doc?.body) return;
      doc.getElementById('mwg-mvu-monitor')?.remove();
      const styleId = 'mwg-mvu-monitor-style';
      if (!doc.getElementById(styleId)) {
        const style = doc.createElement('style');
        style.id = styleId;
        style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&family=ZCOOL+KuaiLe&display=swap');
#mwg-mvu-monitor{all:initial;--mwg-display:"ZCOOL KuaiLe","LXGW WenKai","STKaiti","KaiTi","Microsoft YaHei",sans-serif;--mwg-body:"Noto Sans SC","Microsoft YaHei",sans-serif;position:fixed;z-index:2147483000;inset:max(10px,env(safe-area-inset-top)) 14px auto auto;color:#5f4c53;font-family:var(--mwg-body);pointer-events:none}
#mwg-mvu-monitor *,#mwg-mvu-monitor *::before,#mwg-mvu-monitor *::after{box-sizing:border-box}
#mwg-mvu-monitor button{appearance:none!important;-webkit-appearance:none!important;margin:0!important;font-family:var(--mwg-body)!important;line-height:1!important;text-transform:none!important}
#mwg-mvu-monitor .mwg-tool-orb{position:relative;display:grid!important;width:50px!important;height:50px!important;min-width:50px!important;min-height:50px!important;padding:0!important;place-items:center;pointer-events:auto;touch-action:none;user-select:none;border:1px solid #e6c5cf!important;border-radius:50%!important;background:radial-gradient(circle at 34% 26%,#fff 0 12%,#ffeef2 32%,#f5cbd8 100%)!important;color:#963c64!important;box-shadow:0 8px 24px #3f27383d,0 0 0 4px #fff8fb9c!important;font:400 24px/1 var(--mwg-display)!important;cursor:grab;transition:transform .18s ease,box-shadow .18s ease}
#mwg-mvu-monitor .mwg-tool-orb::after{position:absolute;right:-2px;bottom:-1px;display:grid;width:20px;height:20px;place-items:center;border:2px solid #fff8fb;border-radius:50%;background:#9c4b70;color:#fff;font:400 11px/1 var(--mwg-body);content:"⚙"}
#mwg-mvu-monitor .mwg-tool-orb:hover{transform:translateY(-2px) rotate(-4deg);box-shadow:0 12px 28px #3f27384a,0 0 0 5px #fff8fbc7!important}
#mwg-mvu-monitor[data-busy="true"] .mwg-tool-orb{box-shadow:0 8px 24px #3f27383d,0 0 0 4px #fff8fb9c,0 0 0 8px #d989a42e!important}
#mwg-mvu-monitor[data-busy="true"] .mwg-tool-orb::after{content:"";border:3px solid #f8dfe7;border-top-color:#963c64;background:#fff;animation:mwgMonitorSpin .8s linear infinite}
#mwg-mvu-monitor .mwg-settings-sheet{position:absolute;top:60px;right:0;display:none;width:min(540px,calc(100vw - 24px));max-height:min(82vh,820px);overflow:hidden;pointer-events:auto;border:1px solid #e2c8bd;border-radius:18px;background:#fffaf7;box-shadow:0 18px 50px #38252f45}
#mwg-mvu-monitor[data-anchor="left"] .mwg-settings-sheet{right:auto;left:0}
#mwg-mvu-monitor[data-vertical="bottom"] .mwg-settings-sheet{top:auto;bottom:60px}
#mwg-mvu-monitor[data-settings-open="true"] .mwg-settings-sheet{display:block}
#mwg-mvu-monitor .mwg-sheet-head,#mwg-mvu-monitor .mwg-monitor-head{display:flex!important;width:100%!important;align-items:center;gap:10px;padding:13px 15px;background:linear-gradient(100deg,#ffe0e8,#fff4c8);border-bottom:2px dotted #dfc9bf}
#mwg-mvu-monitor .mwg-sheet-title,#mwg-mvu-monitor .mwg-monitor-title{min-width:0;flex:1}
#mwg-mvu-monitor .mwg-sheet-title strong,#mwg-mvu-monitor .mwg-sheet-title small,#mwg-mvu-monitor .mwg-monitor-title strong,#mwg-mvu-monitor .mwg-monitor-title small{display:block!important;margin:0!important}
#mwg-mvu-monitor .mwg-sheet-title strong,#mwg-mvu-monitor .mwg-monitor-title strong{color:#8f365d;font:400 18px/1.25 var(--mwg-display)}
#mwg-mvu-monitor .mwg-sheet-title small,#mwg-mvu-monitor .mwg-monitor-title small{margin-top:4px!important;color:#937d83;font:400 12px/1.45 var(--mwg-body);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#mwg-mvu-monitor .mwg-icon-button{display:grid!important;width:34px!important;height:34px!important;min-width:34px!important;padding:0!important;place-items:center;border:1px solid #e2c8bd!important;border-radius:11px!important;background:#fffdfb!important;color:#854462!important;box-shadow:0 2px 7px #68445914!important;font-size:20px!important;cursor:pointer}
#mwg-mvu-monitor .mwg-icon-button:hover{border-color:#b66b89!important;background:#fff4f7!important}
#mwg-mvu-monitor .mwg-score-comparison{padding:12px;border:1px solid #e6c5d0;border-radius:10px;line-height:1.7;overflow-wrap:anywhere}#mwg-mvu-monitor .mwg-score-comparison small{display:block;color:#76636b;margin-top:5px}
#mwg-mvu-monitor .mwg-settings-body{display:block!important;width:100%!important;max-height:calc(min(82vh,820px) - 66px);padding:12px;overflow:auto;scrollbar-color:#d9a9bc transparent;scrollbar-width:thin;background-image:repeating-linear-gradient(to bottom,transparent 0 31px,#7ea4be10 32px)}
#mwg-mvu-monitor .mwg-setting-row{display:grid!important;width:100%!important;min-height:62px!important;margin:0 0 8px!important;padding:10px 12px!important;grid-template-columns:minmax(0,1fr) 44px!important;align-items:center!important;gap:12px!important;border:1px solid #eadbd3!important;border-radius:13px!important;background:#fffefdde!important;color:#654f58!important;cursor:pointer}
#mwg-mvu-monitor .mwg-setting-row:last-child{margin-bottom:0!important}
#mwg-mvu-monitor .mwg-setting-copy{display:block!important;min-width:0!important}
#mwg-mvu-monitor .mwg-setting-copy strong,#mwg-mvu-monitor .mwg-setting-copy small{display:block!important;margin:0!important;padding:0!important}
#mwg-mvu-monitor .mwg-setting-copy strong{color:#734458;font:500 14px/1.4 var(--mwg-body)}
#mwg-mvu-monitor .mwg-setting-copy small{margin-top:3px!important;color:#988187;font:400 11px/1.45 var(--mwg-body)}
#mwg-mvu-monitor .mwg-setting-row input{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important}
#mwg-mvu-monitor .mwg-switch{position:relative;display:block!important;width:42px!important;height:24px!important;border:1px solid #d8c6c8!important;border-radius:999px!important;background:#e5dfe1!important;box-shadow:inset 0 1px 3px #4e3a4222!important;transition:background .18s ease,border-color .18s ease}
#mwg-mvu-monitor .mwg-switch::after{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 2px 5px #4a324044;content:"";transition:transform .18s ease}
#mwg-mvu-monitor .mwg-setting-row input:checked + .mwg-switch{border-color:#b85f83!important;background:#d989a4!important}
#mwg-mvu-monitor .mwg-setting-row input:checked + .mwg-switch::after{transform:translateX(18px)}
#mwg-mvu-monitor .mwg-setting-row input:focus-visible + .mwg-switch{outline:3px solid #d989a455;outline-offset:2px}
#mwg-mvu-monitor .mwg-difficulty-row{display:grid!important;width:100%!important;margin:0 0 8px!important;padding:11px 12px!important;grid-template-columns:minmax(0,1fr) minmax(112px,142px)!important;align-items:center!important;gap:12px!important;border:1px solid #eadbd3!important;border-radius:13px!important;background:#fffefdde!important}
#mwg-mvu-monitor .mwg-difficulty-select{display:block!important;width:100%!important;min-height:38px!important;margin:0!important;padding:0 31px 0 11px!important;border:1px solid #d9c4cb!important;border-radius:10px!important;outline:none;background:#fff9fb!important;color:#7c3f5a!important;font:500 12px/1 var(--mwg-body)!important;cursor:pointer}
#mwg-mvu-monitor .mwg-difficulty-select:focus{border-color:#b96587!important;box-shadow:0 0 0 3px #d989a426!important}
#mwg-mvu-monitor .mwg-setting-action{display:flex!important;width:100%!important;min-height:62px!important;margin:0 0 8px!important;padding:10px 12px!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;border:1px solid #eadbd3!important;border-radius:13px!important;background:#fffefdde!important;color:#654f58!important;text-align:left!important;cursor:pointer}
#mwg-mvu-monitor .mwg-setting-action:hover{border-color:#c9839e!important;background:#fff5f8!important}#mwg-mvu-monitor .mwg-setting-action:disabled{opacity:.58;cursor:wait}
#mwg-mvu-monitor .mwg-setting-action::after{flex:0 0 auto;color:#a74d72;font:500 19px/1 var(--mwg-display);content:"›"}
#mwg-mvu-monitor .mwg-card-repair-form{display:none;margin:0 0 8px;padding:11px;border:1px solid #e5d1d7;border-radius:13px;background:#fff8fa;gap:9px}
#mwg-mvu-monitor .mwg-card-repair-form textarea{display:block!important;width:100%!important;min-height:92px!important;max-height:210px!important;margin:0!important;padding:10px 11px!important;resize:vertical;border:1px solid #dbc8ce!important;border-radius:10px!important;outline:none;background:#fff!important;color:#5f4c53!important;font:400 13px/1.55 var(--mwg-body)!important;box-shadow:inset 0 1px 3px #59394410!important}
#mwg-mvu-monitor .mwg-card-repair-form textarea:focus{border-color:#bc7290!important;box-shadow:0 0 0 3px #d989a429!important}
#mwg-mvu-monitor .mwg-card-repair-actions{display:flex!important;justify-content:flex-end!important;gap:8px!important}
#mwg-mvu-monitor .mwg-card-repair-button{display:inline-flex!important;min-height:34px!important;padding:0 14px!important;align-items:center!important;justify-content:center!important;border:1px solid #dbc8ce!important;border-radius:10px!important;background:#fff!important;color:#795363!important;font:500 12px/1 var(--mwg-body)!important;cursor:pointer}
#mwg-mvu-monitor .mwg-card-repair-button[data-kind="primary"]{border-color:#a95377!important;background:linear-gradient(135deg,#b66083,#914262)!important;color:#fff!important;box-shadow:0 4px 12px #7f38552e!important}.mwg-card-repair-button:disabled{opacity:.55;cursor:wait}
#mwg-mvu-monitor .mwg-card-repair-error{display:none;color:#b33d4e;font:400 11px/1.45 var(--mwg-body)!important}
#mwg-mvu-monitor [data-mwg-component]{display:none}
#mwg-mvu-monitor[data-design-available="true"] [data-mwg-component="design"],#mwg-mvu-monitor[data-design-available="true"] [data-mwg-component="diagnostics"]{display:block}
#mwg-mvu-monitor[data-deck-available="true"] [data-mwg-component="deck"],#mwg-mvu-monitor[data-deck-available="true"] [data-mwg-component="archetype"]{display:block}
#mwg-mvu-monitor[data-lineage-available="true"] [data-mwg-component="lineage"]{display:block}
#mwg-mvu-monitor[data-tower-available="true"] [data-mwg-component="tower"]{display:block}
#mwg-mvu-monitor[data-tower-available="false"] [data-mwg-component="tower-install"]{display:block}
#mwg-mvu-monitor[data-mvu-history="true"] [data-mwg-component="mvu-history"]{display:block}
#mwg-mvu-monitor .mwg-settings-group{margin:0 0 9px!important;border:1px solid #eadbd3!important;border-radius:14px!important;background:#fffefdde!important;overflow:hidden}
#mwg-mvu-monitor .mwg-settings-group>summary{display:flex!important;min-height:46px;padding:10px 13px;align-items:center;gap:9px;color:#74455a;font:500 14px/1.35 var(--mwg-body);cursor:pointer;list-style:none}
#mwg-mvu-monitor .mwg-settings-group>summary::-webkit-details-marker{display:none}
#mwg-mvu-monitor .mwg-settings-group>summary::after{margin-left:auto;color:#a74d72;font:500 18px/1 var(--mwg-body);content:"＋"}
#mwg-mvu-monitor .mwg-settings-group[open]>summary::after{content:"－"}
#mwg-mvu-monitor .mwg-group-body{padding:0 10px 10px;border-top:1px dashed #e6d5ce}
#mwg-mvu-monitor .mwg-design-status-card{margin:10px 0;padding:10px 11px;border:1px solid #e5d3d9;border-radius:11px;background:linear-gradient(135deg,#fff7fa,#fffbe9)}
#mwg-mvu-monitor .mwg-design-status-card strong,#mwg-mvu-monitor .mwg-design-status-card small{display:block!important;margin:0!important}
#mwg-mvu-monitor .mwg-design-status-card strong{color:#7e3e5a;font:500 13px/1.45 var(--mwg-body)}
#mwg-mvu-monitor .mwg-design-status-card small{margin-top:3px!important;color:#998087;font:400 11px/1.45 var(--mwg-body)}
#mwg-mvu-monitor .mwg-extension-download{display:flex!important;margin-top:9px;min-height:34px;padding:7px 10px;align-items:center;justify-content:center;border:1px solid #d5a8b9;border-radius:9px;background:#fff;color:#87445f;font:500 12px/1.4 var(--mwg-body);text-decoration:none!important}
#mwg-mvu-monitor .mwg-extension-download:hover{border-color:#a74d72;background:#fff4f8;color:#70364f}
#mwg-mvu-monitor .mwg-deck-overview.mwg-incomplete-score{grid-template-columns:1fr!important}
#mwg-mvu-monitor .mwg-incomplete-score .mwg-dimension-grid{display:none!important}
#mwg-mvu-monitor .mwg-build-advice{white-space:pre-line;overflow-wrap:anywhere;font:400 12px/1.7 var(--mwg-body);color:#6e4b59;margin:8px 0}
#mwg-mvu-monitor .mwg-deck-overview{display:grid!important;margin:10px 0;grid-template-columns:112px minmax(0,1fr);gap:10px;align-items:stretch}
#mwg-mvu-monitor .mwg-deck-score-card{display:grid!important;place-items:center;padding:12px;border:1px solid #e5d1da;border-radius:13px;background:radial-gradient(circle at 50% 20%,#fff,#fff0f6)}
#mwg-mvu-monitor .mwg-deck-score-card strong{color:#913f63;font:400 30px/1 var(--mwg-display)}
#mwg-mvu-monitor .mwg-deck-score-card small{margin-top:5px;color:#927a82;font:400 10px/1.35 var(--mwg-body)}
#mwg-mvu-monitor .mwg-dimension-grid{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
#mwg-mvu-monitor .mwg-dimension-chip{display:block!important;padding:7px 5px;border:1px solid #e8d9d2;border-radius:9px;background:#fff;color:#73535f;font:500 10px/1.2 var(--mwg-body);text-align:center}
#mwg-mvu-monitor .mwg-subsection-title{display:block!important;margin:11px 2px 6px!important;color:#89516a;font:500 12px/1.3 var(--mwg-body)}
#mwg-mvu-monitor .mwg-data-list{display:grid!important;gap:6px}
#mwg-mvu-monitor .mwg-data-line{display:flex!important;min-width:0;padding:8px 9px;align-items:center;gap:10px;border:1px solid #eadfd9;border-radius:10px;background:#fff}
#mwg-mvu-monitor .mwg-data-line>div{min-width:0;flex:1}
#mwg-mvu-monitor .mwg-data-line strong,#mwg-mvu-monitor .mwg-data-line small{display:block!important;margin:0!important}
#mwg-mvu-monitor .mwg-data-line strong{color:#6e4b59;font:500 12px/1.35 var(--mwg-body)}
#mwg-mvu-monitor .mwg-data-line small{margin-top:2px!important;color:#99868b;font:400 10px/1.45 var(--mwg-body);overflow-wrap:anywhere}
#mwg-mvu-monitor .mwg-data-score{min-width:38px;padding:4px 7px;border-radius:999px;background:#f4dbe5;color:#8a3d5d;font:600 11px/1 var(--mwg-body);text-align:center}
#mwg-mvu-monitor .mwg-empty-note{display:block!important;padding:10px;color:#9a858b;font:400 11px/1.5 var(--mwg-body)}
#mwg-mvu-monitor .mwg-inline-note{display:block!important;margin:8px 2px 0;color:#947c83;font:400 10px/1.4 var(--mwg-body)}
#mwg-mvu-monitor .mwg-process-grid{display:grid!important;gap:8px;margin-top:9px}
#mwg-mvu-monitor .mwg-process-block{min-width:0;border:1px solid #e7d8d2;border-radius:11px;background:#fff;overflow:hidden}
#mwg-mvu-monitor .mwg-process-block>summary{padding:9px 11px;color:#7b4a60;font:500 11px/1.35 var(--mwg-body);cursor:pointer}
#mwg-mvu-monitor .mwg-process-block pre{display:block!important;max-height:230px;margin:0!important;padding:10px 11px!important;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px dashed #eadbd5;background:#fffdfc;color:#67545b;font:400 10px/1.55 var(--mwg-body)!important;scrollbar-width:thin}
#mwg-mvu-monitor .mwg-refresh-design{display:flex!important;width:100%!important;min-height:36px!important;margin:9px 0 0!important;padding:0 12px!important;align-items:center!important;justify-content:center!important;border:1px solid #d9bdc8!important;border-radius:10px!important;background:#fff7fa!important;color:#88405f!important;font:500 12px/1 var(--mwg-body)!important;cursor:pointer}
#mwg-mvu-monitor .mwg-mvu-panel{position:fixed;top:max(12px,env(safe-area-inset-top));left:50%;display:none;width:min(700px,calc(100vw - 24px));max-height:min(74vh,720px);overflow:hidden;pointer-events:auto;transform:translateX(-50%);border:1px solid #e2c8bd;border-radius:18px;background:#fffaf7;box-shadow:0 20px 60px #30202a55}
#mwg-mvu-monitor[data-mvu-open="true"] .mwg-mvu-panel{display:block}
#mwg-mvu-monitor .mwg-monitor-pulse{width:11px;height:11px;flex:0 0 auto;border:2px solid #fffaf7;border-radius:50%;background:#a64c72;box-shadow:0 0 0 0 #a64c7270}
#mwg-mvu-monitor[data-phase="generating"] .mwg-monitor-pulse,#mwg-mvu-monitor[data-phase="applying"] .mwg-monitor-pulse{animation:mwgMonitorPulse 1.25s infinite}
#mwg-mvu-monitor[data-phase="success"] .mwg-monitor-pulse{background:#4d9b72}#mwg-mvu-monitor[data-phase="error"] .mwg-monitor-pulse{background:#c84d55}
#mwg-mvu-monitor .mwg-monitor-time{color:#8f777b;font:400 12px/1 var(--mwg-body)}
#mwg-mvu-monitor .mwg-monitor-body{padding:12px;max-height:calc(min(74vh,720px) - 62px);overflow:auto;scrollbar-color:#d9a9bc transparent;scrollbar-width:thin;background-image:repeating-linear-gradient(to bottom,transparent 0 31px,#7ea4be10 32px)}
#mwg-mvu-monitor .mwg-monitor-loading{display:none;min-height:205px;place-items:center;padding:32px 20px;text-align:center;border:1px solid #ead9cf;border-radius:14px;background:radial-gradient(circle at 50% 20%,#fff 0,#fffaf7 65%,#fff1f4 100%)}
#mwg-mvu-monitor .mwg-monitor-spinner{position:relative;display:block;width:52px;height:52px;margin:0 auto 17px;border:5px solid #f1dde4;border-top-color:#a64c72;border-right-color:#d991aa;border-radius:50%;animation:mwgMonitorSpin .85s linear infinite}
#mwg-mvu-monitor .mwg-monitor-spinner::after{position:absolute;inset:8px;border:3px solid transparent;border-bottom-color:#e4b45f;border-left-color:#e4b45f;border-radius:50%;content:"";animation:mwgMonitorSpin .65s linear infinite reverse}
#mwg-mvu-monitor .mwg-monitor-loading strong{display:block;color:#873657;font:400 20px/1.35 var(--mwg-display)}
#mwg-mvu-monitor .mwg-monitor-loading small{display:block;max-width:460px;margin:9px auto 0;color:#8f777b;font:400 12px/1.65 var(--mwg-body)}#mwg-mvu-monitor .mwg-initial-wait-advisory{display:none;color:#9a654f}#mwg-mvu-monitor .mwg-initial-stop{display:none;margin:12px auto 0!important;border-color:#c67572!important;color:#9d4144!important}#mwg-mvu-monitor .mwg-initial-stop-feedback{min-height:1.65em}
#mwg-mvu-monitor .mwg-diagnostic-actions [data-action="cancel-tower-generation"][hidden],#mwg-mvu-monitor .mwg-monitor-loading [data-action="cancel-tower-initial-start"][hidden]{display:none!important}
#mwg-mvu-monitor .mwg-monitor-complete{display:none;min-height:120px;place-items:center;padding:24px;text-align:center;border:1px solid #d8eadc;border-radius:14px;background:linear-gradient(145deg,#fffefd,#f1faf3)}
#mwg-mvu-monitor .mwg-monitor-complete strong{display:block;color:#477761;font:400 19px/1.35 var(--mwg-display)}
#mwg-mvu-monitor .mwg-monitor-complete small{display:block;margin-top:7px;color:#7c8c82;font:400 12px/1.6 var(--mwg-body)}
#mwg-mvu-monitor .mwg-monitor-process{margin-top:10px}
@keyframes mwgMonitorPulse{70%{box-shadow:0 0 0 9px #a64c7200}100%{box-shadow:0 0 0 0 #a64c7200}}
@keyframes mwgMonitorSpin{to{transform:rotate(360deg)}}
@media(max-width:520px){#mwg-mvu-monitor{right:9px}#mwg-mvu-monitor .mwg-tool-orb{width:46px!important;height:46px!important;min-width:46px!important;min-height:46px!important}#mwg-mvu-monitor .mwg-settings-sheet{top:55px;width:calc(100vw - 18px)}#mwg-mvu-monitor .mwg-difficulty-row{grid-template-columns:1fr!important}#mwg-mvu-monitor .mwg-deck-overview{grid-template-columns:88px minmax(0,1fr)}#mwg-mvu-monitor .mwg-dimension-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#mwg-mvu-monitor .mwg-mvu-panel{top:max(8px,env(safe-area-inset-top));width:calc(100vw - 12px);max-height:84vh}#mwg-mvu-monitor .mwg-monitor-head{padding:11px}#mwg-mvu-monitor .mwg-monitor-body{max-height:calc(84vh - 58px)}}
`;
        doc.head?.appendChild(style);
      }
      root = doc.createElement('aside');
      root.id = 'mwg-mvu-monitor';
      root.setAttribute('aria-live', 'polite');
      root.innerHTML = `
<button class="mwg-tool-orb" type="button" data-action="open-settings" title="打开魔法少女世界设置" aria-label="打开魔法少女世界设置"><span aria-hidden="true">✦</span></button>
<section class="mwg-settings-sheet" aria-label="魔法少女世界设置">
  <header class="mwg-sheet-head"><div class="mwg-sheet-title"><strong>魔法少女世界控制台</strong><small>只显示当前角色卡已经加载的功能组件</small></div><button class="mwg-icon-button" type="button" data-action="close-settings" title="关闭设置" aria-label="关闭设置">×</button></header>
  <div class="mwg-settings-body">
    <details class="mwg-settings-group" open>
      <summary>界面与修复</summary>
      <div class="mwg-group-body">
        <label class="mwg-setting-row"><span class="mwg-setting-copy"><strong>自动显示变量生成窗</strong><small>首次初始化和变量整理时自动显示进度；游玩期间后台预生成不自动弹出，可手动查看</small></span><input type="checkbox" data-mwg-monitor-setting="showMvuWindow"><span class="mwg-switch" aria-hidden="true"></span></label>
        <button class="mwg-setting-action" type="button" data-action="open-mvu"><span class="mwg-setting-copy"><strong>显示生成进度</strong><small>随时查看当前或最近一次生成，收起后可再次打开</small></span></button>
        <button class="mwg-setting-action" type="button" data-action="open-card-repair"><span class="mwg-setting-copy"><strong>自然语言修改变量</strong><small>修改卡牌、状态、能力或剧情变量，保留未要求调整的内容</small></span></button>
        <div class="mwg-card-repair-form" data-mwg-card-repair-form>
          <textarea data-mwg-card-repair-input maxlength="4000" placeholder="描述要修改的卡牌、buff、能力、角色或剧情变量，以及希望变成什么"></textarea>
          <small class="mwg-card-repair-error" data-mwg-card-repair-error></small>
          <div class="mwg-card-repair-actions"><button class="mwg-card-repair-button" type="button" data-action="cancel-card-repair">取消</button><button class="mwg-card-repair-button" data-kind="primary" type="button" data-action="submit-card-repair">开始修复</button></div>
        </div>
      </div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="design" open>
      <summary>难度与设计辅助器</summary>
      <div class="mwg-group-body">
        <div class="mwg-design-status-card"><strong data-mwg-design-status>等待设计辅助器连接</strong><small data-mwg-design-runtime></small><small data-mwg-design-injection>尚未捕获本存档的第二轮变量请求</small></div>
        <label class="mwg-setting-row"><span class="mwg-setting-copy"><strong>启用第二轮设计辅助</strong><small>只在本角色卡的 MVU 第二轮注入评分、流派与敌人预算</small></span><input type="checkbox" data-mwg-design-setting="designAssistantEnabled"><span class="mwg-switch" aria-hidden="true"></span></label>
        <label class="mwg-difficulty-row"><span class="mwg-setting-copy"><strong>剧情战斗强度</strong><small>爬塔以80%为标准档，调节敌人耐久与出招压力；不是胜率，也不是双方评分的比例</small></span><select class="mwg-difficulty-select" data-mwg-difficulty aria-label="剧情战斗强度"><option value="10">10% 剧情体验</option><option value="50">50% 轻松</option><option value="80">80% 标准</option><option value="100">100% 困难</option><option value="110">110% 高压</option></select></label>
        <label class="mwg-setting-row"><span class="mwg-setting-copy"><strong>强度分析建议</strong><small>生成前提供数值范围，生成后只评分记录，不自动改写或拒绝敌人</small></span><input type="checkbox" data-mwg-design-setting="autoCalibration"><span class="mwg-switch" aria-hidden="true"></span></label>
        <label class="mwg-difficulty-row"><span class="mwg-setting-copy"><strong>模拟精度</strong><small>精度越高，随机牌序覆盖越多，后台计算耗时也会增加</small></span><select class="mwg-difficulty-select" data-mwg-design-setting="simulationSeeds" aria-label="模拟精度"><option value="8">快速 · 8组</option><option value="12">均衡 · 12组</option><option value="16">精细 · 16组</option><option value="24">深入 · 24组</option></select></label>
        <label class="mwg-setting-row"><span class="mwg-setting-copy"><strong>爬塔战后剧情</strong><small>默认开启：按战斗日志生成剧情，在路线图上方显示；不阻塞后续节点生成</small></span><input type="checkbox" data-mwg-design-setting="towerBattleNarrative"><span class="mwg-switch" aria-hidden="true"></span></label>
        <label class="mwg-setting-row"><span class="mwg-setting-copy"><strong>显示强度提示</strong><small>在评分发现明显强弱偏差时显示建议，不修改当前敌人</small></span><input type="checkbox" data-mwg-design-setting="showNotifications"><span class="mwg-switch" aria-hidden="true"></span></label>
        <label class="mwg-setting-row"><span class="mwg-setting-copy"><strong>调试日志</strong><small>在控制台输出本轮注入的紧凑设计上下文和失败原因</small></span><input type="checkbox" data-mwg-design-setting="debug"><span class="mwg-switch" aria-hidden="true"></span></label>
        <button class="mwg-refresh-design" type="button" data-action="refresh-design">立即重新评估卡组</button>
      </div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="deck">
      <summary>卡组评分总览</summary>
      <div class="mwg-group-body">
        <div class="mwg-deck-overview"><div class="mwg-deck-score-card"><strong data-mwg-deck-score>—</strong><small data-mwg-deck-confidence>等待卡组评分</small></div><div class="mwg-dimension-grid"><span class="mwg-dimension-chip" data-mwg-dimension="burst"></span><span class="mwg-dimension-chip" data-mwg-dimension="sustainedOutput"></span><span class="mwg-dimension-chip" data-mwg-dimension="survival"></span><span class="mwg-dimension-chip" data-mwg-dimension="economy"></span><span class="mwg-dimension-chip" data-mwg-dimension="consistency"></span><span class="mwg-dimension-chip" data-mwg-dimension="scaling"></span><span class="mwg-dimension-chip" data-mwg-dimension="control"></span><span class="mwg-dimension-chip" data-mwg-dimension="combo"></span><span class="mwg-dimension-chip" data-mwg-dimension="flexibility"></span></div></div><div class="mwg-build-advice" data-mwg-build-advice></div>
        <div class="mwg-score-comparison"><strong>数值估算 · 双方对照</strong><div>我方卡组：<b data-mwg-player-estimate>—</b>　敌方当前阵容：<b data-mwg-enemy-estimate>—</b></div><small>这两项按卡牌、能力和当前敌方血量估算，仅供粗略对照，可能低估复杂联动。上方“测试表现达成度”来自固定对手试打，是另一种评分；三者都不是胜率，也不能用比值判断难度是否达标。</small></div><details class="mwg-settings-group" data-mwg-test-records><summary>查看试打记录与评分说明</summary><div class="mwg-group-body"><div class="mwg-data-list" data-mwg-horizon-list></div></div></details>
      </div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="diagnostics">
      <summary>高级诊断（平衡与试打详情）</summary>
      <div class="mwg-group-body"><div class="mwg-design-status-card"><strong>本轮敌人数值预算</strong><small data-mwg-balance-summary>等待敌人数值预算</small></div><strong class="mwg-subsection-title">最近一次敌人复评</strong><div class="mwg-data-list" data-mwg-calibration-list></div><details><summary>详细试打数据</summary><div class="mwg-data-list" data-mwg-test-diagnostics></div></details><strong class="mwg-subsection-title">模拟说明</strong><div class="mwg-data-list" data-mwg-unsupported-list></div></div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="archetype">
      <summary>流派倾向与构筑建议</summary>
      <div class="mwg-group-body"><small class="mwg-inline-note" data-mwg-scatter-share></small><strong class="mwg-subsection-title">当前流派倾向</strong><div class="mwg-data-list" data-mwg-archetype-list></div><strong class="mwg-subsection-title">后续构筑建议</strong><div class="mwg-data-list" data-mwg-evolution-list></div></div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="lineage">
      <summary>敌人谱系记忆</summary><div class="mwg-group-body"><div class="mwg-data-list" data-mwg-lineage-list></div></div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="tower">
      <summary>爬塔后台</summary>
      <div class="mwg-group-body">
        <div class="mwg-design-status-card"><strong>单页预生成状态</strong><small data-mwg-tower-extension>正在检测扩展版本</small><small data-mwg-tower-status>等待爬塔组件连接</small></div>
        <button class="mwg-refresh-design" type="button" data-action="retry-tower-generation">重试最近失败的节点</button>
        <button class="mwg-refresh-design" type="button" data-action="archive-tower-run">重试终局归档</button>
      </div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="tower-install" open>
      <summary>爬塔组件需要安装</summary>
      <div class="mwg-group-body">
        <div class="mwg-design-status-card"><strong data-mwg-tower-extension>需要设计辅助器 1.0.3 或更高版本</strong><small data-mwg-tower-requirement>安装完整扩展包后刷新酒馆；剧情模式不受影响。</small></div>
        <button class="mwg-extension-download" type="button" data-action="install-tower-extension">快捷安装爬塔组件</button>
        <a class="mwg-extension-download" href="${towerExtensionReleaseUrl}" target="_blank" rel="noopener noreferrer">安装失败时打开手动下载页面</a>
      </div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="mvu-history">
      <summary>生成记录与完整排查数据</summary>
      <div class="mwg-group-body"><button type="button" class="mwg-extension-download" data-action="export-generation-evidence">导出完整生成记录</button><div data-mwg-evidence-history></div></div>
    </details>
  </div>
</section>
<section class="mwg-mvu-panel" aria-label="MVU 二阶段生成状态">
  <header class="mwg-monitor-head"><span class="mwg-monitor-pulse"></span><div class="mwg-monitor-title"><strong data-mwg-monitor-title></strong><small data-mwg-monitor-detail></small></div><span class="mwg-monitor-time" data-mwg-monitor-elapsed></span><button class="mwg-icon-button" type="button" data-action="close-mvu" title="收起变量生成窗" aria-label="收起变量生成窗">×</button></header>
  <div class="mwg-diagnostic-actions" style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px">
    <button class="mwg-card-repair-button" type="button" data-action="copy-generation-diagnostic">复制轻量排查信息</button>
    <button class="mwg-card-repair-button" type="button" data-action="export-generation-diagnostic">导出排查记录（含保留原文）</button>
    <button class="mwg-card-repair-button" type="button" data-action="cancel-tower-generation" hidden>停止本次后台生成</button>
    <small data-mwg-diagnostic-feedback aria-live="polite">复制仅含阶段与校验信息；导出包含本次保留原文及候选，不附请求头或独立思考字段。含生成内容，分享前请检查隐私。</small>
  </div>
  <div class="mwg-monitor-body"><div class="mwg-monitor-loading" data-mwg-monitor-loading><div><span class="mwg-monitor-spinner" aria-hidden="true"></span><strong data-mwg-monitor-loading-title>正在生成变量</strong><small data-mwg-monitor-loading-detail></small><small class="mwg-initial-wait-advisory" data-mwg-initial-wait-advisory></small><button class="mwg-card-repair-button mwg-initial-stop" type="button" data-action="cancel-tower-initial-start">停止本次开局生成</button><small class="mwg-initial-stop-feedback" data-mwg-initial-stop-feedback aria-live="polite"></small></div></div><div class="mwg-monitor-complete" data-mwg-monitor-complete><div><strong>变量更新已完成</strong><small>可以在下方查看实际请求、变化摘要与模型完整返回。</small></div></div><div class="mwg-monitor-process mwg-process-grid"><details class="mwg-process-block" open><summary>阶段时间线</summary><pre data-mwg-mvu-timeline></pre></details><details class="mwg-process-block" open><summary>变量变化摘要</summary><pre data-mwg-mvu-summary></pre></details><details class="mwg-process-block"><summary>实际模型请求 <small data-mwg-mvu-request-meta></small></summary><pre data-mwg-mvu-request></pre></details><details class="mwg-process-block"><summary>模型返回原文</summary><pre data-mwg-mvu-raw></pre></details><details class="mwg-process-block"><summary>服务返回的分析内容</summary><pre data-mwg-mvu-reasoning></pre></details></div></div>
</section>`;
      doc.body.appendChild(root);
      const diagnosticReport = () => api.getDiagnosticReport();
      root.querySelector('[data-action="copy-generation-diagnostic"]')?.addEventListener('click', () => {
        const feedback = root?.querySelector<HTMLElement>('[data-mwg-diagnostic-feedback]');
        const report = diagnosticReport();
        if (!report) { if (feedback) feedback.textContent = '当前聊天还没有生成记录'; return; }
        const clipboard = host.navigator?.clipboard;
        if (!clipboard?.writeText) { if (feedback) feedback.textContent = '复制不可用，请点击导出排查记录'; return; }
        void clipboard.writeText(JSON.stringify(report, null, 2))
          .then(() => { if (feedback) feedback.textContent = '轻量排查信息已复制（不含原文）'; })
          .catch(() => { if (feedback) feedback.textContent = '复制不可用，请点击导出排查记录'; });
      });
      const exportRecords = async (button: HTMLButtonElement, diagnostic: boolean): Promise<void> => {
        if (button.disabled) return;
        const exportChatId = monitorState.chatId;
        const feedback = root?.querySelector<HTMLElement>('[data-mwg-diagnostic-feedback]');
        button.disabled = true; const label = button.textContent; button.textContent = '正在读取并校验记录…';
        try {
          const initial = diagnostic ? null : readEvidenceHistory();
          const report = diagnostic ? await api.getDiagnosticExportReport()
            : { initialGeneration: initial || { runs: [] }, towerGeneration: await readTowerEvidenceHistory() || { records: [] } };
          if (monitorState.chatId !== exportChatId) throw new Error('聊天已切换，已取消旧记录导出');
          const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob), link = doc.createElement('a');
          link.href = url; link.download = `mwg-generation-${diagnostic ? 'diagnostic' : 'records'}-${Date.now()}.json`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          if (feedback) feedback.textContent = diagnostic && report.originalResponse?.availability !== 'available' && !report.towerEvidence?.records?.some((record: any) => record.stage === 'response')
            ? `已导出排查记录；没有可确认的原始响应：${report.originalResponse?.reason || '原文未保留'}`
            : '已导出完整保留记录；分享前请检查剧情和变量隐私。';
        } catch (error) {
          if (monitorState.chatId === exportChatId) {
            const message = diagnosticText(error instanceof Error ? error.message : error);
            if (feedback) feedback.textContent = `导出失败：${message}`;
            host.toastr?.error?.(message, '生成记录导出失败');
          }
        } finally { button.disabled = false; button.textContent = label; }
      };
      for (const action of ['export-generation-diagnostic', 'export-generation-evidence']) {
        root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.addEventListener('click', event => {
          void exportRecords(event.currentTarget as HTMLButtonElement, action === 'export-generation-diagnostic');
        });
      }
      root.querySelector('[data-action="open-settings"]')?.addEventListener('click', () => {
        if (root?.dataset.dragged === 'true') {
          root.dataset.dragged = 'false';
          return;
        }
        monitorState.settingsVisible = true;
        render();
      });
      root.querySelector('[data-action="open-mvu"]')?.addEventListener('click', () => {
        api.openProgress();
      });
      root.querySelector('[data-action="close-settings"]')?.addEventListener('click', () => {
        monitorState.settingsVisible = false;
        monitorState.cardRepairFormVisible = false;
        render();
      });
      root.querySelector('[data-action="open-card-repair"]')?.addEventListener('click', () => {
        monitorState.cardRepairFormVisible = !monitorState.cardRepairFormVisible;
        const error = root?.querySelector<HTMLElement>('[data-mwg-card-repair-error]');
        if (error) error.style.display = 'none';
        render();
        if (monitorState.cardRepairFormVisible) {
          root?.querySelector<HTMLTextAreaElement>('[data-mwg-card-repair-input]')?.focus({ preventScroll: true });
        }
      });
      root.querySelector('[data-action="cancel-card-repair"]')?.addEventListener('click', () => {
        if (cardRepairPending) return;
        monitorState.cardRepairFormVisible = false;
        render();
      });
      root.querySelector('[data-action="retry-tower-generation"]')?.addEventListener('click', () => {
        const failed = towerGenerationSnapshot.failed as any;
        const nodeId = typeof failed?.nodeId === 'string' ? failed.nodeId : '';
        const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || designAssistant;
        const request = nodeId ? {
          generationType: nodeId === '__tower_opening__' ? 'opening' : 'node',
          nodeId,
        } : {};
        const retry = typeof provider?.retryTowerGeneration === 'function'
          ? Promise.resolve(provider.retryTowerGeneration(request))
          : Promise.reject(new Error('爬塔后台重试扩展尚未就绪'));
        void retry.then(() => render()).catch(error => console.warn('[MagicGirlWorld] 爬塔节点重试失败', error));
      });
      root.querySelector('[data-action="archive-tower-run"]')?.addEventListener('click', () => {
        void Promise.resolve(designAssistant?.archiveTowerRun?.())
          .then(() => render())
          .catch(error => console.warn('[MagicGirlWorld] 爬塔终局归档失败', error));
      });
      root.querySelector('[data-action="install-tower-extension"]')?.addEventListener('click', event => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        button.textContent = '正在打开酒馆安装器…';
        void installPublishedTowerExtension()
          .then(installed => {
            button.textContent = installed ? '安装完成，请刷新酒馆' : '安装已取消，可再次尝试';
          })
          .catch(error => {
            button.disabled = false;
            button.textContent = '快捷安装失败，请使用下方手动安装';
            console.warn('[MagicGirlWorld] 快捷安装爬塔组件失败', error);
          });
      });
      root.querySelector('[data-action="submit-card-repair"]')?.addEventListener('click', async () => {
        if (cardRepairPending) return;
        const input = root?.querySelector<HTMLTextAreaElement>('[data-mwg-card-repair-input]');
        const error = root?.querySelector<HTMLElement>('[data-mwg-card-repair-error]');
        const requirement = input?.value.trim() || '';
        if (!requirement || !cardRepairHandler) {
          if (error) {
            error.textContent = requirement ? '当前页面尚未完成第二轮修复接口加载，请稍后重试。' : '请先输入修复要求。';
            error.style.display = 'block';
          }
          return;
        }
        if (error) error.style.display = 'none';
        const generationId = `card-repair-${Date.now()}`;
        const repairChatId = monitorState.chatId;
        const repairSession = ++manualRepairSession;
        const stillOwnsManualRepair = () => manualRepairSession === repairSession && monitorState.chatId === repairChatId;
        manualRepairFailureEvidence = null;
        manualRepairExportOutput = null;
        cardRepairPending = true;
        manualRepairActive = true;
        manualRepairGenerationId = generationId;
        api.begin({ generationId });
        monitorState.detail = '正在按你的要求增量修复卡牌';
        monitorState.open = true;
        render();
        try {
          await cardRepairHandler(requirement);
          if (!stillOwnsManualRepair()) return;
          if (input) input.value = '';
          api.success(manualRepairGenerationId || generationId);
        } catch (repairError) {
          if (!stillOwnsManualRepair()) return;
          const candidate = repairError && typeof repairError === 'object'
            ? (repairError as Record<string, unknown>).mvuRepairEvidence
            : null;
          if (candidate && typeof candidate === 'object') {
            const evidence = candidate as Record<string, unknown>;
            manualRepairFailureEvidence = {
              response: String(evidence.response || ''),
              variableWriteObserved: evidence.variableWriteObserved === true,
              eventActivityObserved: evidence.eventActivityObserved === true,
              bareCommandObserved: evidence.bareCommandObserved === true,
            };
          }
          api.fail(repairError, manualRepairGenerationId || generationId);
        } finally {
          if (!stillOwnsManualRepair()) return;
          manualRepairActive = false;
          manualRepairGenerationId = null;
          cardRepairPending = false;
          render();
        }
      });
      root.querySelector('[data-action="close-mvu"]')?.addEventListener('click', () => {
        monitorState.open = false;
        render();
      });
      root.querySelector('[data-action="cancel-tower-generation"]')?.addEventListener('click', () => {
        if (backgroundStopPending) return;
        const generationId = monitorState.generationId;
        const feedback = root?.querySelector<HTMLElement>('[data-mwg-diagnostic-feedback]');
        if (!/^tower-task:/.test(generationId) || !['generating', 'applying'].includes(monitorState.phase)) {
          if (feedback) feedback.textContent = '当前没有可停止的爬塔后台请求。';
          return;
        }
        const runtime = registryHost[stateKey]?.api || registryHost.MagicGirlWorld || host.MagicGirlWorld;
        if (typeof runtime?.cancelTowerGeneration !== 'function') {
          if (feedback) feedback.textContent = '停止接口尚未就绪；当前请求仍在等待。';
          return;
        }
        if (feedback) feedback.textContent = '正在停止本次后台生成…';
        backgroundStopPending = true;
        render();
        void Promise.resolve().then(() => runtime.cancelTowerGeneration({ generationId }))
          .then(accepted => {
            if (feedback) feedback.textContent = accepted
              ? '已停止本次后台生成；未完成节点可手动重试。'
              : '停止请求未被接受；可能已完成、已切换聊天或不是当前请求。';
          })
          .catch(error => {
            if (feedback) feedback.textContent = '停止请求失败；当前请求仍在等待。';
            console.warn('[MagicGirlWorld] 停止爬塔后台生成失败', error);
          })
          .finally(() => {
            backgroundStopPending = false;
            render();
          });
      });
      root.querySelector('[data-action="cancel-tower-initial-start"]')?.addEventListener('click', () => {
        const generationId = monitorState.generationId;
        const match = monitorState.phase === 'generating' ? /^mwg-single-floor-start-(\d+)-/.exec(generationId) : null;
        const feedback = root?.querySelector<HTMLElement>('[data-mwg-initial-stop-feedback]');
        if (!match) return;
        const currentChatId = String(registryHost.SillyTavern?.getContext?.()?.chatId || '');
        if (!monitorState.chatId || currentChatId !== monitorState.chatId) {
          if (feedback) feedback.textContent = '当前聊天已切换，未停止旧聊天的开局生成。';
          return;
        }
        const runtime = registryHost[stateKey]?.api || registryHost.MagicGirlWorld || host.MagicGirlWorld;
        if (typeof runtime?.cancelTowerInitialStart !== 'function') {
          if (feedback) feedback.textContent = '停止接口尚未就绪；当前生成仍在等待。';
          return;
        }
        initialStartStopPending = true;
        render();
        let accepted = false;
        try {
          accepted = runtime.cancelTowerInitialStart({ sourceMessageId: Number(match[1]), generationId }) === true;
        } catch (error) {
          console.warn('[MagicGirlWorld] 停止本次开局生成失败', error);
        }
        initialStartStopPending = false;
        if (!accepted) {
          if (feedback) feedback.textContent = '停止请求未被接受；当前生成仍在等待。';
          render();
          return;
        }
        if (monitorState.generationId === generationId && monitorState.phase === 'generating') {
          api.fail('已停止本次开局生成', generationId);
        }
      });
      root.querySelectorAll<HTMLInputElement>('[data-mwg-monitor-setting]').forEach(input => {
        input.addEventListener('change', () => {
          const key = input.dataset.mwgMonitorSetting as keyof MvuMonitorSettings;
          settings = { ...settings, [key]: input.checked };
          saveSettings();
          render();
        });
      });
      root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-mwg-design-setting]').forEach(input => {
        input.addEventListener('change', () => {
          const localKey = input.dataset.mwgDesignSetting as keyof MvuMonitorSettings;
          const value = input.tagName === 'INPUT' && input.type === 'checkbox'
            ? input.checked
            : Number(input.value);
          settings = { ...settings, [localKey]: value };
          saveSettings();
          const remoteKey = localKey === 'designAssistantEnabled' ? 'enabled' : localKey;
          updateDesignSettings({ [remoteKey]: value });
          render();
        });
      });
      root.querySelector<HTMLSelectElement>('[data-mwg-difficulty]')?.addEventListener('change', event => {
        const target = event.currentTarget as HTMLSelectElement;
        settings = { ...settings, difficultyPercent: Math.max(10, Math.min(110, Math.round(Number(target.value) || 80))) };
        saveSettings();
        updateDesignSettings({ difficultyPercent: settings.difficultyPercent });
        render();
      });
      root.querySelector('[data-action="refresh-design"]')?.addEventListener('click', async () => {
        try {
          await designAssistant?.warmup?.(true);
          designDashboard = designAssistant?.getDashboard?.() || designDashboard;
          render();
        } catch (error) {
          console.warn('[MagicGirlWorld] 重新评估卡组失败', error);
        }
      });
      const orb = root.querySelector<HTMLElement>('.mwg-tool-orb');
      const getOrbViewport = (): { left: number; top: number; width: number; height: number } => {
        const view = doc.defaultView;
        const visualViewport = view?.visualViewport;
        const fallbackWidth = view?.innerWidth || doc.documentElement.clientWidth || 0;
        const fallbackHeight = view?.innerHeight || doc.documentElement.clientHeight || 0;
        const width = Number(visualViewport?.width) > 0 ? Number(visualViewport?.width) : fallbackWidth;
        const height = Number(visualViewport?.height) > 0 ? Number(visualViewport?.height) : fallbackHeight;
        return {
          left: Number.isFinite(visualViewport?.offsetLeft) ? Number(visualViewport?.offsetLeft) : 0,
          top: Number.isFinite(visualViewport?.offsetTop) ? Number(visualViewport?.offsetTop) : 0,
          width,
          height,
        };
      };
      const clampOrbCoordinate = (value: number, start: number, viewportSize: number, orbSize: number): number => {
        // Keep the whole orb visible when possible; on a viewport smaller than the
        // orb, align it with the visible edge rather than calculating an inverted range.
        const inset = Math.min(8, Math.max(0, (viewportSize - orbSize) / 2));
        const minimum = start + inset;
        const maximum = Math.max(minimum, start + viewportSize - orbSize - inset);
        return Math.min(maximum, Math.max(minimum, value));
      };
      const applyOrbPosition = (x: number, y: number): void => {
        if (!root || !orb) return;
        const width = orb.offsetWidth || 50;
        const height = orb.offsetHeight || 50;
        const viewport = getOrbViewport();
        const nextX = clampOrbCoordinate(x, viewport.left, viewport.width, width);
        const nextY = clampOrbCoordinate(y, viewport.top, viewport.height, height);
        orbPosition = { x: nextX, y: nextY };
        root.style.left = `${nextX}px`;
        root.style.top = `${nextY}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.dataset.anchor = nextX + width / 2 < viewport.left + viewport.width / 2 ? 'left' : 'right';
        root.dataset.vertical = nextY + height / 2 < viewport.top + viewport.height / 2 ? 'top' : 'bottom';
      };
      if (orb) {
        // Old localStorage values may have been valid in a larger layout viewport.
        // Start from the rendered default when there is no saved position, then clamp
        // against the *visual* viewport so mobile zoom, keyboard, and rotation remain safe.
        const initialRect = orb.getBoundingClientRect();
        applyOrbPosition(orbPosition?.x ?? initialRect.left, orbPosition?.y ?? initialRect.top);
        const view = doc.defaultView;
        const visualViewport = view?.visualViewport;
        const clampOrbToViewport = (): void => {
          if (!root?.isConnected || !orb.isConnected) return;
          const rect = orb.getBoundingClientRect();
          applyOrbPosition(orbPosition?.x ?? rect.left, orbPosition?.y ?? rect.top);
        };
        view?.addEventListener('resize', clampOrbToViewport);
        view?.addEventListener('orientationchange', clampOrbToViewport);
        visualViewport?.addEventListener('resize', clampOrbToViewport);
        visualViewport?.addEventListener('scroll', clampOrbToViewport);
        orbViewportCleanup = (): void => {
          view?.removeEventListener('resize', clampOrbToViewport);
          view?.removeEventListener('orientationchange', clampOrbToViewport);
          visualViewport?.removeEventListener('resize', clampOrbToViewport);
          visualViewport?.removeEventListener('scroll', clampOrbToViewport);
        };
        let pointerId: number | null = null;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let offsetY = 0;
        let moved = false;
        orb.addEventListener('pointerdown', event => {
          if (event.button !== 0) return;
          const rect = orb.getBoundingClientRect();
          pointerId = event.pointerId;
          startX = event.clientX;
          startY = event.clientY;
          offsetX = event.clientX - rect.left;
          offsetY = event.clientY - rect.top;
          moved = false;
          orb.setPointerCapture?.(event.pointerId);
        });
        orb.addEventListener('pointermove', event => {
          if (pointerId !== event.pointerId) return;
          if (!moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 5) return;
          moved = true;
          event.preventDefault();
          applyOrbPosition(event.clientX - offsetX, event.clientY - offsetY);
        });
        const finishDrag = (event: PointerEvent): void => {
          if (pointerId !== event.pointerId) return;
          orb.releasePointerCapture?.(event.pointerId);
          pointerId = null;
          if (!moved) return;
          if (root) root.dataset.dragged = 'true';
          saveSettings();
        };
        orb.addEventListener('pointerup', finishDrag);
        orb.addEventListener('pointercancel', finishDrag);
      }
      render();
    };

    const api = {
      resetForChat(chatId: string | null) {
        const next = String(chatId || '');
        if (monitorState.chatId === next) return;
        clearApplyTimer();
        stopElapsedTimer();
        if (streamRenderTimer !== undefined) host.clearTimeout?.(streamRenderTimer);
        streamRenderTimer = undefined;
        Object.assign(monitorState, {
          chatId: next, phase: 'idle', generationId: '', output: '', rawOutput: '',
          pendingOutput: '', reasoning: '', requestContent: '', requestSource: '',
          requestCapturedAt: 0, timeline: [], detail: '等待当前聊天的下一次变量更新',
          startedAt: 0, finishedAt: 0, candidateHasUpdateBlock: false,
          variableWriteObserved: false, open: false, background: false, cardRepairFormVisible: false,
        });
        manualRepairActive = false;
        manualRepairSession += 1;
        manualRepairGenerationId = null;
        manualRepairExportOutput = null;
        manualRepairFailureEvidence = null;
        cardRepairPending = false;
        // Keep the observed MVU lifecycle flag: a still-high flag from the old
        // request must fall before a new rising edge can start a new operation.
        render();
      },
      begin(meta: { generationId?: string; structured?: boolean; autoOpen?: boolean } = {}) {
        clearApplyTimer();
        const preserveCapturedRequest = monitorState.phase === 'generating'
          && monitorState.requestCapturedAt > 0
          && Date.now() - monitorState.requestCapturedAt < 5_000;
        monitorState.phase = 'generating';
        monitorState.background = meta.structured === true;
        monitorState.generationId = String(meta.generationId || '');
        monitorState.output = '';
        monitorState.rawOutput = '';
        monitorState.pendingOutput = '';
        monitorState.reasoning = '';
        if (!preserveCapturedRequest) {
          monitorState.requestContent = '';
          monitorState.requestSource = '';
          monitorState.requestCapturedAt = 0;
        }
        monitorState.timeline = [];
        monitorState.detail = meta.structured ? '正在准备后台生成' : '剧情已完成，正在进行第二轮变量整理';
        monitorState.startedAt = Date.now();
        monitorState.finishedAt = 0;
        monitorState.candidateHasUpdateBlock = false;
        monitorState.variableWriteObserved = false;
        // Initial/foreground work follows the preference; playable-run prefetch
        // stays quiet. Same-operation updates preserve manual open/close.
        monitorState.open = meta.autoOpen !== false && settings.showMvuWindow;
        if (monitorState.open) monitorState.settingsVisible = false;
        pushTimeline(meta.structured ? '生成流程开始' : '第二轮请求开始',
          meta.structured ? '准备当前楼层的生成任务' : '读取剧情与最新 MVU 变量');
        ensureDom();
        startElapsedTimer();
        render();
      },
      beginStructuredOperation(input: { generationId: string; detail: string; rawOutput?: string; autoOpen?: boolean }) {
        // A manual natural-language repair delegates its actual write to the
        // direct stat-data repair host. Its structured ID replaces only our
        // placeholder, never an unrelated tower/background operation.
        if (manualRepairActive
          && manualRepairGenerationId === monitorState.generationId
          && /^mwg-stat-data-repair-/.test(input.generationId)) {
          manualRepairGenerationId = input.generationId;
        }
        if (monitorState.generationId !== input.generationId || !['generating', 'applying'].includes(monitorState.phase)) {
          api.begin({ generationId: input.generationId, structured: true, autoOpen: input.autoOpen });
        }
        monitorState.detail = input.detail || '正在生成结构化游戏内容';
        if (typeof input.rawOutput === 'string') {
          monitorState.rawOutput = input.rawOutput;
          retainManualRepairOutput(input.generationId, input.rawOutput);
        }
        pushTimeline('后台任务开始', monitorState.detail);
        render();
      },
      captureMvuRequest(input: { source?: string; payload: unknown }) {
        const narrative = input.payload !== null && typeof input.payload === 'object'
          && (input.payload as Record<string, unknown>).purpose === 'preset-narrative';
        // Passive node-story observations do not belong to a finished opening.
        if (narrative && ['success', 'error'].includes(monitorState.phase)) return;
        const requestContent = serializeCapturedRequest(input.payload);
        const duplicateNarrative = narrative && monitorState.timeline.at(-1)?.label === '捕获 preset 剧情请求'
          && requestContent === monitorState.requestContent && Date.now() - monitorState.requestCapturedAt < 1000;
        monitorState.requestContent = requestContent;
        monitorState.requestSource = String(input.source || 'MVU 二次请求');
        monitorState.requestCapturedAt = Date.now();
        // Node narrative capture is passive inspection, not an MVU operation:
        // it has no variable-update terminal event. Only an explicit structured
        // begin (e.g. opening) owns that lifecycle; preserve it when active.
        if (monitorState.phase === 'idle' && !narrative) {
          monitorState.background = false;
          monitorState.phase = 'generating';
          monitorState.startedAt = monitorState.requestCapturedAt;
          monitorState.finishedAt = 0;
          if (!monitorState.background) monitorState.open = settings.showMvuWindow;
          startElapsedTimer();
        }
        if (!duplicateNarrative) pushTimeline(narrative ? '捕获 preset 剧情请求' : '捕获实际模型请求',
          narrative ? `${monitorState.requestSource} · 保留当前酒馆预设；未应用 MVU 参数策略` : monitorState.requestSource);
        ensureDom();
        render();
      },
      applyStructuredOperation(input: { generationId: string; detail: string; rawOutput?: string }) {
        if (input.generationId && monitorState.generationId !== input.generationId) return;
        clearApplyTimer();
        monitorState.phase = 'applying';
        monitorState.detail = input.detail || '正在校验并写入当前楼层';
        if (typeof input.rawOutput === 'string') {
          monitorState.rawOutput = input.rawOutput;
          retainManualRepairOutput(input.generationId, input.rawOutput);
        }
        pushTimeline('任务阶段更新', monitorState.detail);
        render();
      },
      completeStructuredOperation(input: { generationId: string; summary: string; rawOutput?: string }) {
        if (input.generationId && monitorState.generationId !== input.generationId) return;
        clearApplyTimer();
        monitorState.phase = 'success';
        monitorState.output = input.summary || '当前楼层内容已更新';
        if (typeof input.rawOutput === 'string') {
          monitorState.rawOutput = input.rawOutput;
          retainManualRepairOutput(input.generationId, input.rawOutput);
        }
        monitorState.pendingOutput = '';
        monitorState.detail = '后台内容已校验并写入当前楼层';
        monitorState.variableWriteObserved = true;
        pushTimeline('后台内容应用完成', monitorState.output);
        finishElapsedTimer();
        persistDiagnostic();
        render();
      },
      stream(text: unknown, generationId?: string) {
        if (monitorState.phase === 'idle') return;
        if (generationId && monitorState.generationId && generationId !== monitorState.generationId) {
          if (monitorState.generationId.startsWith('mvu-extra-')) {
            // MVU exposes its real generation id only after the lifecycle flag
            // opened the monitor. Bind the first streamed request instead of
            // discarding every token against our temporary id.
            monitorState.generationId = generationId;
          } else if (!generationId.startsWith(`${monitorState.generationId}-attempt-`)) {
            return;
          }
        }
        monitorState.pendingOutput = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
        queueStreamRender();
      },
      reasoning(text: unknown) {
        if (monitorState.phase === 'idle') return;
        monitorState.reasoning = typeof text === 'string' ? text : '';
        if (monitorState.reasoning) pushTimeline('收到分析内容');
        render();
      },
      complete(result: unknown, generationId?: string) {
        if (
          generationId
          && monitorState.generationId
          && generationId !== monitorState.generationId
          && !generationId.startsWith(`${monitorState.generationId}-attempt-`)
        ) return;
        if (monitorState.phase === 'idle') return;
        const updateOutput = extractUpdateOutput(result);
        const candidateHasUpdateBlock = /<UpdateVariable>[\s\S]*?<\/UpdateVariable>/i.test(updateOutput);
        // COMMAND_PARSED receives the whole assistant floor in current MVU
        // builds.  The monitor is for the second-stage response, so never
        // repeat the first-stage story in the "raw model output" panel.
        monitorState.rawOutput = updateOutput;
        monitorState.candidateHasUpdateBlock = candidateHasUpdateBlock;
        monitorState.output = summarizeMvuUpdate(updateOutput).join('\n');
        monitorState.pendingOutput = '';
        if (!monitorState.reasoning) monitorState.reasoning = extractReturnedReasoning(result);
        pushTimeline('模型返回完成', `${monitorState.rawOutput.length} 字符`);
        // COMMAND_PARSED may arrive after VARIABLE_UPDATE_ENDED in some MVU builds.
        // A variable event alone is not success: program writes and rollback
        // events also use the same hook. Require a complete model update block.
        if (monitorState.variableWriteObserved) {
          if (candidateHasUpdateBlock) api.success();
          else api.fail(new Error('第二轮模型没有返回可解析的 <UpdateVariable> 变量更新块'));
          return;
        }
        if (monitorState.phase === 'success' || monitorState.phase === 'error') {
          render();
          return;
        }
        monitorState.phase = 'applying';
        monitorState.detail = '模型已返回，正在校验并写入当前楼层';
        pushTimeline('开始解析变量', '校验 UpdateVariable 并写入当前楼层');
        clearApplyTimer();
        applyTimer = host.setTimeout?.(() => {
          if (monitorState.phase !== 'applying') return;
          monitorState.phase = 'error';
          monitorState.detail = '模型已返回，但 MVU 没有完成变量写入，请查看原文或重试';
          if (!monitorState.background) monitorState.open = settings.showMvuWindow;
          finishElapsedTimer();
          render();
        }, 20000) as number | undefined;
        render();
      },
      applying(detail = '正在执行 UpdateVariable 并检查战斗数据') {
        if (monitorState.phase === 'idle' || monitorState.phase === 'success' || monitorState.phase === 'error') return;
        monitorState.phase = 'applying';
        monitorState.detail = detail;
        pushTimeline('正在应用变量', detail);
        clearApplyTimer();
        applyTimer = host.setTimeout?.(() => {
          if (monitorState.phase !== 'applying') return;
          monitorState.phase = 'error';
          monitorState.detail = '额外模型请求已结束，但 MVU 没有完成变量写入，请重试本轮生成';
          if (!monitorState.background) monitorState.open = settings.showMvuWindow;
          finishElapsedTimer();
          render();
        }, 20000) as number | undefined;
        render();
      },
      syncExtraAnalysis(active: unknown) {
        const nextActive = active === true;
        if (nextActive === extraAnalysisActive) return;
        extraAnalysisActive = nextActive;
        if (manualRepairActive) {
          if (!nextActive && monitorState.phase === 'generating') {
            api.applying('模型请求已返回，等待 MVU 解析卡牌更新');
          }
          return;
        }
        if (nextActive) {
          api.begin({ generationId: `mvu-extra-${Date.now()}` });
          return;
        }
        if (monitorState.phase === 'generating') {
          api.applying('模型请求已返回，等待 MVU 解析变量更新');
        }
      },
      success(generationId?: string) {
        if (generationId && generationId !== monitorState.generationId) return;
        if (monitorState.phase === 'idle' || monitorState.phase === 'success' || monitorState.phase === 'error') return;
        monitorState.variableWriteObserved = true;
        if (!monitorState.candidateHasUpdateBlock) {
          monitorState.phase = 'applying';
          monitorState.detail = '变量事件已到达，正在等待模型返回的完整更新块';
          pushTimeline('等待变量更新块', '不把程序写入或空解析误判为完成');
          clearApplyTimer();
          applyTimer = host.setTimeout?.(() => {
            if (monitorState.phase !== 'applying' || monitorState.candidateHasUpdateBlock) return;
            api.fail(new Error('第二轮模型没有返回可解析的 <UpdateVariable> 变量更新块'));
          }, 1200) as number | undefined;
          render();
          return;
        }
        clearApplyTimer();
        monitorState.phase = 'success';
        monitorState.detail = '第二轮变量已写入，可继续游玩';
        pushTimeline('变量应用完成', '当前楼层 MVU 已更新');
        finishElapsedTimer();
        render();
      },
      fail(error: unknown, generationId?: string) {
        if (generationId && generationId !== monitorState.generationId) return;
        clearApplyTimer();
        monitorState.phase = 'error';
        monitorState.detail = error instanceof Error ? error.message : String(error || '额外模型请求失败');
        pushTimeline('生成或解析失败', monitorState.detail);
        if (!monitorState.background) monitorState.open = settings.showMvuWindow;
        finishElapsedTimer();
        persistDiagnostic();
        ensureDom();
        render();
      },
      getSettings: () => ({ ...settings }),
      getSnapshot: () => ({ ...monitorState }),
      getDiagnosticReport: () => {
        const history = readDiagnostics().filter(entry => entry.chatId === monitorState.chatId);
        const latest = monitorState.phase !== 'idle' ? currentDiagnostic() : history.at(-1);
        if (!latest) return null;
        return { ...latest, exportedAt: Date.now(),
          elapsedMs: Math.max(0, (latest.finishedAt || Date.now()) - latest.startedAt),
          recentRequests: history.filter(entry => entry.generationId !== latest.generationId) };
      },
      getDiagnosticExportReport: async () => {
        const exportChatId = monitorState.chatId, exportGenerationId = monitorState.generationId;
        const retainedTowerHistory = await readTowerEvidenceHistory();
        if (monitorState.chatId !== exportChatId || monitorState.generationId !== exportGenerationId) throw new Error('聊天或生成轮次已变化，已取消旧排查记录导出');
        const towerEvidence = retainedTowerHistory?.chatId === monitorState.chatId
          ? retainedTowerHistory : null;
        const diagnostic = api.getDiagnosticReport();
        const history = readEvidenceHistory();
        const currentChatEvidence = history && history.spec === 'mwg.initial-generation-evidence/v2'
          && history.chatId === monitorState.chatId && Array.isArray(history.runs)
          ? history.runs.map(copyMatchingEvidenceRun).filter(Boolean) as any[]
          : [];
        // A live or persisted lightweight record establishes the generation identity.
        // After a refresh it may be absent, in which case only the newest retained
        // run from this exact chat is eligible, and that weaker association is named.
        const generationId = typeof diagnostic?.generationId === 'string' && diagnostic.generationId
          ? diagnostic.generationId
          : [...currentChatEvidence].sort((left, right) => right.updatedAt - left.updatedAt)[0]?.generationId || '';
        const matched = generationId
          ? currentChatEvidence.find(run => run.generationId === generationId) || null
          : null;
        const liveOutput = matched ? null : copyCurrentLiveOutput(generationId);
        // A manual repair can finish after a tower task has claimed the visible
        // monitor. Keep its direct-repair ID as a separate export association.
        const manualGenerationId = manualRepairExportOutput?.generationId || '';
        const manualMatched = manualGenerationId
          ? currentChatEvidence.find(run => run.generationId === manualGenerationId) || null
          : null;
        const manualLiveOutput = manualMatched ? null : copyManualRepairOutput();
        const evidence = matched
          ? { availability: 'available' as const, association: diagnostic ? 'matching-lightweight-diagnostic' : 'current-chat-retained-evidence-without-lightweight-diagnostic', generationId, run: matched }
          : liveOutput
            ? { availability: 'available' as const, association: 'matching-live-monitor-output-fallback', generationId, liveOutput }
            : {
              availability: 'missing' as const,
              generationId: generationId || null,
              reason: !history
                ? '当前聊天没有可读取的完整生成记录，且当前监视器没有本轮可安全导出的输出。'
                : history.chatId !== monitorState.chatId
                  ? '完整记录属于其他聊天，未附加以避免跨聊天泄漏。'
                  : diagnostic
                    ? '当前轻量记录对应的生成轮次没有保留完整原文，且当前监视器没有本轮可安全导出的输出。'
                    : '当前聊天没有可与本次导出关联的完整原文记录。',
            };
        const retainedOriginal = matched?.records.find((record: any) =>
          record.stage === 'provider-final' || record.stage === 'repair-final');
        const originalResponse = retainedOriginal
          ? { availability: 'available' as const, source: 'retained-final-output-evidence', stage: retainedOriginal.stage, characters: retainedOriginal.characters }
          : {
            availability: 'missing' as const,
            reason: matched
              ? '本轮保留了候选、编译或校验记录，但没有 provider-final 或 repair-final 原始响应快照。'
              : liveOutput
                ? '当前监视器输出仅是实时回退，可能经过结构化阶段替换，不能断言为提供方原始响应。'
                : '本次导出没有可确认的提供方原始响应快照。',
          };
        return {
          spec: 'mwg.generation-diagnostic-export/v2',
          exportedAt: Date.now(),
          localOnly: true,
          note: '导出仅保存在本机。轻量诊断不含请求、正文、思考或完整模型响应；如 evidence 可用，仅含同一聊天、同一生成轮次的既有最终输出快照；没有快照时才会附上标明来源与完成度的当前监视器输出。',
          diagnostic: diagnostic || {
            availability: 'missing',
            reason: matched
              ? '刷新后未找到轻量阶段记录；以下原文来自当前聊天最近保留的生成轮次。'
              : '当前聊天没有轻量阶段记录。',
          },
          originalResponse,
          evidence,
          manualRepairEvidence: manualGenerationId
            ? manualMatched
              ? {
                  availability: 'available' as const,
                  association: 'matching-manual-direct-repair-id',
                  generationId: manualGenerationId,
                  run: manualMatched,
                }
              : manualLiveOutput
                ? {
                    availability: 'available' as const,
                    association: 'matching-manual-monitor-output-fallback',
                    generationId: manualGenerationId,
                    liveOutput: manualLiveOutput,
                  }
                : {
                    availability: 'missing' as const,
                    generationId: manualGenerationId,
                    reason: '手动修复已关联直接修复 ID，但没有可读取的同 ID 完整证据或实时输出。',
                  }
            : null,
          manualRepairFailureEvidence: manualRepairFailureEvidence
            ? {
                source: 'manual-mvu-repair-error',
                note: '手动修复失败时 MVU 返回的原始证据；可能含剧情和变量内容，分享前请检查隐私。',
                ...manualRepairFailureEvidence,
              }
            : null,
          towerEvidence,
          towerEvidenceNote: '附加当前聊天保留的爬塔请求、响应原文与修复/结算记录，按requestId和parentRequestId关联；它们不等同于上方初始化轮次。分享前请检查剧情和变量隐私。',
        };
      },
      setDesignAssistant(provider: any) {
        if (designAssistant === provider) return;
        designSettingsSynchronized = false;
        designAssistant = provider || null;
        designDashboard = designAssistant?.getDashboard?.() || null;
        if (designAssistant && !designSettingsSynchronized) {
          designSettingsSynchronized = true;
          updateDesignSettings({
            difficultyPercent: settings.difficultyPercent,
            autoCalibration: settings.autoCalibration,
          });
        }
        ensureDom();
        render();
      },
      receiveDesignAssistantDashboard(value: unknown) {
        if (!value || typeof value !== 'object') return;
        designDashboard = value;
        ensureDom();
        render();
      },
      receiveTowerGenerationStatus(value: unknown) {
        publishTowerGenerationEvent({ type: 'status', payload: value });
        const status = value as Record<string, any> | null;
        if (!status?.requestId || String(status.nodeId || '').startsWith('__initial_')) return;
        // Structure repairs remain part of the request whose validated result commits.
        const generationId = `tower-task:${String(status.requestId).replace(/__structure_repair_\d+$/, '')}`;
        if (status.phase === 'running' || status.phase === 'retrying') {
          api.beginStructuredOperation({generationId, autoOpen: false, detail: status.phase === 'retrying' ? `正在重新请求 AI 内容（第 ${status.attempt} 次）` : '正在准备可达节点的内容'});
        } else if (status.phase === 'failed' || status.phase === 'cancelled') {
          api.fail(status.error?.message || status.error || (status.phase === 'cancelled' ? '后台生成已取消，可重新准备节点' : '后台生成失败，可重试节点'), generationId);
        }
      },
      receiveTowerGenerationCompleted(value: unknown) {
        publishTowerGenerationEvent({ type: 'completed', payload: value });
        const result = value as Record<string, any> | null;
        if (!result?.requestId) return;
        const generationId = `tower-task:${result.requestId}`;
        if (monitorState.generationId !== generationId) return;
        if (result.batchOutcome?.outcome === 'partial') api.fail('部分节点已准备，另有节点失败；可在路线图重试失败节点', generationId);
        else api.completeStructuredOperation({generationId, summary:'后台内容已准备完成', rawOutput:typeof result.response === 'string' ? result.response : undefined});
      },
      receiveTowerGenerationFailed(value: unknown) {
        publishTowerGenerationEvent({ type: 'failed', payload: value });
        const result = value as Record<string, any> | null;
        if (result?.requestId) api.fail(result.error || '后台内容校验或保存失败，可重试节点', `tower-task:${result.requestId}`);
      },
      receiveTowerStateChanged(value: unknown) {
        publishTowerGenerationEvent({ type: 'stateChanged', payload: value });
      },
      openProgress() {
        monitorState.open = true;
        monitorState.settingsVisible = false;
        ensureDom();
        render();
      },
      openSettings(detail?: 'build') {
        monitorState.settingsVisible = true;
        ensureDom();
        render();
        if (detail === 'build') {
          const deck = root?.querySelector<HTMLDetailsElement>('[data-mwg-component="deck"]');
          const archetype = root?.querySelector<HTMLDetailsElement>('[data-mwg-component="archetype"]');
          if (deck) deck.open = true;
          if (archetype) archetype.open = true;
        }
      },
      destroy() {
        stopElapsedTimer();
        if (lifecycleTimer !== undefined) host.clearInterval?.(lifecycleTimer);
        if (streamRenderTimer !== undefined) host.clearTimeout?.(streamRenderTimer);
        clearApplyTimer();
        if (registryHost.MagicGirlWorldMvuMonitor === api) delete registryHost.MagicGirlWorldMvuMonitor;
        if (host.MagicGirlWorldMvuMonitor === api) delete host.MagicGirlWorldMvuMonitor;
        orbViewportCleanup?.();
        orbViewportCleanup = undefined;
        root?.remove();
        root = null;
      },
    };

    // The card runtime executes inside Tavern Helper's iframe while the
    // installed extension executes in SillyTavern's top window. Publish the
    // bridge on the parent registry host so both halves share one dashboard.
    registryHost.MagicGirlWorldMvuMonitor = api;
    host.MagicGirlWorldMvuMonitor = api;
    api.setDesignAssistant(registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null);
    syncThinkingSetting();
    ensureDom();
    listen('js_stream_token_received_fully', (text: string, generationId: string) => api.stream(text, generationId));
    listen('stream_reasoning_done', (reasoning: string) => api.reasoning(reasoning));
    const syncExtraAnalysis = (): void => {
      try {
        const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
        if (provider !== designAssistant) {
          api.setDesignAssistant(provider);
        }
        const globalVariables = host.getVariables?.({ type: 'global' });
        api.syncExtraAnalysis(globalVariables?.extra_analysis === true);
      } catch {
        // MVU creates the global lifecycle flag after its own initialization.
      }
    };
    syncExtraAnalysis();
    lifecycleTimer = host.setInterval?.(syncExtraAnalysis, 250) as number | undefined;
    return api;
  };

  const mvuMonitor = installMvuMonitor();

  const wait = (milliseconds: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, milliseconds));

  const getMvuApi = (): any => {
    if (host.Mvu) return host.Mvu;
    try {
      return host.parent?.Mvu || host.window?.parent?.Mvu;
    } catch {
      return undefined;
    }
  };

  const normalizeMvuMessageRoot = (value: unknown): Record<string, any> | null => {
    let current = value;
    for (let depth = 0; depth < 2; depth += 1) {
      if (isSettlementRecord(current) && isSettlementRecord(current.stat_data)) return current;
      if (Array.isArray(current) && current.length === 1) {
        current = current[0];
        continue;
      }
      if (
        isSettlementRecord(current)
        && Object.keys(current).length === 1
        && Object.prototype.hasOwnProperty.call(current, '0')
      ) {
        current = current['0'];
        continue;
      }
      break;
    }
    return isSettlementRecord(current) && isSettlementRecord(current.stat_data) ? current : null;
  };

  const readMvuMessageVariables = (messageId: number | 'latest'): Record<string, any> => {
    const mvu = getMvuApi();
    if (!mvu || typeof mvu.getMvuData !== 'function') throw new Error('MVU getMvuData 接口不可用');
    const variables = normalizeMvuMessageRoot(
      mvu.getMvuData({ type: 'message', message_id: messageId }),
    );
    if (!variables) throw new Error('MVU 消息变量根结构无效');
    return cloneSettlementValue(variables);
  };

  const messageVariableUpdateQueues = new Map<string, Promise<void>>();
  const runRevision = (variables: Record<string, any>): number | null => {
    const value = Number(variables.stat_data?.run?.stateRevision);
    return Number.isFinite(value) ? value : null;
  };

  /**
   * Tavern Helper's convenience variable cache can lag behind direct MVU
   * replacements performed by the persistent extension. Always merge runtime
   * actions into MVU's authoritative message snapshot so a battle-session save
   * cannot resurrect an older tower floor.
   */
  const updateMvuMessageVariablesWith = async (
    messageId: number | 'latest',
    updater: (variables: Record<string, any>) => Record<string, any> | Promise<Record<string, any>>,
  ): Promise<Record<string, any>> => {
    if (typeof updater !== 'function') throw new Error('消息变量更新器无效');
    if (messageId === 'latest') messageId = Number(host.getLastMessageId());
    if (!Number.isInteger(messageId)) throw new Error('无法确定待保存的消息');
    const chatId = mvuMonitor.getSnapshot().chatId;
    const latestMessageId = host.getLastMessageId();
    const swipeId = host.getChatMessages?.(messageId)?.at(-1)?.swipe_id;
    const assertCurrent = () => {
      if (destroyed || mvuMonitor.getSnapshot().chatId !== chatId
        || host.getLastMessageId() !== latestMessageId
        || host.getChatMessages?.(messageId)?.at(-1)?.swipe_id !== swipeId)
        throw new Error('聊天、楼层或回复已变化，已取消旧页面保存');
    };
    const key = String(messageId);
    const previous = messageVariableUpdateQueues.get(key) || Promise.resolve();
    let operation!: Promise<Record<string, any>>;
    operation = previous
      .catch(() => undefined)
      .then(async () => {
        const mvu = getMvuApi();
        if (!mvu || typeof mvu.replaceMvuData !== 'function') throw new Error('MVU replaceMvuData 接口不可用');

        assertCurrent();
        const base = readMvuMessageVariables(messageId);
        const next = await updater(cloneSettlementValue(base));
        if (!isSettlementRecord(next) || !isSettlementRecord(next.stat_data))
          throw new Error('消息变量更新器返回了无效根结构');
        return commitMvuUpdate({
          base, next, assertCurrent,
          read: () => readMvuMessageVariables(messageId),
          write: value => mvu.replaceMvuData(value, { type: 'message', message_id: messageId }),
        });
      });
    const tail = operation.then(() => undefined, () => undefined);
    messageVariableUpdateQueues.set(key, tail);
    void tail.finally(() => {
      if (messageVariableUpdateQueues.get(key) === tail) messageVariableUpdateQueues.delete(key);
    });
    return operation;
  };

  const replaceMvuMessageVariables = async (
    messageId: number | 'latest',
    variables: Record<string, any>,
  ): Promise<Record<string, any>> => {
    if (!isSettlementRecord(variables) || !isSettlementRecord(variables.stat_data)) {
      throw new Error('拒绝写入根结构无效的 MVU 消息变量');
    }
    return updateMvuMessageVariablesWith(messageId, current => {
      const currentRevision = runRevision(current);
      const incomingRevision = runRevision(variables);
      if (
        currentRevision !== null
        && incomingRevision !== null
        && incomingRevision < currentRevision
      ) {
        throw new Error(`拒绝替换为旧爬塔状态：${incomingRevision} < ${currentRevision}`);
      }
      return cloneSettlementValue(variables);
    });
  };

  const hasMvuApi = (): boolean => {
    const mvu = getMvuApi();
    return !!mvu && typeof mvu.getMvuData === 'function' && typeof mvu.replaceMvuData === 'function';
  };

  const arrayMarker = '$__META_EXTENSIBLE__$';
  const fullInitializationContexts = new WeakSet<object>();
  const inferredBattleStartContexts = new WeakSet<object>();
  const objectEntries = (value: unknown): Record<string, any>[] =>
    Array.isArray(value)
      ? value.filter(
          (entry): entry is Record<string, any> =>
            !!entry && entry !== arrayMarker && typeof entry === 'object' && !Array.isArray(entry),
        )
      : [];

  const normalizeProtocolMarkers = (value: string): string =>
    value.replace(
      /[〈＜]\s*(CHARACTER_INIT_PENDING|CONTENT_PENDING|BATTLE_PENDING|BATTLE_START)\s*[〉＞]/gi,
      (_match, marker: string) => `<${marker.toUpperCase()}>`,
    );

  const hasLightweightCardCost = (value: unknown): boolean => {
    if (value === 'energy') return true;
    if (typeof value === 'number') return Number.isInteger(value) && value >= 0;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const components = Object.entries(value);
    return components.length > 0 && components.every(([resource, amount]) =>
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(resource) &&
      (amount === 'all' || (typeof amount === 'number' && Number.isInteger(amount) && amount >= 0)),
    );
  };

  // This is intentionally only a readiness/shape check. The shared content
  // preflight remains the single authority for the full card DSL contract.
  const isCardDefinition = (value: Record<string, any>): boolean => {
    const type = String(value.type || '');
    const hasExecutableSource =
      value.effects !== undefined ||
      (type === 'Power' && value.trigger && typeof value.trigger === 'object' && !Array.isArray(value.trigger));
    const hasSupportedCost = type === 'Curse'
      ? value.cost === undefined
      : hasLightweightCardCost(value.cost);
    return (
      typeof value.id === 'string' &&
      !!value.id.trim() &&
      typeof value.name === 'string' &&
      !!value.name.trim() &&
      ['Attack', 'Skill', 'Power', 'Event', 'Curse'].includes(type) &&
      typeof value.rarity === 'string' &&
      !!value.rarity.trim() &&
      hasSupportedCost &&
      Number.isInteger(Number(value.quantity)) &&
      Number(value.quantity) > 0 &&
      hasExecutableSource
    );
  };

  const isPlayableEnemy = (enemy: unknown): enemy is Record<string, any> => {
    if (!enemy || typeof enemy !== 'object' || Array.isArray(enemy)) return false;
    const definition = enemy as Record<string, any>;
    const actions = Array.isArray(definition.actions) ? definition.actions.filter(Boolean) : [];
    return typeof definition.name === 'string' && !!definition.name.trim() && actions.length > 0;
  };

  const playableEnemies = (battle: unknown): Record<string, any>[] => {
    if (!battle || typeof battle !== 'object' || Array.isArray(battle)) return [];
    const source = battle as Record<string, any>;
    const entries = Array.isArray(source.enemies) && source.enemies.length > 0 ? source.enemies : [source.enemy];
    return entries.filter(isPlayableEnemy);
  };

  const recoverMisplacedCards = (variables: Record<string, any> | undefined): number => {
    const battle = variables?.stat_data?.battle;
    if (!battle || typeof battle !== 'object') return 0;
    const abilitySource = Array.isArray(battle.player_abilities) ? battle.player_abilities : [];
    const misplaced = objectEntries(abilitySource).filter(isCardDefinition);
    if (misplaced.length === 0) return 0;

    const cardSource = Array.isArray(battle.cards) ? battle.cards : [];
    const knownIds = new Set(objectEntries(cardSource).map(card => String(card.id || '')));
    const recovered = misplaced.filter(card => !knownIds.has(String(card.id || '')));
    battle.cards = [...cardSource, ...recovered];
    battle.player_abilities = abilitySource.filter((entry: unknown) => !misplaced.includes(entry as Record<string, any>));
    console.warn(`[MagicGirlWorld] 已将 ${recovered.length} 个误写到 player_abilities 的卡牌迁移到 battle.cards`);
    return recovered.length;
  };

  const hasInitializedPlayerContent = (
    variables: Record<string, any> | undefined,
    requireFullInitialization: boolean,
  ): boolean => {
    const battle = variables?.stat_data?.battle;
    if (!battle || typeof battle !== 'object') return false;
    const cards = objectEntries(battle.cards).filter(isCardDefinition);
    const quantity = cards.reduce((total, card) => total + Math.max(0, Number(card.quantity) || 0), 0);
    const core = battle.core;
    const validCore =
      !!core &&
      typeof core === 'object' &&
      Number.isFinite(Number(core.hp)) &&
      Number.isFinite(Number(core.max_hp)) &&
      Number(core.max_hp) > 0 &&
      Number(core.hp) >= 0 &&
      Number(core.hp) <= Number(core.max_hp) &&
      Number.isFinite(Number(core.lust)) &&
      Number.isFinite(Number(core.max_lust)) &&
      Number(core.max_lust) > 0;
    if (quantity <= 0) return false;
    if (!requireFullInitialization) return true;
    return validCore;
  };

  const compareVersions = (left: string, right: string): number => {
    const normalize = (version: string) => version.split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
    const a = normalize(left);
    const b = normalize(right);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      const difference = (a[index] || 0) - (b[index] || 0);
      if (difference !== 0) return difference;
    }
    return 0;
  };

  const waitForMessageReady = async (
    messageId: number | 'latest' = 'latest',
    options: HostReadinessOptions = {},
  ): Promise<void> => {
    const helper = host as typeof host & Record<string, any>;
    const requiredFunctions = [
      'getVariables',
      'replaceVariables',
      'updateVariablesWith',
      'insertOrAssignVariables',
      'getCurrentMessageId',
      'getLastMessageId',
    ];
    const missingFunctions = requiredFunctions.filter(name => typeof helper[name] !== 'function');
    if (missingFunctions.length > 0) throw new Error(`酒馆助手接口缺失: ${missingFunctions.join(', ')}`);

    if (typeof helper.getTavernHelperVersion === 'function') {
      const version = String(await helper.getTavernHelperVersion());
      if (compareVersions(version, '3.4.17') < 0) {
        throw new Error(`酒馆助手版本 ${version} 过低，需要 3.4.17 或更高版本`);
      }
    }

    const mvuTimeoutMs = Math.max(1, options.mvuTimeoutMs ?? 120000);
    const battleDataTimeoutMs = Math.max(1, options.battleDataTimeoutMs ?? 30000);
    const mvuDeadline = Date.now() + mvuTimeoutMs;
    if (!hasMvuApi() && typeof helper.waitGlobalInitialized === 'function') {
      Promise.resolve(helper.waitGlobalInitialized('Mvu')).catch(() => undefined);
    }
    while (!hasMvuApi() && Date.now() < mvuDeadline) await wait(100);
    if (!hasMvuApi()) throw new Error('等待 MUV 初始化超时，请确认卡内脚本已启用并完成内嵌世界书导入');
    if (options.requireBattleData === false) return;

    const dataDeadline = Date.now() + battleDataTimeoutMs;
    let lastWorldbookError = '';
    while (Date.now() < dataDeadline) {
      try {
        const variables = helper.getVariables({ type: 'message', message_id: messageId });
        if (variables?.stat_data && Object.prototype.hasOwnProperty.call(variables.stat_data, 'battle')) return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('未能找到世界书') && !/(?:could not|cannot|unable to) find (?:the )?(?:worldbook|lorebook)/i.test(message)) {
          throw error;
        }
        lastWorldbookError = message;
      }
      await wait(100);
    }
    if (lastWorldbookError) throw new Error('等待 MUV 世界书加载超时，请确认内嵌世界书已导入并链接');
    throw new Error('当前战斗楼层没有 MUV stat_data.battle，变量可能尚未初始化或更新失败');
  };

  const getMessageText = (messageId: number | 'latest' = 'latest'): string => {
    if (typeof host.getChatMessages !== 'function') return '';
    const resolvedId =
      messageId === 'latest' && typeof host.getCurrentMessageId === 'function'
        ? Number(host.getCurrentMessageId())
        : messageId;
    if (!Number.isInteger(resolvedId)) return '';
    const messages = host.getChatMessages(resolvedId);
    const message = Array.isArray(messages) ? messages[0] : undefined;
    return typeof message?.message === 'string' ? message.message : '';
  };

  const installBattleHandoff = async (): Promise<void> => {
    const deadline = Date.now() + 120000;
    while (!destroyed && !hasMvuApi() && Date.now() < deadline) await wait(100);
    if (destroyed) return;
    const mvu = getMvuApi();
    const beforeMessageUpdate = mvu?.events?.BEFORE_MESSAGE_UPDATE;
    const variableUpdateStarted = mvu?.events?.VARIABLE_UPDATE_STARTED;
    const commandParsed = mvu?.events?.COMMAND_PARSED;
    const variableUpdateEnded = mvu?.events?.VARIABLE_UPDATE_ENDED;
    if (!beforeMessageUpdate || typeof eventOn !== 'function') return;

    if (variableUpdateStarted) {
      listen(variableUpdateStarted, () => mvuMonitor.applying());
    }

    if (commandParsed) {
      listen(
        commandParsed,
        (_variables: Record<string, any>, _commands: unknown[], messageContent: string) =>
          mvuMonitor.complete(messageContent),
      );
    }

    if (variableUpdateEnded) {
      listen(
        variableUpdateEnded,
        (variables: Record<string, any>, variablesBeforeUpdate?: Record<string, any>) => {
          const settlement = reconcileBattleSettlementUpdate(variables, variablesBeforeUpdate);
          if (settlement.active && settlement.restoredPaths.length > 0) {
            console.warn(
              `[MagicGirlWorld] 已阻止结算模型改写程序字段: ${settlement.restoredPaths.join(', ')}`,
            );
          }
          const previousBattle = variablesBeforeUpdate?.stat_data?.battle;
          const previousCards = objectEntries(previousBattle?.cards).filter(isCardDefinition);
          const previousQuantity = previousCards.reduce(
            (total, card) => total + Math.max(0, Number(card.quantity) || 0),
            0,
          );
          if (
            variables &&
            typeof variables === 'object' &&
            variablesBeforeUpdate &&
            typeof variablesBeforeUpdate === 'object' &&
            previousQuantity <= 0
          ) {
            fullInitializationContexts.add(variables);
          }
          recoverMisplacedCards(variables);
          normalizeEmbeddedBattleVariables(variables);
          const previousEnemies = playableEnemies(variablesBeforeUpdate?.stat_data?.battle);
          const currentEnemies = playableEnemies(variables?.stat_data?.battle);
          if (
            variables &&
            typeof variables === 'object' &&
            previousEnemies.length === 0 &&
            currentEnemies.length > 0
          ) {
            inferredBattleStartContexts.add(variables);
          }
          mvuMonitor.success();
        },
      );
    }

    listen(beforeMessageUpdate, (context: { variables?: Record<string, any>; message_content?: string }) => {
      let message = normalizeProtocolMarkers(String(context?.message_content || ''));
      const hasInitializationMarker = message.includes('<CHARACTER_INIT_PENDING>');
      const requiresFullInitialization =
        hasInitializationMarker ||
        (!!context?.variables && fullInitializationContexts.has(context.variables));
      const hasInferredBattleStart =
        !!context?.variables && inferredBattleStartContexts.has(context.variables);
      if (context?.variables) fullInitializationContexts.delete(context.variables);
      if (context?.variables) inferredBattleStartContexts.delete(context.variables);
      const hasPending = message.includes('<BATTLE_PENDING>');
      const hasDirectStart = message.includes('<BATTLE_START>');
      recoverMisplacedCards(context?.variables);
      if (hasInitializationMarker) {
        if (hasInitializedPlayerContent(context?.variables, true)) {
          message = message.replace(/\s*<CHARACTER_INIT_PENDING>\s*/g, '\n').trimEnd();
          context.message_content = message;
        } else {
          console.error('[MagicGirlWorld] 玩家初始战斗内容未完成，保留初始化标记等待修复');
        }
      }
      if (!hasPending && !hasDirectStart && !hasInferredBattleStart) return;

      // BATTLE_START belongs to this runtime, never to either AI stage.
      if (hasDirectStart) {
        message = message.replace(/\s*<BATTLE_START>\s*/g, '\n').trimEnd();
        context.message_content = message;
        if (!hasPending && !hasInferredBattleStart) {
          console.error('[MagicGirlWorld] AI 越权输出 BATTLE_START，已移除直接启动标记');
          return;
        }
      }

      if (!hasInitializedPlayerContent(context?.variables, requiresFullInitialization)) {
        console.error('[MagicGirlWorld] 玩家初始战斗内容未完成，已阻止战斗页面提前启动');
        return;
      }

      const enemies = playableEnemies(context?.variables?.stat_data?.battle);
      if (enemies.length === 0) {
        console.error('[MagicGirlWorld] 敌人数据未注册完成，已阻止战斗页面提前启动');
        return;
      }

      context.message_content =
        message
          .replace(/\s*<BATTLE_PENDING>\s*/g, '\n')
          .trimEnd() + '\n\n<BATTLE_START>';
    });
    state.battleHandoffReady = true;
  };

  const api = Object.freeze({
    spec: 'mwg.tavern-runtime/v1',
    version: build.cardVersion,
    getViewAsset(view: RuntimeViewName): RuntimeViewAsset {
      const asset = assets[view];
      if (!asset) throw new Error(`未知的魔法少女世界视图: ${String(view)}`);
      return asset;
    },
    getBuildInfo(): RuntimeBuildInfo {
      return build;
    },
    getDiagnostics() {
      return {
        spec: 'mwg.tavern-runtime/v1',
        version: build.cardVersion,
        status: state.status,
        publishedAt: state.publishedAt,
        lastError: state.lastError,
        views: Object.keys(assets),
      };
    },
    waitForMessageReady,
    getMessageText,
    getMessageVariables(messageId: number | 'latest' = 'latest'): Record<string, any> {
      return readMvuMessageVariables(messageId);
    },
    updateMessageVariablesWith(
      messageId: number | 'latest',
      updater: (variables: Record<string, any>) => Record<string, any> | Promise<Record<string, any>>,
    ): Promise<Record<string, any>> {
      return updateMvuMessageVariablesWith(messageId, updater);
    },
    replaceMessageVariables(
      messageId: number | 'latest',
      variables: Record<string, any>,
    ): Promise<Record<string, any>> {
      return replaceMvuMessageVariables(messageId, variables);
    },
    requestCardRepair(requirement: string): Promise<void> {
      if (!cardRepairHandler) return Promise.reject(new Error('当前页面尚未完成第二轮修复接口加载'));
      return cardRepairHandler(requirement);
    },
    requestMvuExtraRepair(request: unknown): Promise<unknown> | unknown | null {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      if (typeof provider?.requestMvuExtraRepair !== 'function') return null;
      return provider.requestMvuExtraRepair(request);
    },
    requestRestMutation(request: unknown): Promise<unknown> | unknown | null {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      if (typeof provider?.requestRestMutation !== 'function') return null;
      return provider.requestRestMutation(request);
    },
    registerCardRepairHandler(handler: (requirement: string) => Promise<void>): () => void {
      if (typeof handler !== 'function') throw new Error('卡牌修复处理器无效');
      cardRepairHandler = handler;
      return () => {
        if (cardRepairHandler === handler) cardRepairHandler = null;
      };
    },
    requestTowerGeneration(request: unknown): Promise<unknown> {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      if (typeof provider?.requestTowerGeneration !== 'function') {
        return Promise.reject(new Error('爬塔后台生成扩展尚未就绪'));
      }
      return Promise.resolve(provider.requestTowerGeneration(request));
    },
    startTowerSingleFloor(request: unknown): Promise<unknown> {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      if (typeof provider?.startTowerSingleFloor !== 'function') {
        return Promise.reject(new Error('爬塔单层启动组件尚未就绪，请更新扩展后刷新酒馆'));
      }
      return Promise.resolve(provider.startTowerSingleFloor(request));
    },
    cancelTowerInitialStart(request: unknown): boolean {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      return provider?.cancelTowerInitialStart?.(request) === true;
    },
    getTowerInitialPublicationStatus(): unknown {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      return provider?.getTowerInitialPublicationStatus?.() || null;
    },
    resumeTowerInitialCommit(): Promise<unknown> {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      if (typeof provider?.resumeTowerInitialCommit !== 'function') {
        return Promise.reject(new Error('开局保存恢复组件尚未就绪，请更新扩展'));
      }
      return Promise.resolve(provider.resumeTowerInitialCommit());
    },
    persistTowerGeneration(request: unknown): Promise<unknown> {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      if (typeof provider?.persistTowerGeneration !== 'function') {
        return Promise.reject(new Error('爬塔后台持久化扩展尚未就绪'));
      }
      return Promise.resolve(provider.persistTowerGeneration(request));
    },
    retryTowerGeneration(request: unknown): Promise<unknown> {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      if (typeof provider?.retryTowerGeneration !== 'function') {
        return Promise.reject(new Error('爬塔后台重试扩展尚未就绪'));
      }
      return Promise.resolve(provider.retryTowerGeneration(request));
    },
    cancelTowerGeneration(request: unknown): Promise<unknown> {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      if (typeof provider?.cancelTowerGenerationById !== 'function') return Promise.resolve(false);
      return Promise.resolve(provider.cancelTowerGenerationById(request));
    },
    scheduleTowerGeneration(reason = 'character-runtime'): Promise<unknown> {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      if (typeof provider?.scheduleTowerGeneration !== 'function') return Promise.resolve(false);
      return Promise.resolve(provider.scheduleTowerGeneration(reason));
    },
    archiveTowerRun(): Promise<unknown> {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      if (typeof provider?.archiveTowerRun !== 'function') {
        return Promise.reject(new Error('爬塔终局归档扩展尚未就绪'));
      }
      return Promise.resolve(provider.archiveTowerRun());
    },
    getTowerCoordinatorStatus(): unknown {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      return typeof provider?.getTowerCoordinatorStatus === 'function' ? provider.getTowerCoordinatorStatus() : null;
    },
    getDesignAssistantCapabilities(): unknown {
      const provider = registryHost.MagicGirlDesignAssistant || host.MagicGirlDesignAssistant || null;
      return typeof provider?.getCapabilities === 'function' ? provider.getCapabilities() : null;
    },
    checkTowerExtensionVersion(force = false): Promise<TowerExtensionVersionStatus> {
      return checkPublishedTowerExtension(force);
    },
    installTowerExtension(): Promise<boolean> {
      return installPublishedTowerExtension();
    },
    getMvuMonitorSnapshot() {
      return mvuMonitor.getSnapshot();
    },
    getGenerationDiagnosticReport() {
      return mvuMonitor.getDiagnosticReport();
    },
    getGenerationDiagnosticExportReport() {
      return mvuMonitor.getDiagnosticExportReport();
    },
    openGenerationDiagnostics() {
      mvuMonitor.openProgress();
    },
    reportMvuValidationFailure(error: unknown) {
      mvuMonitor.fail(error);
    },
    registerTowerGenerationListener(
      listener: (event: TowerGenerationBridgeEvent) => void,
      replay = true,
    ): () => void {
      if (typeof listener !== 'function') throw new Error('爬塔生成监听器无效');
      towerGenerationListeners.add(listener);
      if (replay) {
        if (towerGenerationSnapshot.status !== null) {
          listener({ type: 'status', payload: towerGenerationSnapshot.status });
        }
        if (towerGenerationSnapshot.completed !== null) {
          listener({ type: 'completed', payload: towerGenerationSnapshot.completed });
        }
        if (towerGenerationSnapshot.failed !== null) {
          listener({ type: 'failed', payload: towerGenerationSnapshot.failed });
        }
        if (towerGenerationSnapshot.stateChanged !== null) {
          listener({ type: 'stateChanged', payload: towerGenerationSnapshot.stateChanged });
        }
      }
      return () => towerGenerationListeners.delete(listener);
    },
    getTowerGenerationSnapshot() {
      return { ...towerGenerationSnapshot };
    },
  });

  const destroyRuntime = (): void => {
    if (destroyed) return;
    destroyed = true;
    state.status = 'closed';
    removeEventBindings();
    mvuMonitor.destroy();
    messageVariableUpdateQueues.clear();
    cardRepairHandler = null;
    towerGenerationListeners.clear();
    if (registryHost[stateKey]?.instanceId === instanceId) delete registryHost[stateKey];
  };

  registryHost[stateKey] = { api, state, instanceId, destroy: destroyRuntime };

  const publish = () => {
    try {
      if (typeof initializeGlobal !== 'function') throw new Error('酒馆助手分享接口 initializeGlobal 不可用');
      initializeGlobal('MagicGirlWorld', api);
      state.status = 'ready';
      state.publishedAt = Date.now();
      state.lastError = '';
      console.info(`[MagicGirlWorld] 角色运行时 ${build.cardVersion} 已就绪`);
      if (!destroyed) void installBattleHandoff();
    } catch (error) {
      state.status = 'error';
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error('[MagicGirlWorld] 角色运行时发布失败', error);
    }
  };

  if (typeof $ === 'function') {
    $(() => publish());
    $(window).on('pagehide', () => {
      if (registryHost[stateKey]?.instanceId === instanceId) destroyRuntime();
    });
  } else {
    publish();
  }
})();
