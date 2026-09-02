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
        'id', 'name', 'emoji', 'description', 'type', 'stacks_change', 'maxStacks', 'stun', 'triggers', '$meta',
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
    'reward.item': '道具奖励', 'reward.limits': '奖励选择', 'reward.request': '战斗结算请求',
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
    type: 'status' | 'completed' | 'failed';
    payload: unknown;
  };
  const towerGenerationListeners = new Set<(event: TowerGenerationBridgeEvent) => void>();
  const towerGenerationSnapshot: {
    status: unknown;
    completed: unknown;
    failed: unknown;
  } = { status: null, completed: null, failed: null };
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
    debug: boolean;
  };

  const requiredTowerExtensionVersion = '0.3.0';
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
      const extensionName = extensionNames.find((name: string) => /(?:^|\/)magic-girl-world$/i.test(name))
        || 'third-party/magic-girl-world';
      const response = await parentWindow.fetch('/api/extensions/update', {
        method: 'POST',
        headers: scriptModule.getRequestHeaders(),
        body: JSON.stringify({ extensionName, global: false }),
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
      settings.debug = settings.debug === true;
      if (Number.isFinite(stored?.orbPosition?.x) && Number.isFinite(stored?.orbPosition?.y)) {
        orbPosition = { x: Number(stored.orbPosition.x), y: Number(stored.orbPosition.y) };
      }
    } catch {
      // UI preferences must never block the character runtime.
    }

    const monitorState = {
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
      settingsVisible: false,
      cardRepairFormVisible: false,
    };
    let root: HTMLElement | null = null;
    let timer: number | undefined;
    let lifecycleTimer: number | undefined;
    let applyTimer: number | undefined;
    let streamRenderTimer: number | undefined;
    let extraAnalysisActive = false;
    let manualRepairActive = false;
    let cardRepairPending = false;
    let designAssistant: any = null;
    let designDashboard: any = null;
    let designSettingsSynchronized = false;

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
      monitorState.timeline = monitorState.timeline.slice(-12);
    };

    const phaseLabel = (): string => {
      if (monitorState.phase === 'generating') return '正在生成变量';
      if (monitorState.phase === 'applying') return '正在应用变量';
      if (monitorState.phase === 'success') return '变量更新完成';
      if (monitorState.phase === 'error') return '变量生成失败';
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
      lines: Array<{ title: string; detail?: string; value?: number }>,
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
          if (Number.isFinite(line.value)) {
            const score = doc.createElement('span');
            score.className = 'mwg-data-score';
            score.textContent = String(Math.round(Number(line.value) * 10) / 10);
            item.appendChild(score);
          }
          container.appendChild(item);
        }
      });
    };

    const renderMvuProcess = (): void => {
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
          || '尚未捕获本轮 MVU 二次请求；只有真正进入第二阶段后才会显示。',
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
      setAllText('[data-mwg-design-status]', dashboard?.status?.message || '等待设计辅助器连接');
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
      setAllText('[data-mwg-deck-score]', profile ? String(profile.totalScore) : '—');
      setAllText(
        '[data-mwg-deck-confidence]',
        profile
          ? `置信度 ${Math.round(Number(profile.confidence || 0) * 100)}% · 牌库质量 ${Math.round(Number(profile.deckQuality?.multiplier ?? 1) * 100)}%`
          : '等待卡组评分',
      );
      const labels: Record<string, string> = {
        burst: '爆发', sustainedOutput: '持续', survival: '生存', economy: '经济',
        consistency: '稳定', scaling: '成长', control: '控制', combo: '组合', flexibility: '灵活',
      };
      for (const [key, label] of Object.entries(labels)) {
        setAllText(`[data-mwg-dimension="${key}"]`, profile ? `${label} ${profile.dimensions?.[key] ?? 0}` : `${label} —`);
      }
      const horizons = profile?.horizons || {};
      const horizonLines = [1, 3, 5, 8].flatMap(turn => {
        const point = horizons[turn];
        return point
          ? [{
              title: `第 ${turn} 回合`,
              detail: `生命输出 ${point.hpDamage?.p50 ?? 0} · 欲望 ${point.lustPressure?.p50 ?? 0} · 防护 ${point.mitigation?.p50 ?? 0} · 治疗 ${point.healing?.p50 ?? 0}`,
            }]
          : [];
      });
      replaceLines('[data-mwg-horizon-list]', horizonLines, '尚未生成回合曲线');
      const envelope = snapshot?.enemyEnvelope;
      const enemyPower = snapshot?.enemyPower;
      setAllText(
        '[data-mwg-balance-summary]',
        envelope
          ? `目标 ${envelope.targetScore} 分 · 有效难度 ${envelope.effectiveRatio}% · 预计 ${envelope.targetTurns?.[0] ?? '—'}~${envelope.targetTurns?.[1] ?? '—'} 回合${enemyPower ? ` · 当前敌人 ${enemyPower.currentEncounterScore} 分` : ''}`
          : '等待敌人数值预算',
      );
      replaceLines(
        '[data-mwg-unsupported-list]',
        Array.isArray(profile?.unsupportedFeatures)
          ? profile.unsupportedFeatures.slice(0, 12).map((feature: string) => ({
              title: String(feature),
              detail: '该机制尚未被影子模拟完整执行；只提供保守预算，不自动改写敌人数值。',
            }))
          : [],
        '当前构筑没有未覆盖的模拟机制。',
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
      replaceLines(
        '[data-mwg-archetype-list]',
        archetypes.map((entry: any) => ({
          title: String(entry.label || entry.id || '未命名流派'),
          detail: Array.isArray(entry.missingPayoffs) && entry.missingPayoffs.length
            ? `待补收益：${entry.missingPayoffs.slice(0, 3).join('、')}`
            : '当前机制可以稳定识别',
          value: Number(entry.score || 0),
        })),
        '当前构筑尚未形成稳定流派，通用散卡仍可正常使用。',
      );
      setAllText('[data-mwg-scatter-share]', profile ? `通用散卡占比 ${Math.round(Number(profile.scatterShare || 0))}%` : '');
      const graphNodes = Array.isArray(snapshot?.knowledgeGraph?.nodes)
        ? snapshot.knowledgeGraph.nodes.filter((node: any) => node?.kind === 'archetype').slice(0, 8)
        : [];
      replaceLines(
        '[data-mwg-evolution-list]',
        graphNodes.map((node: any) => ({ title: String(node.label || node.id), detail: String(node.data?.description || '') })),
        '暂无可展示的邻接流派路径。',
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
      if (loading) loading.style.display = isLoading ? 'grid' : 'none';
      if (loadingTitle) loadingTitle.textContent = monitorState.phase === 'applying' ? '正在应用变量' : '正在生成变量';
      if (loadingDetail) {
        loadingDetail.textContent =
          monitorState.phase === 'applying'
            ? '模型已经返回，正在校验并写入当前楼层。完成后会一次显示完整内容。'
            : '剧情正文已经完成，额外模型正在整理变量；服务返回的正文会在下方实时更新。';
      }
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
#mwg-mvu-monitor .mwg-monitor-loading small{display:block;max-width:460px;margin:9px auto 0;color:#8f777b;font:400 12px/1.65 var(--mwg-body)}
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
        <label class="mwg-setting-row"><span class="mwg-setting-copy"><strong>自动显示变量生成窗</strong><small>剧情完成后自动显示独立的 MVU 二阶段状态</small></span><input type="checkbox" data-mwg-monitor-setting="showMvuWindow"><span class="mwg-switch" aria-hidden="true"></span></label>
        <button class="mwg-setting-action" type="button" data-action="open-card-repair"><span class="mwg-setting-copy"><strong>自然语言修复卡牌</strong><small>描述想调整的卡牌，交给第二轮 MVU 原楼层增量修复</small></span></button>
        <div class="mwg-card-repair-form" data-mwg-card-repair-form>
          <textarea data-mwg-card-repair-input maxlength="4000" placeholder="描述你希望调整的卡牌、效果或数值"></textarea>
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
        <label class="mwg-difficulty-row"><span class="mwg-setting-copy"><strong>剧情战斗强度</strong><small>相对当前卡组评分；100%为极限发挥，110%允许有限资源损耗</small></span><select class="mwg-difficulty-select" data-mwg-difficulty aria-label="剧情战斗强度"><option value="10">10% 剧情体验</option><option value="50">50% 轻松</option><option value="80">80% 标准</option><option value="100">100% 极限平衡</option><option value="110">110% 高压</option></select></label>
        <label class="mwg-setting-row"><span class="mwg-setting-copy"><strong>程序自动校准</strong><small>生成后只调整敌人数值，不改身份、招式、行动顺序或攻击次数</small></span><input type="checkbox" data-mwg-design-setting="autoCalibration"><span class="mwg-switch" aria-hidden="true"></span></label>
        <label class="mwg-difficulty-row"><span class="mwg-setting-copy"><strong>模拟精度</strong><small>精度越高，随机牌序覆盖越多，后台计算耗时也会增加</small></span><select class="mwg-difficulty-select" data-mwg-design-setting="simulationSeeds" aria-label="模拟精度"><option value="8">快速 · 8组</option><option value="12">均衡 · 12组</option><option value="16">精细 · 16组</option><option value="24">深入 · 24组</option></select></label>
        <label class="mwg-setting-row"><span class="mwg-setting-copy"><strong>显示校准提示</strong><small>只在敌人数值被实际调整时显示提示</small></span><input type="checkbox" data-mwg-design-setting="showNotifications"><span class="mwg-switch" aria-hidden="true"></span></label>
        <label class="mwg-setting-row"><span class="mwg-setting-copy"><strong>调试日志</strong><small>在控制台输出本轮注入的紧凑设计上下文和失败原因</small></span><input type="checkbox" data-mwg-design-setting="debug"><span class="mwg-switch" aria-hidden="true"></span></label>
        <button class="mwg-refresh-design" type="button" data-action="refresh-design">立即重新评估卡组</button>
      </div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="deck">
      <summary>卡组评分总览</summary>
      <div class="mwg-group-body">
        <div class="mwg-deck-overview"><div class="mwg-deck-score-card"><strong data-mwg-deck-score>—</strong><small data-mwg-deck-confidence>等待卡组评分</small></div><div class="mwg-dimension-grid"><span class="mwg-dimension-chip" data-mwg-dimension="burst"></span><span class="mwg-dimension-chip" data-mwg-dimension="sustainedOutput"></span><span class="mwg-dimension-chip" data-mwg-dimension="survival"></span><span class="mwg-dimension-chip" data-mwg-dimension="economy"></span><span class="mwg-dimension-chip" data-mwg-dimension="consistency"></span><span class="mwg-dimension-chip" data-mwg-dimension="scaling"></span><span class="mwg-dimension-chip" data-mwg-dimension="control"></span><span class="mwg-dimension-chip" data-mwg-dimension="combo"></span><span class="mwg-dimension-chip" data-mwg-dimension="flexibility"></span></div></div>
        <strong class="mwg-subsection-title">回合能力曲线</strong><div class="mwg-data-list" data-mwg-horizon-list></div>
      </div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="diagnostics">
      <summary>平衡预算与模拟边界</summary>
      <div class="mwg-group-body"><div class="mwg-design-status-card"><strong>本轮敌人数值预算</strong><small data-mwg-balance-summary>等待敌人数值预算</small></div><strong class="mwg-subsection-title">最近一次敌人复评</strong><div class="mwg-data-list" data-mwg-calibration-list></div><strong class="mwg-subsection-title">尚未完整模拟的机制</strong><div class="mwg-data-list" data-mwg-unsupported-list></div></div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="archetype">
      <summary>流派总览与演变方向</summary>
      <div class="mwg-group-body"><small class="mwg-inline-note" data-mwg-scatter-share></small><strong class="mwg-subsection-title">当前流派倾向</strong><div class="mwg-data-list" data-mwg-archetype-list></div><strong class="mwg-subsection-title">邻接与桥接方向</strong><div class="mwg-data-list" data-mwg-evolution-list></div></div>
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
        <div class="mwg-design-status-card"><strong data-mwg-tower-extension>需要设计辅助器 0.3.0 或更高版本</strong><small data-mwg-tower-requirement>安装完整扩展包后刷新酒馆；剧情模式不受影响。</small></div>
        <button class="mwg-extension-download" type="button" data-action="install-tower-extension">快捷安装爬塔组件</button>
        <a class="mwg-extension-download" href="${towerExtensionReleaseUrl}" target="_blank" rel="noopener noreferrer">安装失败时打开手动下载页面</a>
      </div>
    </details>
    <details class="mwg-settings-group" data-mwg-component="mvu-history">
      <summary>最近一次 MVU 生成全过程</summary>
      <div class="mwg-group-body"><div class="mwg-process-grid"><details class="mwg-process-block" open><summary>阶段时间线</summary><pre data-mwg-mvu-timeline></pre></details><details class="mwg-process-block" open><summary>变量变化摘要</summary><pre data-mwg-mvu-summary></pre></details><details class="mwg-process-block"><summary>最终实际二次请求（注入后） <small data-mwg-mvu-request-meta></small></summary><pre data-mwg-mvu-request></pre></details><details class="mwg-process-block"><summary>模型返回原文</summary><pre data-mwg-mvu-raw></pre></details><details class="mwg-process-block"><summary>服务返回的分析内容</summary><pre data-mwg-mvu-reasoning></pre></details></div></div>
    </details>
  </div>
</section>
<section class="mwg-mvu-panel" aria-label="MVU 二阶段生成状态">
  <header class="mwg-monitor-head"><span class="mwg-monitor-pulse"></span><div class="mwg-monitor-title"><strong data-mwg-monitor-title></strong><small data-mwg-monitor-detail></small></div><span class="mwg-monitor-time" data-mwg-monitor-elapsed></span><button class="mwg-icon-button" type="button" data-action="close-mvu" title="收起变量生成窗" aria-label="收起变量生成窗">×</button></header>
  <div class="mwg-monitor-body"><div class="mwg-monitor-loading" data-mwg-monitor-loading><div><span class="mwg-monitor-spinner" aria-hidden="true"></span><strong data-mwg-monitor-loading-title>正在生成变量</strong><small data-mwg-monitor-loading-detail></small></div></div><div class="mwg-monitor-complete" data-mwg-monitor-complete><div><strong>变量更新已完成</strong><small>可以在下方查看实际请求、变化摘要与模型完整返回。</small></div></div><div class="mwg-monitor-process mwg-process-grid"><details class="mwg-process-block" open><summary>阶段时间线</summary><pre data-mwg-mvu-timeline></pre></details><details class="mwg-process-block" open><summary>变量变化摘要</summary><pre data-mwg-mvu-summary></pre></details><details class="mwg-process-block"><summary>最终实际二次请求（注入后） <small data-mwg-mvu-request-meta></small></summary><pre data-mwg-mvu-request></pre></details><details class="mwg-process-block"><summary>模型返回原文</summary><pre data-mwg-mvu-raw></pre></details><details class="mwg-process-block"><summary>服务返回的分析内容</summary><pre data-mwg-mvu-reasoning></pre></details></div></div>
</section>`;
      doc.body.appendChild(root);
      root.querySelector('[data-action="open-settings"]')?.addEventListener('click', () => {
        if (root?.dataset.dragged === 'true') {
          root.dataset.dragged = 'false';
          return;
        }
        monitorState.settingsVisible = true;
        render();
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
          root?.querySelector<HTMLTextAreaElement>('[data-mwg-card-repair-input]')?.focus();
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
        cardRepairPending = true;
        manualRepairActive = true;
        api.begin({ generationId });
        monitorState.detail = '正在按你的要求增量修复卡牌';
        monitorState.open = true;
        render();
        try {
          await api.requestCardRepair(requirement);
          if (input) input.value = '';
          api.success();
        } catch (repairError) {
          api.fail(repairError, generationId);
        } finally {
          manualRepairActive = false;
          cardRepairPending = false;
          render();
        }
      });
      root.querySelector('[data-action="close-mvu"]')?.addEventListener('click', () => {
        monitorState.open = false;
        render();
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
          await designAssistant?.warmup?.();
          designDashboard = designAssistant?.getDashboard?.() || designDashboard;
          render();
        } catch (error) {
          console.warn('[MagicGirlWorld] 重新评估卡组失败', error);
        }
      });
      const orb = root.querySelector<HTMLElement>('.mwg-tool-orb');
      const applyOrbPosition = (x: number, y: number): void => {
        if (!root || !orb) return;
        const view = doc.defaultView;
        const width = orb.offsetWidth || 50;
        const height = orb.offsetHeight || 50;
        const viewportWidth = view?.innerWidth || doc.documentElement.clientWidth || width + 16;
        const viewportHeight = view?.innerHeight || doc.documentElement.clientHeight || height + 16;
        const nextX = Math.min(Math.max(8, viewportWidth - width - 8), Math.max(8, x));
        const nextY = Math.min(Math.max(8, viewportHeight - height - 8), Math.max(8, y));
        orbPosition = { x: nextX, y: nextY };
        root.style.left = `${nextX}px`;
        root.style.top = `${nextY}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.dataset.anchor = nextX + width / 2 < viewportWidth / 2 ? 'left' : 'right';
        root.dataset.vertical = nextY + height / 2 < viewportHeight / 2 ? 'top' : 'bottom';
      };
      if (orb && orbPosition) applyOrbPosition(orbPosition.x, orbPosition.y);
      if (orb) {
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
      begin(meta: { generationId?: string } = {}) {
        clearApplyTimer();
        const preserveCapturedRequest = monitorState.phase === 'generating'
          && monitorState.requestCapturedAt > 0
          && Date.now() - monitorState.requestCapturedAt < 5_000;
        monitorState.phase = 'generating';
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
        monitorState.detail = '剧情已完成，正在进行第二轮变量整理';
        monitorState.startedAt = Date.now();
        monitorState.finishedAt = 0;
        monitorState.candidateHasUpdateBlock = false;
        monitorState.variableWriteObserved = false;
        monitorState.open = settings.showMvuWindow;
        monitorState.settingsVisible = false;
        pushTimeline('第二轮请求开始', '读取剧情与最新 MVU 变量');
        ensureDom();
        startElapsedTimer();
        render();
      },
      beginStructuredOperation(input: { generationId: string; detail: string }) {
        api.begin({ generationId: input.generationId });
        monitorState.detail = input.detail || '正在生成结构化游戏内容';
        monitorState.open = settings.showMvuWindow;
        pushTimeline('后台结构化请求开始', monitorState.detail);
        render();
      },
      captureMvuRequest(input: { source?: string; payload: unknown }) {
        monitorState.requestContent = serializeCapturedRequest(input.payload);
        monitorState.requestSource = String(input.source || 'MVU 二次请求');
        monitorState.requestCapturedAt = Date.now();
        if (monitorState.phase === 'idle') {
          monitorState.phase = 'generating';
          monitorState.startedAt = monitorState.requestCapturedAt;
          monitorState.finishedAt = 0;
          monitorState.open = settings.showMvuWindow;
          startElapsedTimer();
        }
        pushTimeline('捕获最终二次请求', `${monitorState.requestSource} · 已完成请求策略与设计上下文注入`);
        ensureDom();
        render();
      },
      applyStructuredOperation(input: { generationId: string; detail: string; rawOutput?: string }) {
        if (input.generationId && monitorState.generationId !== input.generationId) return;
        clearApplyTimer();
        monitorState.phase = 'applying';
        monitorState.detail = input.detail || '正在校验并写入当前楼层';
        if (typeof input.rawOutput === 'string') monitorState.rawOutput = input.rawOutput;
        pushTimeline('结构化结果已返回', monitorState.detail);
        render();
      },
      completeStructuredOperation(input: { generationId: string; summary: string; rawOutput?: string }) {
        if (input.generationId && monitorState.generationId !== input.generationId) return;
        clearApplyTimer();
        monitorState.phase = 'success';
        monitorState.output = input.summary || '当前楼层内容已更新';
        if (typeof input.rawOutput === 'string') monitorState.rawOutput = input.rawOutput;
        monitorState.pendingOutput = '';
        monitorState.detail = '后台内容已校验并写入当前楼层';
        monitorState.variableWriteObserved = true;
        pushTimeline('后台内容应用完成', monitorState.output);
        finishElapsedTimer();
        render();
      },
      stream(text: unknown, generationId?: string) {
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
          monitorState.open = settings.showMvuWindow;
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
          monitorState.open = settings.showMvuWindow;
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
      success() {
        if (monitorState.phase === 'idle') return;
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
        if (generationId && monitorState.generationId && generationId !== monitorState.generationId) return;
        clearApplyTimer();
        monitorState.phase = 'error';
        monitorState.detail = error instanceof Error ? error.message : String(error || '额外模型请求失败');
        pushTimeline('生成或解析失败', monitorState.detail);
        monitorState.open = settings.showMvuWindow;
        finishElapsedTimer();
        ensureDom();
        render();
      },
      getSettings: () => ({ ...settings }),
      getSnapshot: () => ({ ...monitorState }),
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
      },
      receiveTowerGenerationCompleted(value: unknown) {
        publishTowerGenerationEvent({ type: 'completed', payload: value });
      },
      receiveTowerGenerationFailed(value: unknown) {
        publishTowerGenerationEvent({ type: 'failed', payload: value });
      },
      openSettings() {
        monitorState.settingsVisible = true;
        ensureDom();
        render();
      },
      destroy() {
        stopElapsedTimer();
        if (lifecycleTimer !== undefined) host.clearInterval?.(lifecycleTimer);
        if (streamRenderTimer !== undefined) host.clearTimeout?.(streamRenderTimer);
        clearApplyTimer();
        if (registryHost.MagicGirlWorldMvuMonitor === api) delete registryHost.MagicGirlWorldMvuMonitor;
        if (host.MagicGirlWorldMvuMonitor === api) delete host.MagicGirlWorldMvuMonitor;
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
    const key = String(messageId);
    const previous = messageVariableUpdateQueues.get(key) || Promise.resolve();
    let operation!: Promise<Record<string, any>>;
    operation = previous
      .catch(() => undefined)
      .then(async () => {
        const mvu = getMvuApi();
        if (!mvu || typeof mvu.replaceMvuData !== 'function') throw new Error('MVU replaceMvuData 接口不可用');

        let base = readMvuMessageVariables(messageId);
        let next = await updater(cloneSettlementValue(base));
        if (!isSettlementRecord(next) || !isSettlementRecord(next.stat_data)) {
          throw new Error('消息变量更新器返回了无效根结构');
        }

        // A model-backed node may finish while an asynchronous UI transaction
        // is preparing its result. Rebase the updater once onto the newer run
        // revision instead of allowing the older snapshot to win.
        const latest = readMvuMessageVariables(messageId);
        const baseRevision = runRevision(base);
        const latestRevision = runRevision(latest);
        if (baseRevision !== null && latestRevision !== null && latestRevision > baseRevision) {
          base = latest;
          next = await updater(cloneSettlementValue(base));
          if (!isSettlementRecord(next) || !isSettlementRecord(next.stat_data)) {
            throw new Error('消息变量更新器在重放后返回了无效根结构');
          }
        }

        const nextRevision = runRevision(next);
        const authoritativeRevision = runRevision(base);
        if (
          nextRevision !== null
          && authoritativeRevision !== null
          && nextRevision < authoritativeRevision
        ) {
          throw new Error(`拒绝写入旧爬塔状态：${nextRevision} < ${authoritativeRevision}`);
        }

        await mvu.replaceMvuData(cloneSettlementValue(next), {
          type: 'message',
          message_id: messageId,
        });
        return cloneSettlementValue(next);
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

  const isCardDefinition = (value: Record<string, any>): boolean =>
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    ['Attack', 'Skill', 'Power', 'Status', 'Curse'].includes(String(value.type)) &&
    typeof value.rarity === 'string' &&
    (typeof value.cost === 'number' || value.cost === 'energy') &&
    Number.isFinite(Number(value.quantity)) &&
    Number(value.quantity) > 0 &&
    !!value.effects;

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
    battle.player_abilities = abilitySource.filter(entry => !misplaced.includes(entry));
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
      typeof core.emoji === 'string' &&
      !!core.emoji.trim() &&
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
    return (
      quantity >= 10 &&
      objectEntries(battle.artifacts).length > 0 &&
      objectEntries(battle.items).length > 0 &&
      !!battle.player_lust_effect &&
      typeof battle.player_lust_effect === 'object' &&
      validCore &&
      Number.isInteger(Number(battle.level)) &&
      Number(battle.level) >= 1
    );
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
