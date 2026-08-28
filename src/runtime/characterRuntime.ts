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

  type MvuMonitorSettings = {
    showMvuWindow: boolean;
  };

  const installMvuMonitor = () => {
    const storageKey = 'mwg:settings-center:v2';
    const defaultSettings: MvuMonitorSettings = {
      showMvuWindow: true,
    };
    let settings = { ...defaultSettings };
    let orbPosition: { x: number; y: number } | null = null;
    try {
      const stored = JSON.parse(String(host.localStorage?.getItem(storageKey) || '{}'));
      settings = { ...settings, ...(stored && typeof stored === 'object' ? stored : {}) };
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
      pendingOutput: '',
      reasoning: '',
      detail: '等待下一次变量更新',
      startedAt: 0,
      finishedAt: 0,
      open: false,
      settingsVisible: false,
    };
    let root: HTMLElement | null = null;
    let timer: number | undefined;
    let lifecycleTimer: number | undefined;
    let applyTimer: number | undefined;
    let extraAnalysisActive = false;

    const clearApplyTimer = (): void => {
      if (applyTimer !== undefined) host.clearTimeout?.(applyTimer);
      applyTimer = undefined;
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
      extra.关闭thinking = true;
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

    const render = (): void => {
      if (!root) return;
      root.dataset.phase = monitorState.phase;
      root.dataset.mvuOpen = monitorState.open ? 'true' : 'false';
      root.dataset.settingsOpen = monitorState.settingsVisible ? 'true' : 'false';
      root.dataset.busy = ['generating', 'applying'].includes(monitorState.phase) ? 'true' : 'false';
      root.style.display = '';
      const title = root.querySelector<HTMLElement>('[data-mwg-monitor-title]');
      const detail = root.querySelector<HTMLElement>('[data-mwg-monitor-detail]');
      const elapsed = root.querySelector<HTMLElement>('[data-mwg-monitor-elapsed]');
      const loading = root.querySelector<HTMLElement>('[data-mwg-monitor-loading]');
      const loadingTitle = root.querySelector<HTMLElement>('[data-mwg-monitor-loading-title]');
      const loadingDetail = root.querySelector<HTMLElement>('[data-mwg-monitor-loading-detail]');
      const completeState = root.querySelector<HTMLElement>('[data-mwg-monitor-complete]');
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
            : '剧情正文已经完成，额外模型正在整理变量。非流式请求期间不会逐字显示。';
      }
      if (completeState) completeState.style.display = monitorState.phase === 'success' ? 'grid' : 'none';
      root.querySelectorAll<HTMLInputElement>('[data-mwg-monitor-setting]').forEach(input => {
        const key = input.dataset.mwgMonitorSetting as keyof MvuMonitorSettings;
        input.checked = !!settings[key];
      });
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
#mwg-mvu-monitor .mwg-settings-sheet{position:absolute;top:60px;right:0;display:none;width:min(390px,calc(100vw - 24px));overflow:hidden;pointer-events:auto;border:1px solid #e2c8bd;border-radius:18px;background:#fffaf7;box-shadow:0 18px 50px #38252f45}
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
#mwg-mvu-monitor .mwg-settings-body{display:block!important;width:100%!important;padding:12px;background-image:repeating-linear-gradient(to bottom,transparent 0 31px,#7ea4be10 32px)}
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
@keyframes mwgMonitorPulse{70%{box-shadow:0 0 0 9px #a64c7200}100%{box-shadow:0 0 0 0 #a64c7200}}
@keyframes mwgMonitorSpin{to{transform:rotate(360deg)}}
@media(max-width:520px){#mwg-mvu-monitor{right:9px}#mwg-mvu-monitor .mwg-tool-orb{width:46px!important;height:46px!important;min-width:46px!important;min-height:46px!important}#mwg-mvu-monitor .mwg-settings-sheet{top:55px;width:calc(100vw - 18px)}#mwg-mvu-monitor .mwg-mvu-panel{top:max(8px,env(safe-area-inset-top));width:calc(100vw - 12px);max-height:84vh}#mwg-mvu-monitor .mwg-monitor-head{padding:11px}#mwg-mvu-monitor .mwg-monitor-body{max-height:calc(84vh - 58px)}}
`;
        doc.head?.appendChild(style);
      }
      root = doc.createElement('aside');
      root.id = 'mwg-mvu-monitor';
      root.setAttribute('aria-live', 'polite');
      root.innerHTML = `
<button class="mwg-tool-orb" type="button" data-action="open-settings" title="打开魔法少女世界设置" aria-label="打开魔法少女世界设置"><span aria-hidden="true">✦</span></button>
<section class="mwg-settings-sheet" aria-label="魔法少女世界设置">
  <header class="mwg-sheet-head"><div class="mwg-sheet-title"><strong>魔法少女世界设置</strong><small>界面偏好只保存在当前浏览器</small></div><button class="mwg-icon-button" type="button" data-action="close-settings" title="关闭设置" aria-label="关闭设置">×</button></header>
  <div class="mwg-settings-body">
    <label class="mwg-setting-row"><span class="mwg-setting-copy"><strong>自动显示变量生成窗</strong><small>剧情完成后自动显示独立的 MVU 二阶段状态</small></span><input type="checkbox" data-mwg-monitor-setting="showMvuWindow"><span class="mwg-switch" aria-hidden="true"></span></label>
  </div>
</section>
<section class="mwg-mvu-panel" aria-label="MVU 二阶段生成状态">
  <header class="mwg-monitor-head"><span class="mwg-monitor-pulse"></span><div class="mwg-monitor-title"><strong data-mwg-monitor-title></strong><small data-mwg-monitor-detail></small></div><span class="mwg-monitor-time" data-mwg-monitor-elapsed></span><button class="mwg-icon-button" type="button" data-action="close-mvu" title="收起变量生成窗" aria-label="收起变量生成窗">×</button></header>
  <div class="mwg-monitor-body"><div class="mwg-monitor-loading" data-mwg-monitor-loading><div><span class="mwg-monitor-spinner" aria-hidden="true"></span><strong data-mwg-monitor-loading-title>正在生成变量</strong><small data-mwg-monitor-loading-detail></small></div></div><div class="mwg-monitor-complete" data-mwg-monitor-complete><div><strong>变量更新已完成</strong><small>完整更新内容已显示在本条消息下方。</small></div></div></div>
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
        render();
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
        monitorState.phase = 'generating';
        monitorState.generationId = String(meta.generationId || '');
        monitorState.output = '';
        monitorState.pendingOutput = '';
        monitorState.reasoning = '';
        monitorState.detail = '剧情已完成，正在进行第二轮变量整理';
        monitorState.startedAt = Date.now();
        monitorState.finishedAt = 0;
        monitorState.open = settings.showMvuWindow;
        monitorState.settingsVisible = false;
        ensureDom();
        startElapsedTimer();
        render();
      },
      stream(text: unknown, generationId?: string) {
        if (generationId && monitorState.generationId && generationId !== monitorState.generationId) return;
        monitorState.pendingOutput = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
      },
      reasoning(text: unknown) {
        if (monitorState.phase === 'idle') return;
        monitorState.reasoning = typeof text === 'string' ? text : '';
        render();
      },
      complete(result: unknown, generationId?: string) {
        if (generationId && monitorState.generationId && generationId !== monitorState.generationId) return;
        if (monitorState.phase === 'idle') return;
        monitorState.output = summarizeMvuUpdate(extractUpdateOutput(result)).join('\n');
        monitorState.pendingOutput = '';
        if (!monitorState.reasoning) monitorState.reasoning = extractReturnedReasoning(result);
        // COMMAND_PARSED may arrive after VARIABLE_UPDATE_ENDED in some MVU builds.
        // Preserve the completed state while still capturing the final source text.
        if (monitorState.phase === 'success') {
          render();
          return;
        }
        monitorState.phase = 'applying';
        monitorState.detail = '模型已返回，正在校验并写入当前楼层';
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
        clearApplyTimer();
        monitorState.phase = 'success';
        monitorState.detail = '第二轮变量已写入，可继续游玩';
        finishElapsedTimer();
        render();
      },
      fail(error: unknown, generationId?: string) {
        if (generationId && monitorState.generationId && generationId !== monitorState.generationId) return;
        clearApplyTimer();
        monitorState.phase = 'error';
        monitorState.detail = error instanceof Error ? error.message : String(error || '额外模型请求失败');
        monitorState.open = settings.showMvuWindow;
        finishElapsedTimer();
        ensureDom();
        render();
      },
      getSettings: () => ({ ...settings }),
      getSnapshot: () => ({ ...monitorState }),
      openSettings() {
        monitorState.settingsVisible = true;
        ensureDom();
        render();
      },
      destroy() {
        stopElapsedTimer();
        if (lifecycleTimer !== undefined) host.clearInterval?.(lifecycleTimer);
        clearApplyTimer();
        root?.remove();
        root = null;
      },
    };

    host.MagicGirlWorldMvuMonitor = api;
    syncThinkingSetting();
    ensureDom();
    listen('js_stream_token_received_fully', (text: string, generationId: string) => api.stream(text, generationId));
    listen('stream_reasoning_done', (reasoning: string) => api.reasoning(reasoning));
    const syncExtraAnalysis = (): void => {
      try {
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
  });

  const destroyRuntime = (): void => {
    if (destroyed) return;
    destroyed = true;
    state.status = 'closed';
    removeEventBindings();
    mvuMonitor.destroy();
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
