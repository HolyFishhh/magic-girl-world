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

// 移除TavernHelper声明，直接使用全局函数

export class CharacterCreator {
  private container: HTMLElement;
  private userName = '{{user}}';
  private currentConfig: Partial<CharacterConfig> = {
    name: this.userName,
  };

  constructor() {
    this.container = document.getElementById('character-creator-container') as HTMLElement;
    if (!this.container) {
      console.error('Character creator container not found! Looking for element with id="character-creator-container"');
      // 输出当前页面的所有元素以供调试
      console.log('Available elements:', document.querySelectorAll('*'));
      console.log('Body content:', document.body?.innerHTML?.substring(0, 500));
      return;
    }

    console.log('✅ Character creator container found:', this.container);
    this.initializeEventListeners();
    this.renderDefaultState();
    this.renderCityOptions();
    this.fetchUserName();
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
      // Fallback name
      this.userName = '玩家';
      this.currentConfig.name = this.userName;
      this.updatePreview();
    }
  }

  private initializeEventListeners(): void {
    console.log('🔧 开始绑定事件监听器');

    // 阵营选择
    const factionCards = document.querySelectorAll('.faction-card');
    console.log('找到阵营卡片:', factionCards.length, factionCards);
    factionCards.forEach(card => {
      card.addEventListener('click', () => {
        console.log('阵营卡片被点击:', card);
        const faction = card.getAttribute('data-faction') as Faction;
        console.log('选择的阵营:', faction);
        this.selectFaction(faction);
      });
    });

    // 城市选择（现在通过 city-grid 委托）
    // const citySelect = document.getElementById('city-select');
    // citySelect?.addEventListener('change', () => this.handleCityChange());

    // 自定义描述
    const descInput = document.getElementById('custom-description');
    console.log('找到描述输入框:', descInput);
    descInput?.addEventListener('input', () => this.updateCharacterCounter());

    // 重置按钮
    const resetBtn = document.getElementById('reset-form-btn');
    console.log('找到重置按钮:', resetBtn);
    resetBtn?.addEventListener('click', () => this.resetForm());

    // 创建角色按钮
    const createBtn = document.getElementById('create-character-btn');
    console.log('找到创建按钮:', createBtn);
    createBtn?.addEventListener('click', () => this.createCharacter());

    console.log('✅ 事件监听器绑定完成');
  }

  private selectFaction(faction: Faction): void {
    console.log('🎯 selectFaction 被调用，选择的阵营:', faction);

    // 移除所有已选中状态
    const allFactionCards = document.querySelectorAll('.faction-card');
    console.log('找到阵营卡片总数:', allFactionCards.length);
    allFactionCards.forEach(card => card.classList.remove('selected'));

    // 选中当前阵营
    const targetCard = document.querySelector(`[data-faction="${faction}"]`);
    console.log('目标阵营卡片:', targetCard);
    targetCard?.classList.add('selected');

    this.currentConfig.faction = faction;
    console.log('当前配置更新为:', this.currentConfig);

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

    console.log('开始渲染职业选项...');
    this.renderJobOptions();
    console.log('开始更新预览...');
    this.updatePreview();
    console.log('开始验证表单...');
    this.validateForm();
    console.log('✅ selectFaction 执行完成');
  }

  private renderCityOptions(): void {
    console.log('🏙️ 开始渲染城市选项');
    const cityGrid = document.querySelector('.city-grid');
    console.log('找到城市网格:', cityGrid);
    if (!cityGrid) {
      console.log('❌ 城市网格未找到，退出渲染');
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
    console.log('🔨 开始渲染职业选项，当前阵营:', this.currentConfig.faction);
    const jobGrid = document.querySelector('.job-grid');
    console.log('找到职业网格:', jobGrid);
    if (!jobGrid || !this.currentConfig.faction) {
      console.log('❌ 职业网格或阵营未找到，退出渲染');
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
    if (this.isConfigValid(this.currentConfig)) {
      createBtn.disabled = false;
      validationMessage.style.display = 'none';
    } else {
      createBtn.disabled = true;
      validationMessage.style.display = 'block';
    }
  }

  private async createCharacter(): Promise<void> {
    console.log('🎭 开始创建角色');

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
    console.log('✅ 角色配置验证通过:', config);

    try {
      // 生成角色描述文本
      console.log('📝 生成角色描述文本...');
      const characterDescription = this.buildUserDescription(config);
      console.log('角色描述生成完成:', characterDescription);

      // 显示成功消息
      this.showMessage('角色创建成功！正在启动游戏...', 'success');

      // 短暂延迟以显示成功消息
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 使用TavernHelper发送角色描述作为用户消息
      try {
        console.log('📤 发送角色描述为用户消息...');
        await triggerSlash(`/send ${characterDescription}`);

        console.log('🚀 触发AI对话...');
        await triggerSlash('/trigger');

        console.log('✨ 游戏启动成功！');

        // 可选：显示最终消息
        this.showMessage('游戏已启动！AI正在生成开场剧情...', 'info');
      } catch (error) {
        console.error('❌ TavernHelper API 调用失败:', error);
        this.showMessage('TavernHelper API 调用失败，无法启动游戏。', 'error');
      }
    } catch (error) {
      console.error('❌ 创建角色失败:', error);
      this.showMessage('创建角色失败，请重试。', 'error');
    }
  }

  /**
   * 构建用户角色描述文本
   */
  private buildUserDescription(config: CharacterConfig): string {
    const parts: string[] = [];

    // 基本信息
    parts.push(`我是${config.name}。`);

    // 阵营信息
    const factionNames: Record<Faction, string> = {
      magical_girl: '魔法少女',
      ordinary_people: '普通人',
      evil_forces: '邪恶势力',
    };
    parts.push(`我属于${factionNames[config.faction]}阵营。`);

    // 身份信息 - 玩家同时拥有普通身份和超自然身份
    if (config.ordinaryIdentity) {
      parts.push(`我的普通身份是${config.ordinaryIdentity.name}：${config.ordinaryIdentity.description}`);
    }

    if (config.supernaturalIdentity) {
      parts.push(`我的超自然身份是${config.supernaturalIdentity.name}：${config.supernaturalIdentity.description}`);
    }

    // 城市和地点信息
    if (config.city) {
      parts.push(`我生活在${config.city.name}。${config.city.description}`);
    }

    if (config.location) {
      parts.push(`我目前在${config.location.name}。${config.location.description}`);
    }

    // 自定义描述
    if (config.customDescription && config.customDescription.trim()) {
      parts.push(`\n补充描述：${config.customDescription.trim()}`);
    }

    // 添加游戏开始提示
    parts.push(`\n请根据以上信息，初始化变量，确保所有变量都进行初始化，不要遗漏！`);

    return parts.join(' ');
  }

  private isConfigValid(config: Partial<CharacterConfig>): config is CharacterConfig {
    const { faction, supernaturalIdentity, ordinaryIdentity, city, location } = config;

    // 玩家必须同时选择普通身份和超自然身份（如果不是普通人阵营）
    if (faction === 'ordinary_people') {
      // 普通人阵营只需要普通身份
      return !!(faction && ordinaryIdentity && city && location);
    } else {
      // 其他阵营需要同时有普通身份和超自然身份
      return !!(faction && supernaturalIdentity && ordinaryIdentity && city && location);
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
      console.log(`[${type}] ${message}`);
      alert(`[${type}] ${message}`);
    }
  }

  private resetForm(): void {
    // 重置配置
    this.currentConfig = {
      name: this.userName,
    };

    // 重置UI元素
    document.querySelectorAll('.faction-card, .job-card, .location-card, .city-card').forEach(card => {
      card.classList.remove('selected');
    });

    // (document.getElementById('city-select') as HTMLSelectElement).value = '';
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
