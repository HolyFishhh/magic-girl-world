import { DesignAssistantEngine, enemyGenerationFingerprintFromVariables, normalizeDesignAssistantChatState, normalizeDesignAssistantSettings } from './designEngine';
import { isMagicGirlWorldCharacter } from './characterScope';
import { hasDesignContext, injectDesignContext } from './promptInjection';
import { DesignWorkerClient } from './workerClient';
import {
  DEFAULT_DESIGN_ASSISTANT_SETTINGS,
  DESIGN_ASSISTANT_EXTENSION_ID,
  DESIGN_ASSISTANT_METADATA_KEY,
  type DesignAssistantChatState,
  type DesignAssistantDashboard,
  type DesignAssistantHost,
  type DesignAssistantSettings,
  type DesignAssistantStatus,
  type MvuDesignSnapshot,
  type SillyTavernContext,
} from './types';

const EVENT_GENERATE_AFTER_DATA = 'generate_after_data';
const EVENT_CHAT_COMPLETION_SETTINGS_READY = 'chat_completion_settings_ready';
const EVENT_CHAT_CHANGED = 'chat_id_changed';
const EVENT_MVU_INITIALIZED = 'global_Mvu_initialized';
const EVENT_MVU_UPDATE_ENDED = 'mag_variable_update_ended';

interface ChatScopeToken {
  chatId: string | null | undefined;
  metadata: Record<string, any> | null;
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function applyCalibratedEnemy(target: unknown, source: unknown): void {
  if (!isRecord(target) || !isRecord(source)) return;
  const targetBattle = target.stat_data?.battle;
  const sourceBattle = source.stat_data?.battle;
  if (!isRecord(targetBattle) || !isRecord(sourceBattle)) return;
  targetBattle.enemy = clone(sourceBattle.enemy);
  targetBattle.enemies = clone(sourceBattle.enemies);
}

function settingRoot(context: SillyTavernContext): Record<string, any> {
  const existing = context.extensionSettings[DESIGN_ASSISTANT_EXTENSION_ID];
  const normalized = normalizeDesignAssistantSettings(existing);
  context.extensionSettings[DESIGN_ASSISTANT_EXTENSION_ID] = normalized;
  return normalized;
}

export class DesignAssistantController {
  private readonly engine: DesignAssistantEngine;
  private active = false;
  private warming: Promise<MvuDesignSnapshot | null> | null = null;
  private warmupScheduled = false;
  private warmupRerunRequested = false;
  private latestSnapshot: MvuDesignSnapshot | null = null;
  private status: DesignAssistantStatus = { phase: 'idle', message: '等待 MVU 数据', updatedAt: 0 };
  private readonly workerClient: DesignWorkerClient;

  constructor(private readonly host: DesignAssistantHost, engine = new DesignAssistantEngine()) {
    this.engine = engine;
    this.workerClient = new DesignWorkerClient(engine);
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    const context = this.host.context();
    if (!context) {
      this.setStatus('error', 'SillyTavern 扩展上下文不可用');
      return;
    }
    settingRoot(context);
    context.eventSource.on(context.eventTypes.GENERATE_AFTER_DATA || EVENT_GENERATE_AFTER_DATA, this.onGenerateAfterData);
    context.eventSource.on(
      context.eventTypes.CHAT_COMPLETION_SETTINGS_READY || EVENT_CHAT_COMPLETION_SETTINGS_READY,
      this.onGenerateAfterData,
    );
    context.eventSource.on(context.eventTypes.CHAT_CHANGED || EVENT_CHAT_CHANGED, this.onChatChanged);
    context.eventSource.on(EVENT_MVU_INITIALIZED, this.onMvuInitialized);
    context.eventSource.on(EVENT_MVU_UPDATE_ENDED, this.onMvuUpdateEnded);
    this.publishDashboard();
    void this.engine.initializeKnowledgeGraph().catch(error => {
      this.fail('流派知识图谱持久化失败，已继续使用内存图谱', error, false);
    });
    this.scheduleWarmup();
  }

