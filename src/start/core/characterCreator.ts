// 剧情模式开始页：只负责收集玩家设定，并把一次浅层 JSON 交给酒馆续写链路。
import type { CharacterConfig } from '../types';
import {
  ensureMvuRuntimeReady,
  getCurrentChatMessageText,
  isCurrentMessageLatest,
  rerenderHistoricalMessageForDepth,
  updateCurrentChatVariablesWith,
  updateCurrentMessageVariablesWith,
  watchCurrentMessageUntilHistorical,
} from '../../runtime/messageVariables';
import { TavernContinuationError, TavernContinuationHost } from '../../runtime/tavernContinuation';
import { lockGameModeInStat, normalizeGameMode, type GameMode } from '../../game-core/towerMode';
import { createCharacterStartMessage } from './promptGenerator';

const CONFIG_FIELDS: Array<[keyof CharacterConfig, string]> = [
  ['name', 'name'],
  ['customDescription', 'appearance'],
  ['world', 'world'],
  ['profession', 'identity'],
  ['opening', 'opening'],
  ['card', 'card'],
  ['towerRequirements', 'tower_requirements'],
];

export class CharacterCreator {
  private container: HTMLElement;
  private userName = '{{user}}';
  private isCreating = false;
  private isHistorical = false;
  private openingMode: GameMode | null = null;
  private readonly continuationHost = TavernContinuationHost.getInstance();
  private currentConfig: Partial<CharacterConfig> = { mode: 'story' };

  constructor() {
    this.container = document.getElementById('character-creator-container') as HTMLElement;
    if (!this.container) {
      console.error('Character creator container not found! Looking for element with id="character-creator-container"');
      return;
    }

    this.initializeEventListeners();
    this.renderDefaultState();
    this.fetchUserName();
    watchCurrentMessageUntilHistorical(() => {
      this.lockHistoricalForm();
      void rerenderHistoricalMessageForDepth().catch(error => {
        console.warn('[MagicGirlWorld] 历史开始页按楼层卸载失败，保留锁定兜底', error);
      });
    });
  }

  private async fetchUserName(): Promise<void> {
    try {
      const fetchedName = await triggerSlash('/pass {{user}}');
      if (fetchedName?.trim()) this.userName = fetchedName.trim();
    } catch (error) {
      console.warn('[MagicGirlWorld] 获取玩家名失败，使用默认占位符', error);
    }
    this.updatePreview();
  }

  private initializeEventListeners(): void {
    this.container.querySelectorAll<HTMLButtonElement>('.mode-card').forEach(card => {
      card.addEventListener('click', () => {
        const mode = normalizeGameMode(card.dataset.mode);
        if (mode && !card.disabled) this.selectMode(mode);
      });
    });

    this.container
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-config-field]')
      .forEach(control => {
        const eventName = control instanceof HTMLSelectElement ? 'change' : 'input';
        control.addEventListener(eventName, () => this.syncAdvancedFields());
      });

