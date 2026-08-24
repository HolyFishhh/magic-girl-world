// 角色创建器核心模块
import {
  CharacterConfig,
  CITIES,
  City,
  Faction,
  FACTION_INFO,
  Location,
  ORDINARY_IDENTITIES,
  OrdinaryIdentity,
  SHIROKI_LOCATIONS,
  SUPERNATURAL_IDENTITIES,
  SupernaturalIdentity,
} from '../types';
import {
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
    mode: 'story',
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
    this.renderCityOptions();
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
        if (mode === 'story' || mode === 'expedition') this.selectMode(mode);
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
    this.currentConfig.mode = mode;
    document.querySelectorAll<HTMLElement>('.mode-card').forEach(card => {
      const selected = card.dataset.mode === mode;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-checked', String(selected));
    });
    this.validateForm();
  }

  private selectFaction(faction: Faction): void {
    // 移除所有已选中状态
    const allFactionCards = document.querySelectorAll('.faction-card');
    allFactionCards.forEach(card => card.classList.remove('selected'));

    // 选中当前阵营
    const targetCard = document.querySelector(`[data-faction="${faction}"]`);
    targetCard?.classList.add('selected');

    this.currentConfig.faction = faction;
    // 当选择普通人阵营时，自动选择潜在觉醒者并禁用超自然身份选择
    if (faction === 'ordinary_people') {
      const potentialAwakener = SUPERNATURAL_IDENTITIES.find(id => id.id === 'potential_awakener');
      this.currentConfig.supernaturalIdentity = potentialAwakener || null;
      document.querySelectorAll('.supernatural-identity').forEach(card => {
        (card as HTMLElement).style.pointerEvents = 'none';
        card.classList.remove('selected');
      });
    } else {
      this.currentConfig.supernaturalIdentity = undefined; // 允许重新选择
      document.querySelectorAll('.supernatural-identity').forEach(card => {
        (card as HTMLElement).style.pointerEvents = 'auto';
      });
    }

    this.renderJobOptions();
    this.updatePreview();
    this.validateForm();
  }

  private renderCityOptions(): void {
    const cityGrid = document.querySelector('.city-grid');
    if (!cityGrid) {
      return;
    }

    cityGrid.innerHTML = '';
    CITIES.forEach(city => {
      const cityCard = document.createElement('div');
      cityCard.className = 'city-card';
      cityCard.dataset.cityId = city.id;
      if (city.status === 'developing') {
        cityCard.classList.add('disabled');
      }

      cityCard.innerHTML = `
        <div class="city-emoji">${city.emoji}</div>
        <div class="city-name">${city.name}</div>
        <div class="city-desc">${city.description}</div>
        ${city.status === 'developing' ? '<div class="city-status">开发中</div>' : ''}
      `;

      if (city.status === 'available') {
        cityCard.addEventListener('click', () => this.selectCity(city));
      }

      cityGrid.appendChild(cityCard);
    });
  }

  private selectCity(city: City): void {
    document.querySelectorAll('.city-card').forEach(card => card.classList.remove('selected'));
    document.querySelector(`.city-card[data-city-id="${city.id}"]`)?.classList.add('selected');

    this.currentConfig.city = city;
    this.currentConfig.location = undefined; // 重置地点选择

    const locationContainer = document.getElementById('location-section-container');
    if (locationContainer) {
      locationContainer.style.display = 'block';
    }

    if (city.id === 'shiroki') {
      this.renderLocationOptions();
    } else {
      // 对其他城市清空地点选项
      const locationGrid = document.querySelector('.location-grid');
      if (locationGrid) locationGrid.innerHTML = '';
    }

    this.updatePreview();
    this.validateForm();
  }

  private renderJobOptions(): void {
    const jobGrid = document.querySelector('.job-grid');
    if (!jobGrid || !this.currentConfig.faction) {
      return;
    }

    jobGrid.innerHTML = '';

    const createIdentitySection = (title: string, identities: (SupernaturalIdentity | OrdinaryIdentity)[]) => {
      const section = document.createElement('div');
      section.className = 'identity-section';
      section.innerHTML = `<h4>${title}</h4>`;

      identities.forEach(identity => {
        const identityCard = document.createElement('div');
        const isSupernatural = 'faction' in identity;
        identityCard.className = `job-card ${isSupernatural ? 'supernatural-identity' : 'ordinary-identity'}`;
        identityCard.dataset.identityId = identity.id;
        identityCard.innerHTML = `
          <div class="job-icon">${identity.icon}</div>
          <div class="job-name">${isSupernatural ? this.getIdentityDisplayName(identity) : identity.name}</div>
          <div class="job-desc">${identity.description}</div>
          <div class="job-detailed-desc">${
            isSupernatural ? (identity as SupernaturalIdentity).detailedDescription : ''
          }</div>
        `;

        if (isSupernatural) {
          identityCard.addEventListener('click', () =>
            this.selectSupernaturalIdentity(identity as SupernaturalIdentity),
          );
        } else {
          identityCard.addEventListener('click', () => this.selectOrdinaryIdentity(identity as OrdinaryIdentity));
        }
        section.appendChild(identityCard);
      });

      return section;
    };

    // 为当前阵营创建超自然身份选项
    const availableSupernatural = SUPERNATURAL_IDENTITIES.filter(
      identity => identity.faction === this.currentConfig.faction,
    );

    if (availableSupernatural.length > 0) {
      jobGrid.appendChild(createIdentitySection('超自然身份', availableSupernatural));
    }

    // 创建普通身份区域
    jobGrid.appendChild(createIdentitySection('普通身份', ORDINARY_IDENTITIES));
  }

  private getIdentityDisplayName(identity: SupernaturalIdentity): string {
    // 移除性别相关逻辑，直接返回基础名称
    return identity.name;
  }

  private selectSupernaturalIdentity(identity: SupernaturalIdentity): void {
    document.querySelectorAll('.supernatural-identity').forEach(card => card.classList.remove('selected'));
    document.querySelectorAll('.ordinary-identity').forEach(card => card.classList.remove('selected'));
    document.querySelector(`[data-identity-id="${identity.id}"]`)?.classList.add('selected');

    this.currentConfig.supernaturalIdentity = identity;
    // 如果没有选择普通身份，给一个默认的
    if (!this.currentConfig.ordinaryIdentity) {
      this.currentConfig.ordinaryIdentity = ORDINARY_IDENTITIES[0];
      document
        .querySelector(`.ordinary-identity[data-identity-id="${ORDINARY_IDENTITIES[0].id}"]`)
        ?.classList.add('selected');
    }
    this.updatePreview();
    this.validateForm();
  }

  private selectOrdinaryIdentity(identity: OrdinaryIdentity): void {
    document.querySelectorAll('.ordinary-identity').forEach(card => card.classList.remove('selected'));
    document.querySelector(`[data-identity-id="${identity.id}"]`)?.classList.add('selected');

    this.currentConfig.ordinaryIdentity = identity;
    // 如果没有选择超自然身份（非普通人阵营），则设为null
    if (this.currentConfig.faction !== 'ordinary_people' && this.currentConfig.supernaturalIdentity === undefined) {
      this.currentConfig.supernaturalIdentity = null;
    }
    this.updatePreview();
    this.validateForm();
  }

  private renderLocationOptions(): void {
    const locationGrid = document.querySelector('.location-grid');
    if (!locationGrid) return;

    locationGrid.innerHTML = '';
    SHIROKI_LOCATIONS.forEach(location => {
      const locationCard = document.createElement('div');
      locationCard.className = 'location-card';
      locationCard.dataset.locationId = location.id;
      locationCard.innerHTML = `
        <div class="location-name">${location.name}</div>
        <div class="location-desc">${location.description}</div>
        <div class="location-category">${this.getCategoryName(location.category)}</div>
      `;
      locationCard.addEventListener('click', () => this.selectLocation(location));
      locationGrid.appendChild(locationCard);
    });
  }

  private selectLocation(location: Location): void {
    document.querySelectorAll('.location-card').forEach(card => card.classList.remove('selected'));
    document.querySelector(`[data-location-id="${location.id}"]`)?.classList.add('selected');

    this.currentConfig.location = location;
    this.updatePreview();
    this.validateForm();
  }

  private getCategoryName(category: string): string {
    const names: Record<string, string> = {
      school: '学校',
      public: '公共设施',
      commercial: '商业区',
      residential: '居住区',
      religious: '宗教场所',
      entertainment: '娱乐场所',
    };
    return names[category] || category;
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
      let jobText = '未选择';
      if (this.currentConfig.supernaturalIdentity) {
        jobText = this.getIdentityDisplayName(this.currentConfig.supernaturalIdentity);
      } else if (this.currentConfig.supernaturalIdentity === null) {
        jobText = '待定';
      }
      previewJob.textContent = jobText;
    }

    // 更新城市/地点预览
    const previewLocation = elements.location;
    if (previewLocation) {
      let locationText = this.currentConfig.city ? this.currentConfig.city.name : '未选择城市';
      if (this.currentConfig.location) {
        locationText = `${this.currentConfig.city?.name} - ${this.currentConfig.location.name}`;
      }
      previewLocation.textContent = locationText;
    }

    // 更新描述预览
    const previewDesc = elements.description;
    if (previewDesc) {
      if (this.isConfigValid(this.currentConfig)) {
        previewDesc.textContent = '点击"创建角色"后，将根据您的选择生成描述并开始故事。';
      } else {
        previewDesc.textContent = 'AI将根据你的选择生成角色';
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
    // 收集自定义描述信息
    const customDescInput = document.getElementById('custom-description') as HTMLTextAreaElement;
    if (customDescInput) {
      this.currentConfig.customDescription = customDescInput.value.trim();
    }

    if (!this.isConfigValid(this.currentConfig)) {
      this.showMessage('请完善角色信息后再创建', 'warning');
      return;
    }

    const config = this.currentConfig as CharacterConfig;
    this.setCreatingState(true);

    try {
      const startMessage = createCharacterStartMessage(config);
      try {
        await updateCurrentMessageVariablesWith(variables => {
          if (!variables.stat_data || typeof variables.stat_data !== 'object') variables.stat_data = {};
          variables.stat_data.game_mode = config.mode;
          variables.stat_data.run = null;
          return variables;
        });
      } catch (error) {
        console.warn('[MagicGirlWorld] 游戏模式暂未写入 MUV，将由首轮标记补充', error);
      }
      await this.continuationHost.continueWithPrompt({ prompt: startMessage });
      this.showMessage('角色已提交，正在生成开场剧情。', 'info');
    } catch (error) {
      console.error('❌ 创建角色失败:', error);
      this.showMessage(
        error instanceof TavernContinuationError && error.messageSent
          ? '角色已提交，但生成请求失败，请在当前消息重试生成。'
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
    if (buttonText) buttonText.textContent = active ? '正在启动' : this.isHistorical ? '角色已提交' : '创建角色';
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
      .querySelectorAll<HTMLElement>('.faction-card, .job-card, .location-card, .city-card')
      .forEach(card => {
        card.style.pointerEvents = 'none';
        card.setAttribute('aria-disabled', 'true');
      });
    const buttonText = document.querySelector('#create-character-btn .btn-text');
    if (buttonText) buttonText.textContent = '角色已提交';
    const validationMessage = document.getElementById('validation-message');
    if (validationMessage) validationMessage.style.display = 'none';
  }

  private isConfigValid(config: Partial<CharacterConfig>): config is CharacterConfig {
    const { mode, faction, supernaturalIdentity, ordinaryIdentity, city, location } = config;

    // 玩家必须同时选择普通身份和超自然身份（如果不是普通人阵营）
    if (faction === 'ordinary_people') {
      // 普通人阵营只需要普通身份
      return !!(mode && faction && ordinaryIdentity && city && location);
    } else {
      // 其他阵营需要同时有普通身份和超自然身份
      return !!(mode && faction && supernaturalIdentity && ordinaryIdentity && city && location);
    }
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
      mode: 'story',
      name: this.userName,
    };

    // 重置UI元素
    document.querySelectorAll('.faction-card, .job-card, .location-card, .city-card').forEach(card => {
      card.classList.remove('selected');
    });
    this.selectMode('story');

    (document.getElementById('custom-description') as HTMLTextAreaElement).value = '';

    // 清空并隐藏地点选择
    const locationContainer = document.getElementById('location-section-container');
    if (locationContainer) locationContainer.style.display = 'none';
    const locationGrid = document.querySelector('.location-grid');
    if (locationGrid) locationGrid.innerHTML = '<!-- 地点选项将通过JS动态生成 -->';

    // 清空动态生成的区域
    const jobGrid = document.querySelector('.job-grid');
    if (jobGrid) jobGrid.innerHTML = '<!-- 职业选项将通过JS动态生成 -->';

    // 更新预览和按钮状态
    this.updateCharacterCounter();
    this.updatePreview();
    this.validateForm();

    // 重置创建按钮
    const createBtn = document.getElementById('create-character-btn') as HTMLButtonElement;
    if (createBtn) {
      createBtn.disabled = true;
      (createBtn.querySelector('.btn-text') as HTMLElement).textContent = '创建角色';
    }

    this.showMessage('表单已重置。', 'info');
  }

  private renderDefaultState(): void {
    // 初始化预览和计数器
    this.updatePreview();
    this.updateCharacterCounter();
    this.validateForm();
  }
}
