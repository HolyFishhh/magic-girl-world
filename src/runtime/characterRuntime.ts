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

  const arrayMarker = '$__META_EXTENSIBLE__$';
  const objectEntries = (value: unknown): Record<string, any>[] =>
    Array.isArray(value)
      ? value.filter(
          (entry): entry is Record<string, any> =>
            !!entry && entry !== arrayMarker && typeof entry === 'object' && !Array.isArray(entry),
        )
      : [];

  const isCardDefinition = (value: Record<string, any>): boolean =>
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    ['Attack', 'Skill', 'Power', 'Status', 'Curse'].includes(String(value.type)) &&
    typeof value.rarity === 'string' &&
    (typeof value.cost === 'number' || value.cost === 'energy') &&
    Number.isFinite(Number(value.quantity)) &&
    Number(value.quantity) > 0 &&
    !!value.effects;

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
    while (!hasMvuApi() && Date.now() < deadline) await wait(100);
    const beforeMessageUpdate = host.Mvu?.events?.BEFORE_MESSAGE_UPDATE;
    const variableUpdateEnded = host.Mvu?.events?.VARIABLE_UPDATE_ENDED;
    if (!beforeMessageUpdate || typeof eventOn !== 'function') return;

    if (variableUpdateEnded) {
      eventOn(variableUpdateEnded, (variables: Record<string, any>) => {
        recoverMisplacedCards(variables);
      });
    }

    eventOn(beforeMessageUpdate, (context: { variables?: Record<string, any>; message_content?: string }) => {
      let message = String(context?.message_content || '');
      const hasPending = message.includes('<BATTLE_PENDING>');
      const hasDirectStart = message.includes('<BATTLE_START>');
      if (!hasPending && !hasDirectStart) return;

      // BATTLE_START belongs to this runtime, never to either AI stage.
      if (hasDirectStart) {
        message = message.replace(/\s*<BATTLE_START>\s*/g, '\n').trimEnd();
        context.message_content = message;
        if (!hasPending) {
          console.error('[MagicGirlWorld] AI 越权输出 BATTLE_START，已移除直接启动标记');
          return;
        }
      }

      recoverMisplacedCards(context?.variables);
      const isCharacterInitialization = message.includes('<CHARACTER_INIT_PENDING>');
      if (!hasInitializedPlayerContent(context?.variables, isCharacterInitialization)) {
        console.error('[MagicGirlWorld] 玩家初始战斗内容未完成，已阻止战斗页面提前启动');
        return;
      }

      const enemy = context?.variables?.stat_data?.battle?.enemy;
      const actions = Array.isArray(enemy?.actions) ? enemy.actions.filter(Boolean) : [];
      if (!enemy || typeof enemy.name !== 'string' || !enemy.name.trim() || actions.length === 0) {
        console.error('[MagicGirlWorld] 敌人数据未注册完成，已阻止战斗页面提前启动');
        return;
      }

      context.message_content =
        message
          .replace(/\s*<CHARACTER_INIT_PENDING>\s*/g, '\n')
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
