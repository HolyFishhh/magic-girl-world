// 角色创建器核心模块
import {
  CharacterConfig,
  Faction,
  FACTION_INFO,
} from '../types';
import {
  ensureMvuRuntimeReady,
  isCurrentMessageLatest,
  rerenderHistoricalMessageForDepth,
  updateCurrentMessageVariablesWith,
  watchCurrentMessageUntilHistorical,
} from '../../runtime/messageVariables';
import { TavernContinuationError, TavernContinuationHost } from '../../runtime/tavernContinuation';
import { createCharacterStartMessage } from './promptGenerator';

export class CharacterCreator {
  private container: HTMLElement;
  private userName = '{{user}}';
  private isCreating = false;
  private isHistorical = false;
  private readonly continuationHost = TavernContinuationHost.getInstance();
  private currentConfig: Partial<CharacterConfig> = {
    name: this.userName,
  };

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
      if (fetchedName) {
        this.userName = fetchedName;
        this.currentConfig.name = this.userName;
        this.updatePreview();
      }
    } catch (error) {
      console.error('Failed to fetch user name:', error);
      this.userName = '玩家';
      this.currentConfig.name = this.userName;
      this.updatePreview();
    }
  }

  private initializeEventListeners(): void {
    document.querySelectorAll<HTMLElement>('.mode-card').forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.dataset.mode;
        if (!card.hasAttribute('disabled') && (mode === 'story' || mode === 'expedition')) this.selectMode(mode);
      });
    });

    document.querySelectorAll<HTMLElement>('[data-config-field]').forEach(control => {
      const eventName = control instanceof HTMLSelectElement ? 'change' : 'input';
      control.addEventListener(eventName, () => this.syncAdvancedFields());
    });

    document.querySelectorAll<HTMLElement>('[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        if (!target) return;
        document.querySelectorAll<HTMLElement>('[data-tab]').forEach(item => {
          const active = item === tab;
          item.classList.toggle('active', active);
          item.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll<HTMLElement>('[data-panel]').forEach(panel => {
          panel.hidden = panel.dataset.panel !== target;
        });
      });
    });

    document.querySelectorAll<HTMLButtonElement>('.preset-chip[data-fill]').forEach(chip => {
      chip.addEventListener('click', () => {
        const field = chip.dataset.fill;
        const value = chip.dataset.value || '';
        const target = field ? this.container.querySelector<HTMLElement>(`[data-config-field="${field}"]`) : null;
        if (!target) return;
        (target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value = value;
        target.dispatchEvent(new Event(target instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      });
    });

    // 阵营选择
    const factionCards = document.querySelectorAll('.faction-card');
    factionCards.forEach(card => {
      card.addEventListener('click', () => {
        const faction = card.getAttribute('data-faction') as Faction;
        this.selectFaction(faction);
      });
    });

    // 自定义描述
    const descInput = document.getElementById('custom-description');
    descInput?.addEventListener('input', () => this.updateCharacterCounter());

    // 重置按钮
    const resetBtn = document.getElementById('reset-form-btn');
    resetBtn?.addEventListener('click', () => this.resetForm());

    // 创建角色按钮
    const createBtn = document.getElementById('create-character-btn');
    createBtn?.addEventListener('click', () => this.createCharacter());
  }

  private selectMode(mode: CharacterConfig['mode']): void {
    if (mode === 'expedition') return;
    this.currentConfig.mode = mode;
    document.querySelectorAll<HTMLElement>('.mode-card').forEach(card => {
      const selected = card.dataset.mode === mode;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-checked', String(selected));
    });
    const storyConfig = document.getElementById('story-config');
    if (storyConfig) storyConfig.hidden = mode !== 'story';
    const modeHint = document.getElementById('mode-hint');
    if (modeHint) modeHint.textContent = '已选择剧情模式。按需填写设定，留空的项目交给 AI 自由发挥。';
    this.validateForm();
  }

  private syncAdvancedFields(): void {
    const values = new Map<string, string>();
    this.container
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-config-field]')
      .forEach(field => {
        const key = field.dataset.configField as keyof CharacterConfig | undefined;
        if (!key) return;
        const value = field.value.trim();
        if (value && !values.has(String(key))) values.set(String(key), value);
      });
    for (const [key, value] of values) (this.currentConfig as unknown as Record<string, unknown>)[key] = value;
    for (const key of [
      'name',
      'customDescription',
      'profession',
      'startingLocation',
      'world',
      'theme',
      'plot',
      'tone',
      'style',
      'pace',
      'card',
      'mechanics',
      'limits',
      'note',
      'extra',
    ]) {
      if (!values.has(key)) delete (this.currentConfig as unknown as Record<string, unknown>)[key];
    }
    this.updatePreview();
  }

  private selectFaction(faction: Faction): void {
    // 移除所有已选中状态
    const allFactionCards = document.querySelectorAll('.faction-card');
    allFactionCards.forEach(card => card.classList.remove('selected'));

    // 选中当前阵营
    const targetCard = document.querySelector(`[data-faction="${faction}"]`);
    targetCard?.classList.add('selected');

    this.currentConfig.faction = faction;
    this.updatePreview();
    this.validateForm();
  }

  private updatePreview(): void {
    this.updatePreviewDisplay();
  }

  private updatePreviewDisplay(): void {
    const elements = {
      name: document.querySelector('.preview-name'),
      faction: document.querySelector('.preview-faction'),
      job: document.getElementById('preview-job'),
      location: document.getElementById('preview-location'),
      description: document.getElementById('preview-description'),
    };

    const previewName = elements.name as HTMLElement;
    if (previewName) {
      previewName.textContent = this.currentConfig.name || '未设置角色';
    }

    const previewFaction = elements.faction as HTMLElement;
    const faction = this.currentConfig.faction;
    if (faction) {
      const factionInfo = FACTION_INFO[faction];
      previewFaction.textContent = factionInfo.name;
      previewFaction.style.backgroundColor = factionInfo.color;
      previewFaction.style.visibility = 'visible';
    } else {
      previewFaction.textContent = '请先选择阵营';
      previewFaction.style.visibility = 'hidden';
    }

    // 更新职业预览
    const previewJob = elements.job;
    if (previewJob) {
      previewJob.textContent = this.currentConfig.profession || '交给 AI 安排';
    }

    // 更新城市/地点预览
    const previewLocation = elements.location;
    if (previewLocation) {
      previewLocation.textContent = this.currentConfig.startingLocation || '交给 AI 安排';
    }

    // 更新描述预览
    const previewDesc = elements.description;
    if (previewDesc) {
      if (this.isConfigValid(this.currentConfig)) {
        previewDesc.textContent = '点击“开始剧情”后，AI 会根据已有设定补全角色与世界。';
      } else {
        previewDesc.textContent = '先选择剧情模式，其他内容全部可以留空。';
      }
    }
  }

  private updateCharacterCounter(): void {
    const descInput = document.getElementById('custom-description') as HTMLTextAreaElement;
    const charCount = document.getElementById('char-count');

    if (descInput && charCount) {
      const count = descInput.value.length;
      charCount.textContent = count.toString();
      charCount.style.color = count > 250 ? '#dc3545' : count > 200 ? '#ffc107' : '#6c757d';
    }
    this.updatePreview();
  }

  private validateForm(): void {
    const createBtn = document.getElementById('create-character-btn') as HTMLButtonElement;
    const validationMessage = document.getElementById('validation-message') as HTMLDivElement;
    if (this.isConfigValid(this.currentConfig) && !this.isCreating && !this.isHistorical) {
      createBtn.disabled = false;
      validationMessage.style.display = 'none';
    } else {
      createBtn.disabled = true;
      validationMessage.style.display = this.isCreating ? 'none' : 'block';
    }
  }

  private async createCharacter(): Promise<void> {
    if (this.isCreating) return;
    if (!isCurrentMessageLatest()) {
      this.lockHistoricalForm();
      return;
    }
    this.syncAdvancedFields();

    if (!this.isConfigValid(this.currentConfig)) {
      this.showMessage('请先选择剧情模式', 'warning');
      return;
    }

    const config = this.currentConfig as CharacterConfig;
    this.setCreatingState(true);

    try {
      // The first assistant reply is the only place where the initial MVU
      // update can run. Wait until the chat-level MVU listener has been
      // installed before creating the user message, otherwise MESSAGE_RECEIVED
      // can be emitted while the dependency is still initializing.
      await ensureMvuRuntimeReady({ mvuTimeoutMs: 30000, battleDataTimeoutMs: 30000 });
      const startMessage = createCharacterStartMessage(config);
      await updateCurrentMessageVariablesWith(variables => {
        if (!variables.stat_data || typeof variables.stat_data !== 'object') variables.stat_data = {};
        variables.stat_data.game_mode = config.mode;
        variables.stat_data.run = null;
        return variables;
      });
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
    const createBtn = document.getElementById('create-character-btn') as HTMLButtonElement | null;
    const buttonText = createBtn?.querySelector('.btn-text') as HTMLElement | null;
    if (buttonText) buttonText.textContent = active ? '正在启动' : this.isHistorical ? '设定已提交' : '开始剧情';
    this.validateForm();
  }

  private lockHistoricalForm(): void {
    if (this.isHistorical) return;
    this.isHistorical = true;
    this.container
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button')
      .forEach(control => {
        control.disabled = true;
      });
    this.container
      .querySelectorAll<HTMLElement>('.faction-card')
      .forEach(card => {
        card.style.pointerEvents = 'none';
        card.setAttribute('aria-disabled', 'true');
      });
    const buttonText = document.querySelector('#create-character-btn .btn-text');
    if (buttonText) buttonText.textContent = '设定已提交';
    const validationMessage = document.getElementById('validation-message');
    if (validationMessage) validationMessage.style.display = 'none';
  }

  private isConfigValid(config: Partial<CharacterConfig>): config is CharacterConfig {
    // 剧情模式是唯一必要选择，其余设定由玩家按需填写或交给 AI 补全。
    return config.mode === 'story';
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
    // 重置配置
    this.currentConfig = {
      name: this.userName,
    };

    // 重置UI元素
    document.querySelectorAll('.faction-card').forEach(card => {
      card.classList.remove('selected');
    });
    this.container
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-config-field]')
      .forEach(field => {
        field.value = '';
      });
    const storyConfig = document.getElementById('story-config');
    if (storyConfig) storyConfig.hidden = true;
    document.querySelectorAll<HTMLElement>('.mode-card').forEach(card => {
      card.classList.remove('selected');
      card.setAttribute('aria-checked', 'false');
    });

    // 更新预览和按钮状态
    this.updateCharacterCounter();
    this.updatePreview();
    this.validateForm();

    // 重置创建按钮
    const createBtn = document.getElementById('create-character-btn') as HTMLButtonElement;
    if (createBtn) {
      createBtn.disabled = true;
      (createBtn.querySelector('.btn-text') as HTMLElement).textContent = '开始剧情';
    }

    this.showMessage('表单已重置。', 'info');
  }

  private renderDefaultState(): void {
    // 初始化预览和计数器
    this.updatePreview();
    this.updateCharacterCounter();
    this.validateForm();
    const storyConfig = document.getElementById('story-config');
    if (storyConfig) storyConfig.hidden = true;
  }
}