  deactivate(): void {
    if (!this.active) return;
    const context = this.host.context();
    const remove = context?.eventSource.removeListener?.bind(context.eventSource);
    if (remove && context) {
      remove(context.eventTypes.GENERATE_AFTER_DATA || EVENT_GENERATE_AFTER_DATA, this.onGenerateAfterData);
      remove(
        context.eventTypes.CHAT_COMPLETION_SETTINGS_READY || EVENT_CHAT_COMPLETION_SETTINGS_READY,
        this.onGenerateAfterData,
      );
      remove(context.eventTypes.CHAT_CHANGED || EVENT_CHAT_CHANGED, this.onChatChanged);
      remove(EVENT_MVU_INITIALIZED, this.onMvuInitialized);
      remove(EVENT_MVU_UPDATE_ENDED, this.onMvuUpdateEnded);
    }
    const monitor = (globalThis as any).MagicGirlWorldMvuMonitor;
    monitor?.setDesignAssistant?.(null);
    this.active = false;
    this.warmupScheduled = false;
    this.warmupRerunRequested = false;
    this.latestSnapshot = null;
    this.workerClient.dispose();
  }

  getSettings(): DesignAssistantSettings {
    const context = this.host.context();
    return context ? normalizeDesignAssistantSettings(settingRoot(context)) : clone(DEFAULT_DESIGN_ASSISTANT_SETTINGS);
  }

  getState(): DesignAssistantChatState {
    const context = this.host.context();
    return normalizeDesignAssistantChatState(context?.chatMetadata?.[DESIGN_ASSISTANT_METADATA_KEY]);
  }

  getStatus(): DesignAssistantStatus {
    return clone(this.status);
  }

  getDashboard(): DesignAssistantDashboard {
    const available = isMagicGirlWorldCharacter(this.host.context());
    return {
      spec: 'mwg.design-assistant-dashboard/v1',
      available,
      settings: this.getSettings(),
      status: this.getStatus(),
      threaded: this.workerClient.threaded,
      graph: this.getKnowledgeGraphStats(),
      state: this.getState(),
      snapshot: available ? clone(this.latestSnapshot) : null,
    };
  }

  updateSettings(patch: Partial<DesignAssistantSettings>): DesignAssistantSettings {
    const next = normalizeDesignAssistantSettings({ ...this.getSettings(), ...clone(patch) });
    this.saveSettings(next);
    return clone(next);
  }

  queryKnowledgeGraph(ids: string[] = [], depth = 1) {
    return this.engine.queryKnowledgeGraph(ids, this.getState().lineage, depth);
  }

  getKnowledgeGraphStats() {
    return this.engine.knowledgeGraphStats(this.getState().lineage);
  }

  async warmup(): Promise<MvuDesignSnapshot | null> {
    if (!this.active) return null;
    if (this.warming) return this.warming;
    this.warming = this.runWarmup().finally(() => {
      this.warming = null;
      if (this.active && this.warmupRerunRequested) {
        this.warmupRerunRequested = false;
        this.scheduleWarmup();
      }
    });
    return this.warming;
  }

  private captureChatScope(): ChatScopeToken {
    const context = this.host.context();
    return { chatId: context?.chatId, metadata: context?.chatMetadata || null };
  }

  private isCurrentChatScope(scope: ChatScopeToken): boolean {
    const context = this.host.context();
    return Boolean(context)
      && context!.chatId === scope.chatId
      && context!.chatMetadata === scope.metadata;
  }