    this.container.querySelectorAll<HTMLButtonElement>('.preset-card[data-preset-field]').forEach(preset => {
      preset.addEventListener('click', () => {
        const field = preset.dataset.presetField;
        const target = field
          ? this.container.querySelector<HTMLTextAreaElement>(`[data-config-field="${field}"]`)
          : null;
        if (!target) return;
        target.value = preset.dataset.value || '';
        this.container
          .querySelectorAll<HTMLButtonElement>(`.preset-card[data-preset-field="${field}"]`)
          .forEach(item => item.classList.toggle('selected', item === preset));
        target.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    document.getElementById('reset-form-btn')?.addEventListener('click', () => this.resetForm());
    document.getElementById('create-character-btn')?.addEventListener('click', () => void this.createCharacter());
  }

  private selectMode(mode: CharacterConfig['mode']): void {
    const canonicalMode = normalizeGameMode(mode);
    if (!canonicalMode) return;
    this.currentConfig.mode = canonicalMode;
    this.container.querySelectorAll<HTMLButtonElement>('.mode-card').forEach(card => {
      const selected = normalizeGameMode(card.dataset.mode) === canonicalMode;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-checked', String(selected));
    });
    this.container.querySelectorAll<HTMLElement>('[data-mode-only]').forEach(section => {
      const visible = section.dataset.modeOnly === canonicalMode;
      section.hidden = !visible;
      section.setAttribute('aria-hidden', String(!visible));
      section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
        .forEach(control => {
          control.disabled = !visible || this.isHistorical;
        });
    });
    this.syncAdvancedFields();
    this.updateStartButtonText();
    this.validateForm();
  }

  private syncAdvancedFields(): void {
    const values = new Map<string, string>();
    this.container
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-config-field]')
      .forEach(field => {
        const key = field.dataset.configField;
        const value = field.value.trim();
        if (key && value && !values.has(key)) values.set(key, value);
      });

    const mode: GameMode = normalizeGameMode(this.currentConfig.mode) ?? 'story';
    const nextConfig: Partial<CharacterConfig> = { mode };
    for (const [key] of CONFIG_FIELDS) {
      if (key === 'towerRequirements' && mode !== 'tower') continue;
      const value = values.get(String(key));
      if (value) (nextConfig as Record<string, unknown>)[key] = value;
    }
    this.currentConfig = nextConfig;
    this.updatePreview();
  }

  private updatePreview(): void {
    const name = document.querySelector<HTMLElement>('.preview-name');
    const job = document.getElementById('preview-job');
    const opening = document.getElementById('preview-opening');
    const description = document.getElementById('preview-description');
    if (name) name.textContent = this.currentConfig.name || this.userName || '未设置角色';
    if (job) job.textContent = this.currentConfig.profession || '交给 AI 安排';
    if (opening) opening.textContent = this.currentConfig.opening || '交给 AI 安排';
    if (description) {
      const world = this.currentConfig.world ? '世界观已设定' : '世界观交给 AI';
      const card = this.currentConfig.card ? '卡牌方向已设定' : '卡牌方向交给 AI';
      description.textContent = `${world}，${card}`;
    }
    this.validateForm();
  }

  private validateForm(): void {
    const createBtn = document.getElementById('create-character-btn') as HTMLButtonElement | null;
    const validationMessage = document.getElementById('validation-message') as HTMLElement | null;
    const valid = this.isConfigValid(this.currentConfig) && !this.isCreating && !this.isHistorical;
    if (createBtn) createBtn.disabled = !valid;
    if (validationMessage) {
      validationMessage.style.display = valid ? 'none' : this.isCreating ? 'none' : 'block';
      if (!valid && !this.isCreating) validationMessage.textContent = '设定可以全部留空，直接开始剧情。';
    }
  }

  private async createCharacter(): Promise<void> {
    if (this.isCreating) return;
    if (!isCurrentMessageLatest()) {
      this.lockHistoricalForm();
      return;
    }
    this.syncAdvancedFields();
    if (!this.isConfigValid(this.currentConfig)) return;

    const config = this.currentConfig as CharacterConfig;
    this.setCreatingState(true);
    try {
      await ensureMvuRuntimeReady({
        mvuTimeoutMs: 30000,
        battleDataTimeoutMs: 30000,
        requireBattleData: false,
      });
      const startMessage = createCharacterStartMessage(config);
      const persistStartMode = (variables: Record<string, any>): Record<string, any> => {
        if (!variables.stat_data || typeof variables.stat_data !== 'object') variables.stat_data = {};
        lockGameModeInStat(variables.stat_data, config.mode);
        if (normalizeGameMode(config.mode) === 'tower' && config.towerRequirements?.trim()) {
          variables.stat_data.tower_requirements = config.towerRequirements.trim();
        } else {
          delete variables.stat_data.tower_requirements;
        }
        return variables;
      };
      await updateCurrentMessageVariablesWith(persistStartMode);
      await updateCurrentChatVariablesWith(persistStartMode);
      await this.continuationHost.continueWithPrompt({ prompt: startMessage });
      this.showMessage('设定已提交，正在生成开场剧情。', 'info');
    } catch (error) {
      console.error('❌ 创建角色失败:', error);
      this.showMessage(
        error instanceof TavernContinuationError && error.messageSent
          ? '角色已提交，但生成请求失败，请在当前消息重试生成。'
          : error instanceof Error
            ? error.message
            : '创建角色失败，请重试。',
        'error',
      );
    } finally {
      this.setCreatingState(false);
    }
  }

  private setCreatingState(active: boolean): void {
    this.isCreating = active;
    this.updateStartButtonText();
    this.validateForm();
  }

  private updateStartButtonText(): void {
    const buttonText = document.querySelector('#create-character-btn .btn-text');
    if (buttonText) {
      const idleText = normalizeGameMode(this.currentConfig.mode) === 'tower' ? '开始爬塔' : '开始剧情';
      buttonText.textContent = this.isCreating ? '正在启动' : this.isHistorical ? '设定已提交' : idleText;
    }
  }

  private lockHistoricalForm(): void {
    if (this.isHistorical) return;
    this.isHistorical = true;
    this.container
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button')
      .forEach(control => {
        control.disabled = true;
      });
    const buttonText = document.querySelector('#create-character-btn .btn-text');
    if (buttonText) buttonText.textContent = '设定已提交';
    const validationMessage = document.getElementById('validation-message');
    if (validationMessage) validationMessage.style.display = 'none';
  }

  private isConfigValid(config: Partial<CharacterConfig>): config is CharacterConfig {
    return normalizeGameMode(config.mode) !== null;
  }

  private showMessage(message: string, type: 'success' | 'error' | 'warning' | 'info'): void {
    if (typeof toastr !== 'undefined') {
      toastr[type](message, '', {
        closeButton: true,
        timeOut: 5000,
        extendedTimeOut: 2000,
        progressBar: true,
        positionClass: 'toast-top-center',
      });
    } else {
      alert(`[${type}] ${message}`);
    }
  }

  private resetForm(): void {
    this.currentConfig = { mode: this.openingMode ?? 'story' };
    this.container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-config-field]').forEach(field => {
      field.value = '';
    });
    this.selectMode(this.openingMode ?? 'story');
    this.container
      .querySelectorAll<HTMLButtonElement>('.preset-card[data-preset-field]')
      .forEach(card => card.classList.remove('selected'));

