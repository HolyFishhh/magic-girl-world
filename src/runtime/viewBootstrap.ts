type RuntimeViewName = 'start' | 'common' | 'fish' | 'update';

type RuntimeViewAsset = Readonly<{
  title: string;
  bodyHtml: string;
  styles: string;
  script: string;
}>;

type SharedRuntime = Readonly<{
  spec: 'mwg.tavern-runtime/v1';
  version: string;
  getViewAsset(view: RuntimeViewName): RuntimeViewAsset;
  getMessageText?: (messageId?: number | 'latest') => string;
  getMessageVariables?: (messageId?: number | 'latest') => Record<string, any>;
  waitForMessageReady?: (messageId?: number | 'latest', options?: { requireBattleData?: boolean }) => Promise<void>;
}>;

const RUNTIME_MOUNT_EPOCH_KEY = '__MWG_RUNTIME_MOUNT_EPOCH__';

function claimRuntimeMountEpoch(): number {
  const host = globalThis as typeof globalThis & Record<string, unknown>;
  const previous = Number(host[RUNTIME_MOUNT_EPOCH_KEY]);
  const next = Number.isFinite(previous) && previous >= 0 ? previous + 1 : 1;
  host[RUNTIME_MOUNT_EPOCH_KEY] = next;
  return next;
}

function isRuntimeMountEpochCurrent(epoch: number): boolean {
  const host = globalThis as typeof globalThis & Record<string, unknown>;
  return Number(host[RUNTIME_MOUNT_EPOCH_KEY]) === epoch;
}

declare const __MWG_VIEW_NAME__: RuntimeViewName;
declare const __MWG_CARD_VERSION__: string;
declare function waitGlobalInitialized<T>(global: string): Promise<T>;

function isolatedRuntimeScript(source: string): string {
  // Keep the first mounted bundle out of the iframe's global lexical scope so
  // a later in-place common/fish switch cannot collide with minified names.
  return `(() => {\n${source}\n})();`;
}