  private readonly onGenerateAfterData = async (payload: unknown): Promise<void> => {
    if (!isMagicGirlWorldCharacter(this.host.context())) return;
    const settings = this.getSettings();
    const mvu = this.host.mvu();
    if (!settings.enabled || !mvu?.isDuringExtraAnalysis?.() || hasDesignContext(payload)) return;
    // SillyTavern and Tavern Helper can expose both the modern request event and
    // the chat-completion compatibility event for the same payload. Treat an
    // existing marker as an idempotent success instead of reporting a false
    // injection error or repeating the deck simulation.
    if (hasDesignContext(payload)) {
      this.debug('design context already present; skipped duplicate request event');
      return;
    }
    this.setStatus('injecting', '正在读取最新变量并生成设计上下文…');
    try {
      const chatScope = this.captureChatScope();
      const variables = mvu.getMvuData({ type: 'message', message_id: 'latest' });
      const state = this.getState();
      const snapshot = await this.workerClient.createSnapshot(variables, state, settings);
      if (!this.isCurrentChatScope(chatScope)) {
        this.debug('chat changed while preparing design context; discarded stale snapshot');
        return;
      }
      if (!snapshot) {
        this.setStatus('idle', '当前没有可评分的玩家卡组');
        return;
      }
      if (!injectDesignContext(payload, snapshot.prompt)) {
        // Another awaited listener may have inserted the same marker between
        // the preflight check and this mutation attempt.
        if (hasDesignContext(payload)) {
          this.setStatus(
            'ready',
            `已注入：卡组 ${snapshot.deckProfile.totalScore} 分，目标 ${snapshot.enemyEnvelope.targetScore} 分`,
            snapshot,
          );
          return;
        }
        this.setStatus('error', 'Tavern Helper 请求结构无法注入，已保持原请求');
        return;
      }
      this.latestSnapshot = snapshot;
      state.lineage = snapshot.lineage;
      state.lastDeckFingerprint = snapshot.deckFingerprint;
      state.lastEnemyFingerprint = snapshot.enemyFingerprint || undefined;
      state.lastInjectionAt = this.host.now();
      this.persistState(state);
      this.setStatus(
        'ready',
        `已注入：卡组 ${snapshot.deckProfile.totalScore} 分，目标 ${snapshot.enemyEnvelope.targetScore} 分`,
        snapshot,
      );
      this.debug('injected design context', snapshot.prompt);
    } catch (error) {
      this.fail('第二轮设计上下文生成失败', error);
    }
  };

  private readonly onMvuUpdateEnded = async (variables: unknown, before: unknown): Promise<void> => {
    if (!isMagicGirlWorldCharacter(this.host.context())) return;
    const settings = this.getSettings();
    if (!settings.enabled) return;
    const afterFingerprint = enemyGenerationFingerprintFromVariables(variables);
    const beforeFingerprint = enemyGenerationFingerprintFromVariables(before);
    if (!afterFingerprint || afterFingerprint === beforeFingerprint) {
      this.scheduleWarmup();
      return;
    }
    this.setStatus('calibrating', settings.autoCalibration ? '正在校准新敌人…' : '正在记录新敌人谱系…');
    try {
      const chatScope = this.captureChatScope();
      const result = await this.workerClient.calibrate(variables, this.getState(), settings);
      if (!this.isCurrentChatScope(chatScope)) {
        this.debug('chat changed while calibrating enemy; discarded stale result');
        return;
      }
      if (result.changed) applyCalibratedEnemy(variables, result.variables);
      this.latestSnapshot = result.snapshot;
      this.persistState(result.state);
      const calibration = result.state.lastCalibration;
      const message = result.changed && calibration
        ? `敌人数值已校准 ×${calibration.appliedScale}，有效难度 ${calibration.effectiveRatio}%`
        : result.snapshot?.enemyPower
          ? `敌人已评分：${result.snapshot.enemyPower.currentEncounterScore} 分`
          : '敌人谱系已记录';
      this.setStatus('ready', message, result.snapshot || undefined);
      if (result.changed && settings.showNotifications) {
        this.host.notify('success', message, '设计辅助器');
      }
    } catch (error) {
      this.fail('敌人评分或校准失败，已保留模型原始内容', error);
    }
  };

  private readonly onChatChanged = (): void => {
    this.latestSnapshot = null;
    this.setStatus('idle', '聊天已切换，等待重新评估');
    this.scheduleWarmup();
  };

  private readonly onMvuInitialized = (): void => {
    this.scheduleWarmup();
  };

