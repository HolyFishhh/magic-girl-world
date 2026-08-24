type RuntimeViewName = 'start' | 'common' | 'fish';

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

(() => {
  const stateKey = '__MAGIC_GIRL_WORLD_CHARACTER_RUNTIME__';
  const host = globalThis as typeof globalThis & Record<string, any>;
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

  const wait = (milliseconds: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, milliseconds));

  const hasMvuApi = (): boolean => {
    const mvu = host.Mvu;
    return !!mvu && typeof mvu.getMvuData === 'function' && typeof mvu.replaceMvuData === 'function';
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
    while (!hasMvuApi() && Date.now() < deadline) await wait(100);
    const beforeMessageUpdate = host.Mvu?.events?.BEFORE_MESSAGE_UPDATE;
    if (!beforeMessageUpdate || typeof eventOn !== 'function') return;

    eventOn(beforeMessageUpdate, (context: { variables?: Record<string, any>; message_content?: string }) => {
      const message = String(context?.message_content || '');
      if (!message.includes('<BATTLE_PENDING>') || message.includes('<BATTLE_START>')) return;

      const enemy = context?.variables?.stat_data?.battle?.enemy;
      const actions = Array.isArray(enemy?.actions) ? enemy.actions.filter(Boolean) : [];
      if (!enemy || typeof enemy.name !== 'string' || !enemy.name.trim() || actions.length === 0) {
        console.error('[MagicGirlWorld] 敌人数据未注册完成，已阻止战斗页面提前启动');
        return;
      }

      context.message_content =
        message.replace(/\s*<BATTLE_PENDING>\s*/g, '\n').trimEnd() + '\n\n<BATTLE_START>';
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

  host[stateKey] = { api, state };

  const publish = () => {
    try {
      if (typeof initializeGlobal !== 'function') throw new Error('酒馆助手分享接口 initializeGlobal 不可用');
      initializeGlobal('MagicGirlWorld', api);
      state.status = 'ready';
      state.publishedAt = Date.now();
      state.lastError = '';
      console.info(`[MagicGirlWorld] 角色运行时 ${build.cardVersion} 已就绪`);
      void installBattleHandoff();
    } catch (error) {
      state.status = 'error';
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error('[MagicGirlWorld] 角色运行时发布失败', error);
    }
  };

  if (typeof $ === 'function') {
    $(() => publish());
    $(window).on('pagehide', () => {
      state.status = 'closed';
    });
  } else {
    publish();
  }
})();