(() => {
  const view = __MWG_VIEW_NAME__;
  const expectedVersion = __MWG_CARD_VERSION__;
  const timeoutMs = 15000;
  const mountEpoch = claimRuntimeMountEpoch();

  const currentMessageId = (): number | null => {
    const helper = globalThis as typeof globalThis & { getCurrentMessageId?: () => unknown };
    if (typeof helper.getCurrentMessageId !== 'function') return null;
    try {
      const messageId = Number(helper.getCurrentMessageId());
      return Number.isInteger(messageId) ? messageId : null;
    } catch {
      return null;
    }
  };

  const lastMessageId = (): number | null => {
    const helper = globalThis as typeof globalThis & { getLastMessageId?: () => unknown };
    if (typeof helper.getLastMessageId !== 'function') return null;
    try {
      const messageId = Number(helper.getLastMessageId());
      return Number.isInteger(messageId) ? messageId : null;
    } catch {
      return null;
    }
  };

  // The creator is a one-time first-floor handoff. Keeping this gate in the
  // shell means a repeated marker in later AI text cannot recreate the form.
  const isViewAllowedOnThisFloor = (): boolean => {
    const messageId = currentMessageId();
    if (view === 'start') return messageId === null || messageId === 0;
    const latestMessageId = lastMessageId();
    if (messageId === null || latestMessageId === null) return true;
    if (view === 'fish') return messageId === latestMessageId;
    return [0, 1, 2].indexOf(latestMessageId - messageId) !== -1;
  };

  if (!isViewAllowedOnThisFloor()) {
    document.body.replaceChildren();
    document.body.dataset.mwgSkipped = view === 'start' ? 'initial-only' : view === 'fish' ? 'latest-only' : 'recent-only';
    return;
  }

  const messageScope = currentMessageId() ?? 'latest';
  const fail = (error: unknown) => {
    if (!isRuntimeMountEpochCurrent(mountEpoch)) return;
    const message = error instanceof Error ? error.message : String(error);
    document.body.replaceChildren();
    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.style.cssText =
      'padding:10px;border:1px solid #b42318;border-radius:6px;background:#fff5f5;color:#b42318;font:13px/1.5 sans-serif;';
    alert.textContent = `魔法少女世界界面加载失败：${message}`;
    document.body.appendChild(alert);
  };

  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error('等待角色运行时超时，请确认角色脚本已启用')), timeoutMs);
  });

  const sharedRuntime =
    typeof waitGlobalInitialized === 'function'
      ? waitGlobalInitialized<SharedRuntime>('MagicGirlWorld')
      : Promise.reject(new Error('酒馆助手分享接口 waitGlobalInitialized 不可用'));

  Promise.race([Promise.resolve(sharedRuntime), timeout])
    .then(runtime => {
      if (!isRuntimeMountEpochCurrent(mountEpoch)) return;
      const api = runtime || (globalThis as any).MagicGirlWorld;
      if (!api || api.spec !== 'mwg.tavern-runtime/v1') throw new Error('角色运行时接口无效');
      if (api.version !== expectedVersion) {
        throw new Error(`角色运行时版本不匹配（需要 ${expectedVersion}，实际 ${String(api.version)}）`);
      }
      (globalThis as any).MagicGirlWorld = api;

      // Do not choose the creator from an MVU cache that is still initializing.
      // Failure stays visible instead of silently replacing a saved game.
      if ((view === 'start' || view === 'fish') && api.waitForMessageReady) {
        return api.waitForMessageReady(messageScope, { requireBattleData: false }).then(() => api);
      }
      return api;
    })
    .then(api => {
      if (!api || !isRuntimeMountEpochCurrent(mountEpoch)) return;
      let resolvedView = view;
      if (view === 'start') {
        const message = String((api.getMessageText && api.getMessageText(messageScope)) || '');
        // The tower alternate greeting owns one persistent common/tower
        // surface. Its setup form, generated gift, map and later nodes all
        // evolve inside that view instead of mounting the story creator and
        // then replacing it with a second UI.
        if (message.includes('[爬塔模式开场]')) {
          resolvedView = 'common';
        } else if (typeof api.getMessageVariables === 'function') {
          // A refreshed or switched chat can render a later story floor
          // before its original greeting marker is available.  The saved
          // mode lock is authoritative in that case; falling back to the
          // landing page loses the current story UI for one render cycle.
          const variables = api.getMessageVariables(messageScope);
          const stat = variables && variables.stat_data;
          // initvar defaults to story even before the creator is submitted.
          // Only a saved program lock proves that setup was completed.
          const lock = stat && stat.game_mode_lock;
          const mode = lock && lock.schemaVersion === 1 ? lock.mode : null;
          if (mode === 'story' || mode === 'tower') resolvedView = 'common';
        }
      }
      if (view === 'fish' && typeof api.getMessageVariables === 'function') {
        try {
          const variables = api.getMessageVariables(messageScope);
          const stat = variables && variables.stat_data;
          const run = stat && stat.run;
          const node = run && run.currentNode;
          const towerLocked =
            !!stat &&
            (stat.game_mode === 'tower' ||
              (stat.game_mode_lock && stat.game_mode_lock.mode === 'tower'));
          const activeTowerBattle =
            !!run &&
            run.phase === 'in_node' &&
            !!node &&
            ['battle', 'elite', 'boss'].indexOf(node.kind) !== -1;
          // The latest message keeps its original BATTLE_START marker after a
          // same-floor tower fight. On refresh the authoritative run, not that
          // stale marker, decides whether to restore combat or the route map.
          if (towerLocked && run && !activeTowerBattle) resolvedView = 'common';
        } catch {
          // MVU readiness below still owns user-facing failures. Falling back
          // to the marker-selected view preserves story-mode compatibility.
        }
      }
      if (!isRuntimeMountEpochCurrent(mountEpoch)) return;
      if (document.documentElement.dataset.mwgMountedView === resolvedView) return;
      document.documentElement.dataset.mwgMountedView = resolvedView;

      const asset = api.getViewAsset(resolvedView);
      if (!asset || !asset.bodyHtml || !asset.styles || !asset.script)
        throw new Error(`视图资源不完整: ${resolvedView}`);

      document.title = asset.title;
      const style = document.createElement('style');
      style.dataset.mwgRuntimeStyle = resolvedView;
      style.textContent = asset.styles;
      document.head.appendChild(style);

      document.body.innerHTML = asset.bodyHtml;

      document.documentElement.dataset.mwgRuntime = expectedVersion;
      document.documentElement.dataset.mwgView = resolvedView;
      const script = document.createElement('script');
      script.dataset.mwgRuntimeScript = resolvedView;
      script.textContent = isolatedRuntimeScript(asset.script);
      document.body.appendChild(script);
    })
    .catch(fail);
})();