  private async runWarmup(): Promise<MvuDesignSnapshot | null> {
    if (!isMagicGirlWorldCharacter(this.host.context())) {
      this.setStatus('idle', '仅在魔法少女世界角色卡中启用');
      return null;
    }
    const settings = this.getSettings();
    if (!settings.enabled) return null;
    const mvu = this.host.mvu();
    if (!mvu) {
      this.setStatus('idle', '等待 MVU 初始化');
      return null;
    }
    this.setStatus('warming', '正在预先模拟卡组…');
    try {
      const chatScope = this.captureChatScope();
      const variables = mvu.getMvuData({ type: 'message', message_id: 'latest' });
      const state = this.getState();
      const snapshot = await this.workerClient.createSnapshot(variables, state, settings);
      if (!this.isCurrentChatScope(chatScope)) {
        this.debug('chat changed during warmup; discarded stale snapshot');
        return null;
      }
      if (!snapshot) {
        this.setStatus('idle', '当前没有可评分的玩家卡组');
        return null;
      }
      this.latestSnapshot = snapshot;
      state.lineage = snapshot.lineage;
      state.lastDeckFingerprint = snapshot.deckFingerprint;
      state.lastEnemyFingerprint = snapshot.enemyFingerprint || undefined;
      this.persistState(state);
      this.setStatus(
        'ready',
        `卡组 ${snapshot.deckProfile.totalScore} 分 · ${snapshot.deckProfile.archetypes[0]?.label || '未定流派'}`,
        snapshot,
      );
      return snapshot;
    } catch (error) {
      this.fail('卡组预评估失败', error, false);
      return null;
    }
  }

  private scheduleWarmup(): void {
    if (!this.active) return;
    if (this.warming) {
      this.warmupRerunRequested = true;
      return;
    }
    if (this.warmupScheduled) return;
    this.warmupScheduled = true;
    const run = () => {
      this.warmupScheduled = false;
      if (this.active) void this.warmup();
    };
    const requestIdleCallback = (globalThis as any).requestIdleCallback as undefined | ((callback: () => void, options?: { timeout: number }) => void);
    if (requestIdleCallback) requestIdleCallback(run, { timeout: 1200 });
    else globalThis.setTimeout(run, 0);
  }

  private persistState(state: DesignAssistantChatState): void {
    const context = this.host.context();
    if (!context?.chatMetadata) return;
    context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY] = clone(state);
    context.saveMetadataDebounced();
  }

  private saveSettings(settings: DesignAssistantSettings): void {
    const context = this.host.context();
    if (!context) return;
    context.extensionSettings[DESIGN_ASSISTANT_EXTENSION_ID] = normalizeDesignAssistantSettings(settings);
    context.saveSettingsDebounced();
    this.publishDashboard();
    this.scheduleWarmup();
  }

  private setStatus(
    phase: DesignAssistantStatus['phase'],
    message: string,
    snapshot?: MvuDesignSnapshot,
  ): void {
    this.status = {
      phase,
      message,
      updatedAt: this.host.now(),
      ...(snapshot ? {
        deckScore: snapshot.deckProfile.totalScore,
        targetScore: snapshot.enemyEnvelope.targetScore,
        ...(snapshot.enemyPower ? { enemyScore: snapshot.enemyPower.currentEncounterScore } : {}),
      } : {}),
    };
    this.publishDashboard();
  }

  private publishDashboard(): void {
    const monitor = (globalThis as any).MagicGirlWorldMvuMonitor;
    if (!monitor) return;
    monitor.setDesignAssistant?.(this);
    monitor.receiveDesignAssistantDashboard?.(this.getDashboard());
  }

  private fail(title: string, error: unknown, notify = true): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.setStatus('error', `${title}：${detail}`);
    if (notify && this.getSettings().showNotifications) this.host.notify('warning', detail, title);
    this.debug(title, error);
  }

  private debug(...values: unknown[]): void {
    if (this.getSettings().debug) console.debug('[MagicGirlDesignAssistant]', ...values);
  }
}
