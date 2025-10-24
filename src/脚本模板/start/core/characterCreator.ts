// 角色创建器核心模块
import {
  CharacterConfig,
  Faction,
  FACTION_INFO,
  Location,
  ORDINARY_IDENTITIES,
  OrdinaryIdentity,
  SHIROKI_LOCATIONS,
  SUPERNATURAL_IDENTITIES,
  SupernaturalIdentity,
} from '../types';

export class CharacterCreator {
  private currentConfig: Partial<CharacterConfig> = {
    gender: 'female',
    name: '{{user}}', // 固定使用用户名宏
  };

  constructor() {
    this.initializeEventListeners();
    this.renderDefaultState();
  }

  private initializeEventListeners(): void {
    // 阵营选择
    document.querySelectorAll('.faction-card').forEach(card => {
      card.addEventListener('click', () => {
        const faction = card.getAttribute('data-faction') as Faction;
        this.selectFaction(faction);
      });
    });

    // 性别选择
    document.querySelectorAll('input[name="gender"]').forEach(input => {
      input.addEventListener('change', () => {
        this.updatePreview();
        // 性别改变时重新渲染职业选项以更新显示名称
        if (this.currentConfig.faction) {
          this.renderJobOptions();
        }
      });
    });

    // 城市选择
    const citySelect = document.getElementById('city-select');
    citySelect?.addEventListener('change', () => this.handleCityChange());

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

  private selectFaction(faction: Faction): void {
    document.querySelectorAll('.faction-card').forEach(card => card.classList.remove('selected'));
    document.querySelector(`[data-faction="${faction}"]`)?.classList.add('selected');

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

  private renderJobOptions(): void {
    const jobGrid = document.querySelector('.job-grid');
    if (!jobGrid || !this.currentConfig.faction) return;

    jobGrid.innerHTML = '';

    // 为当前阵营创建超自然身份选项
    const availableSupernatural = SUPERNATURAL_IDENTITIES.filter(
      identity => identity.faction === this.currentConfig.faction,
    );

    // 创建超自然身份区域
    if (availableSupernatural.length > 0) {
      const supernaturalSection = document.createElement('div');
      supernaturalSection.className = 'identity-section';
      supernaturalSection.innerHTML = '<h4>超自然身份</h4>';

      availableSupernatural.forEach(identity => {
        const identityCard = document.createElement('div');
        identityCard.className = 'job-card supernatural-identity';
        identityCard.dataset.identityId = identity.id;
        identityCard.innerHTML = `
          <div class="job-icon">${identity.icon}</div>
          <div class="job-name">${this.getIdentityDisplayName(identity)}</div>
          <div class="job-desc">${identity.description}</div>
        `;
        identityCard.addEventListener('click', () => this.selectSupernaturalIdentity(identity));
        supernaturalSection.appendChild(identityCard);
      });

      jobGrid.appendChild(supernaturalSection);
    }

    // 创建普通身份区域
    const ordinarySection = document.createElement('div');
    ordinarySection.className = 'identity-section';
    ordinarySection.innerHTML = '<h4>普通身份</h4>';

    ORDINARY_IDENTITIES.forEach(identity => {
      const identityCard = document.createElement('div');
      identityCard.className = 'job-card ordinary-identity';
      identityCard.dataset.identityId = identity.id;
      identityCard.innerHTML = `
        <div class="job-icon">${identity.icon}</div>
        <div class="job-name">${identity.name}</div>
        <div class="job-desc">${identity.description}</div>
      `;
      identityCard.addEventListener('click', () => this.selectOrdinaryIdentity(identity));
      ordinarySection.appendChild(identityCard);
    });

    jobGrid.appendChild(ordinarySection);
  }

  private getIdentityDisplayName(identity: SupernaturalIdentity): string {
    const genderInput = document.querySelector('input[name="gender"]:checked') as HTMLInputElement;
    const gender = genderInput ? (genderInput.value as 'male' | 'female' | 'other') : 'female';

    if (identity.genderSpecific) {
      if (gender === 'male' && identity.maleVariant) {
        return identity.maleVariant;
      } else if (gender === 'female' && identity.femaleVariant) {
        return identity.femaleVariant;
      }
    }
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

  private handleCityChange(): void {
    const citySelect = document.getElementById('city-select') as HTMLSelectElement;
    this.currentConfig.city = citySelect.value;

    if (citySelect.value === 'shiroki') {
      this.renderLocationOptions();
    }
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
    const genderInput = document.querySelector('input[name="gender"]:checked') as HTMLInputElement;
    if (genderInput) {
      this.currentConfig.gender = genderInput.value as 'male' | 'female' | 'other';
    }

    this.updatePreviewDisplay();
  }

  private updatePreviewDisplay(): void {
    const elements = {
      name: document.querySelector('.preview-name'),
      faction: document.querySelector('.preview-faction'),
      job: document.getElementById('preview-job'),
      location: document.getElementById('preview-location'),
      gender: document.getElementById('preview-gender'),
      description: document.getElementById('preview-description'),
    };

    if (elements.name) {
      elements.name.textContent = '{{user}}';
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

    if (elements.location) {
      elements.location.textContent = this.currentConfig.location?.name || '未选择';
    }

    const previewGender = elements.gender as HTMLElement;
    if (previewGender) {
      const genderInput = document.querySelector('input[name="gender"]:checked') as HTMLInputElement;
      const genderMap: Record<string, string> = { male: '男性', female: '女性', other: '其他' };
      if (genderInput && genderMap[genderInput.value]) {
        previewGender.textContent = genderMap[genderInput.value];
      }
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
    // 再次收集信息以确保最新
    const genderInput = document.querySelector('input[name="gender"]:checked') as HTMLInputElement;
    if (genderInput) {
      this.currentConfig.gender = genderInput.value as 'male' | 'female' | 'other';
    }
    const customDescInput = document.getElementById('custom-description') as HTMLTextAreaElement;
    if (customDescInput) {
      this.currentConfig.customDescription = customDescInput.value.trim();
    }

    if (!this.isConfigValid(this.currentConfig)) {
      this.showMessage('请确保所有必填项都已选择。', 'warning');
      return;
    }

    const description = this.buildUserDescription(this.currentConfig);
    const createBtn = document.getElementById('create-character-btn') as HTMLButtonElement;

    try {
      this.showMessage('正在发送角色信息...', 'info');
      createBtn.disabled = true;
      (createBtn.querySelector('.btn-text') as HTMLElement).textContent = '正在发送...';

      // 使用 TavernHelper 发送消息并触发AI回应
      await triggerSlash(`/send ${description}`);
      await triggerSlash('/trigger');

      this.showMessage('角色信息已发送！请切换回聊天界面查看AI的回应。', 'success');
      (createBtn.querySelector('.btn-text') as HTMLElement).textContent = '已发送';
      // 可选：发送后永久禁用或隐藏创建界面
    } catch (error) {
      console.error('发送角色描述失败:', error);
      this.showMessage('发送角色信息失败，详情请查看控制台。', 'error');
      createBtn.disabled = false;
      (createBtn.querySelector('.btn-text') as HTMLElement).textContent = '创建角色';
    }
  }

  private buildUserDescription(config: CharacterConfig): string {
    const { faction, supernaturalIdentity, ordinaryIdentity, location, gender, customDescription } = config;

    let desc = `(我的角色信息如下：`;
    desc += `阵营：${FACTION_INFO[faction].name}。`;

    if (supernaturalIdentity) {
      const identityName = this.getIdentityDisplayName(supernaturalIdentity);
      desc += `超凡身份：${identityName}。`;
    } else {
      desc += `我是一个尚未觉醒超凡能力的普通人。`;
    }

    desc += `社会身份：${ordinaryIdentity.name}。`;
    desc += `我当前位于：${location.name}。`;

    const genderMap: Record<string, string> = { male: '男性', female: '女性', other: '其他' };
    desc += `性别：${genderMap[gender]}。`;

    if (customDescription) {
      desc += `补充设定：${customDescription}。`;
    }

    desc += `) 请根据这些信息，作为故事的开端与我对话。`;

    return desc;
  }

  private isConfigValid(config: Partial<CharacterConfig>): config is CharacterConfig {
    const { faction, supernaturalIdentity, ordinaryIdentity, city, location } = config;
    return !!(faction && supernaturalIdentity !== undefined && ordinaryIdentity && city && location);
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
      gender: 'female',
      name: '{{user}}',
    };

    // 重置UI元素
    document.querySelectorAll('.faction-card, .job-card, .location-card').forEach(card => {
      card.classList.remove('selected');
    });

    (document.getElementById('city-select') as HTMLSelectElement).value = '';
    (document.getElementById('custom-description') as HTMLTextAreaElement).value = '';

    const genderFemale = document.querySelector('input[name="gender"][value="female"]') as HTMLInputElement;
    if (genderFemale) genderFemale.checked = true;

    // 清空动态生成的区域
    const jobGrid = document.querySelector('.job-grid');
    if (jobGrid) jobGrid.innerHTML = '<!-- 职业选项将通过JS动态生成 -->';
    const locationGrid = document.querySelector('.location-grid');
    if (locationGrid) locationGrid.innerHTML = '<!-- 地点选项将通过JS动态生成 -->';

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
    // 确保默认性别被选中
    const genderFemale = document.querySelector('input[name="gender"][value="female"]') as HTMLInputElement;
    if (genderFemale) {
      genderFemale.checked = true;
      this.currentConfig.gender = 'female';
    }

    // 初始化预览和计数器
    this.updatePreview();
    this.updateCharacterCounter();
    this.validateForm();
  }
}