    for (const field of ['world', 'card']) {
      const first = this.container.querySelector<HTMLButtonElement>(`.preset-card[data-preset-field="${field}"]`);
      const target = this.container.querySelector<HTMLTextAreaElement>(`[data-config-field="${field}"]`);
      if (first && target) {
        first.classList.add('selected');
        target.value = first.dataset.value || '';
      }
    }
    this.syncAdvancedFields();
    this.showMessage('表单已重置。', 'info');
  }

  private renderDefaultState(): void {
    try {
      const greeting = getCurrentChatMessageText();
      if (greeting.includes('[爬塔模式开场]')) this.openingMode = 'tower';
      else if (greeting.includes('[剧情模式开场]')) this.openingMode = 'story';
    } catch {
      this.openingMode = null;
    }
    for (const field of ['world', 'card']) {
      const target = this.container.querySelector<HTMLTextAreaElement>(`[data-config-field="${field}"]`);
      const selected = this.container.querySelector<HTMLButtonElement>(
        `.preset-card[data-preset-field="${field}"].selected`,
      );
      if (target && !target.value.trim() && selected?.dataset.value) target.value = selected.dataset.value;
    }
    this.selectMode(this.openingMode ?? normalizeGameMode(this.currentConfig.mode) ?? 'story');
    if (this.openingMode) {
      this.container.querySelectorAll<HTMLButtonElement>('.mode-card').forEach(card => {
        card.disabled = true;
        card.hidden = normalizeGameMode(card.dataset.mode) !== this.openingMode;
      });
      const section = this.container.querySelector<HTMLElement>('[data-mode-section]');
      if (section) section.dataset.lockedByGreeting = this.openingMode;
    }
  }
}
