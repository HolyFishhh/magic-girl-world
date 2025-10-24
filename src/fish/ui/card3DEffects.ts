/**
 * 卡牌3D视差效果管理器
 */
export class Card3DEffects {
  private static instance: Card3DEffects;

  private constructor() {
    this.initializeCardEffects();
  }

  public static getInstance(): Card3DEffects {
    if (!Card3DEffects.instance) {
      Card3DEffects.instance = new Card3DEffects();
    }
    return Card3DEffects.instance;
  }

  /**
   * 初始化卡牌3D效果
   */
  private initializeCardEffects(): void {
    // 使用事件委托监听所有卡牌的鼠标事件
    $(document).on(
      'mousemove',
      '.enhanced-card.rarity-Rare, .enhanced-card.rarity-Epic, .enhanced-card.rarity-Legendary',
      e => {
        this.handleCardMouseMove(e);
      },
    );

    $(document).on(
      'mouseleave',
      '.enhanced-card.rarity-Rare, .enhanced-card.rarity-Epic, .enhanced-card.rarity-Legendary',
      e => {
        this.handleCardMouseLeave(e);
      },
    );

    $(document).on(
      'mouseenter',
      '.enhanced-card.rarity-Rare, .enhanced-card.rarity-Epic, .enhanced-card.rarity-Legendary',
      e => {
        this.handleCardMouseEnter(e);
      },
    );
  }

  /**
   * 处理卡牌鼠标移动事件
   */
  private handleCardMouseMove(e: JQuery.MouseMoveEvent): void {
    const card = e.currentTarget as HTMLElement;
    const rect = card.getBoundingClientRect();

    // 计算鼠标相对于卡牌的位置
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 使用getBoundingClientRect获取精确的中心点
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const deltaX = x - centerX;
    const deltaY = y - centerY;

    // 根据鼠标位置计算旋转角度，最大旋转20度
    const rotateX = (deltaY / centerY) * -20;
    const rotateY = (deltaX / centerX) * 20;

    // 直接使用原生DOM操作，避免jQuery的性能开销
    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`;
  }

  /**
   * 处理卡牌鼠标进入事件
   */
  private handleCardMouseEnter(e: JQuery.MouseEnterEvent): void {
    const card = e.currentTarget as HTMLElement;

    // 增强阴影效果
    card.style.boxShadow = '0 25px 50px rgba(0, 0, 0, 0.5)';
    card.style.zIndex = '10';
  }

  /**
   * 处理卡牌鼠标离开事件
   */
  private handleCardMouseLeave(e: JQuery.MouseLeaveEvent): void {
    const card = e.currentTarget as HTMLElement;

    // 重置所有变换
    card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)';
    card.style.boxShadow = '';
    card.style.zIndex = '';
  }
}

/**
 * 卡牌粒子效果管理器
 */
export class CardParticleEffects {
  private static instance: CardParticleEffects;
  private activeParticles: Map<string, any[]> = new Map();

  private constructor() {
    this.initializeParticleEffects();
  }

  public static getInstance(): CardParticleEffects {
    if (!CardParticleEffects.instance) {
      CardParticleEffects.instance = new CardParticleEffects();
    }
    return CardParticleEffects.instance;
  }

  /**
   * 初始化粒子效果
   */
  private initializeParticleEffects(): void {
    // 为传说卡牌添加持续粒子效果
    this.startLegendaryParticles();

    // 为史诗卡牌添加悬停粒子效果
    $(document).on('mouseenter', '.enhanced-card.rarity-Epic', e => {
      this.startEpicHoverParticles($(e.currentTarget));
    });

    $(document).on('mouseleave', '.enhanced-card.rarity-Epic', e => {
      this.stopEpicHoverParticles($(e.currentTarget));
    });

    // 为传说卡牌添加悬停旋涡效果
    $(document).on('mouseenter', '.enhanced-card.rarity-Legendary', e => {
      this.startLegendaryVortexEffect($(e.currentTarget));
    });

    $(document).on('mouseleave', '.enhanced-card.rarity-Legendary', e => {
      this.stopLegendaryVortexEffect($(e.currentTarget));
    });

    // 监听卡牌移除事件，清理粒子效果
    this.setupCardCleanup();
  }

  /**
   * 设置卡牌清理机制
   */
  private setupCardCleanup(): void {
    // 定期检查卡牌是否还存在，清理无效的粒子效果
    setInterval(() => {
      const activeKeys = Array.from(this.activeParticles.keys());
      activeKeys.forEach(key => {
        const cardId = key.replace('-regular', '').replace('-vortex', '');
        const card = $(`.enhanced-card[data-card-id="${cardId}"]`);

        if (!card.length || !card.is(':visible')) {
          // 卡牌不存在或不可见，清理相关粒子效果
          const particles = this.activeParticles.get(key);
          if (particles) {
            particles.forEach(interval => clearInterval(interval));
            this.activeParticles.delete(key);
          }
        }
      });
    }, 1000); // 每秒检查一次
  }

  /**
   * 启动传说卡牌的持续粒子效果
   */
  private startLegendaryParticles(): void {
    // 使用事件委托监听传说卡牌的出现
    $(document).on('DOMNodeInserted', '.enhanced-card.rarity-Legendary', e => {
      this.startSingleLegendaryParticles($(e.target));
    });

    // 为已存在的传说卡牌启动粒子效果
    $('.enhanced-card.rarity-Legendary').each((index, element) => {
      this.startSingleLegendaryParticles($(element));
    });
  }

  /**
   * 为单个传说卡牌启动粒子效果
   */
  private startSingleLegendaryParticles(card: JQuery): void {
    const cardId = card.attr('data-card-id') || 'legendary-regular-' + Date.now();

    // 避免重复启动
    if (this.activeParticles.has(cardId + '-regular')) {
      return;
    }

    const interval = setInterval(() => {
      this.createLegendaryParticle(card);
    }, 200);

    this.activeParticles.set(cardId + '-regular', [interval]);
  }

  /**
   * 创建传说卡牌粒子
   */
  private createLegendaryParticle(card: JQuery): void {
    // 检查卡牌是否仍然存在且可见
    if (!card.length || !card.is(':visible') || !card.offset()) {
      return;
    }

    const cardOffset = card.offset();
    if (!cardOffset) return;

    const particle = $(`
      <div class="legendary-particle" style="
        position: fixed;
        width: 4px;
        height: 4px;
        background: radial-gradient(circle, #fbbf24, #f59e0b);
        border-radius: 50%;
        pointer-events: none;
        z-index: 1000;
        box-shadow: 0 0 6px #f59e0b;
      "></div>
    `);

    // 随机起始位置（卡牌边缘）
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.min(card.outerWidth()!, card.outerHeight()!) / 2;
    const centerX = cardOffset.left + card.outerWidth()! / 2;
    const centerY = cardOffset.top + card.outerHeight()! / 2;
    const startX = centerX + Math.cos(angle) * radius;
    const startY = centerY + Math.sin(angle) * radius;

    particle.css({
      left: startX + 'px',
      top: startY + 'px',
    });

    $('body').append(particle);

    // 粒子动画
    const duration = 2000 + Math.random() * 1000;
    const distance = 50 + Math.random() * 30;

    particle.animate(
      {
        left: startX + Math.cos(angle) * distance + 'px',
        top: startY + Math.sin(angle) * distance + 'px',
        opacity: 0,
      },
      duration,
      function () {
        $(this).remove();
      },
    );
  }

  /**
   * 启动史诗卡牌悬停粒子效果
   */
  private startEpicHoverParticles(card: JQuery): void {
    const cardId = card.attr('data-card-id') || 'epic-' + Date.now();

    const interval = setInterval(() => {
      this.createEpicParticle(card);
    }, 100);

    this.activeParticles.set(cardId, [interval]);
  }

  /**
   * 停止史诗卡牌悬停粒子效果
   */
  private stopEpicHoverParticles(card: JQuery): void {
    const cardId = card.attr('data-card-id') || 'epic-' + Date.now();
    const particles = this.activeParticles.get(cardId);

    if (particles) {
      particles.forEach(interval => clearInterval(interval));
      this.activeParticles.delete(cardId);
    }
  }

  /**
   * 创建史诗卡牌粒子
   */
  private createEpicParticle(card: JQuery): void {
    const cardOffset = card.offset();
    if (!cardOffset) return;

    const particle = $(`
      <div class="epic-particle" style="
        position: fixed;
        width: 3px;
        height: 3px;
        background: radial-gradient(circle, #ef4444, #dc2626);
        border-radius: 50%;
        pointer-events: none;
        z-index: 1000;
        box-shadow: 0 0 4px #dc2626;
      "></div>
    `);

    // 随机起始位置
    const startX = cardOffset.left + Math.random() * card.outerWidth()!;
    const startY = cardOffset.top + Math.random() * card.outerHeight()!;

    particle.css({
      left: startX + 'px',
      top: startY + 'px',
    });

    $('body').append(particle);

    // 粒子动画
    const duration = 1000 + Math.random() * 500;
    const moveX = (Math.random() - 0.5) * 40;
    const moveY = -20 - Math.random() * 20;

    particle.animate(
      {
        left: startX + moveX + 'px',
        top: startY + moveY + 'px',
        opacity: 0,
      },
      duration,
      function () {
        $(this).remove();
      },
    );
  }

  /**
   * 启动传说卡牌旋涡效果
   */
  private startLegendaryVortexEffect(card: JQuery): void {
    const cardId = card.attr('data-card-id') || 'legendary-vortex-' + Date.now();

    // 先停止常规粒子效果
    this.stopLegendaryRegularParticles(card);

    const interval = setInterval(() => {
      this.createVortexParticle(card);
    }, 50); // 更频繁的粒子生成

    this.activeParticles.set(cardId + '-vortex', [interval]);
  }

  /**
   * 停止传说卡牌旋涡效果
   */
  private stopLegendaryVortexEffect(card: JQuery): void {
    const cardId = card.attr('data-card-id') || 'legendary-vortex-' + Date.now();
    const particles = this.activeParticles.get(cardId + '-vortex');

    if (particles) {
      particles.forEach(interval => clearInterval(interval));
      this.activeParticles.delete(cardId + '-vortex');
    }

    // 恢复常规粒子效果
    this.restartLegendaryRegularParticles(card);
  }

  /**
   * 停止传说卡牌常规粒子效果
   */
  private stopLegendaryRegularParticles(card: JQuery): void {
    const cardId = card.attr('data-card-id') || 'legendary-regular-' + Date.now();
    const particles = this.activeParticles.get(cardId + '-regular');

    if (particles) {
      particles.forEach(interval => clearInterval(interval));
      this.activeParticles.delete(cardId + '-regular');
    }
  }

  /**
   * 重启传说卡牌常规粒子效果
   */
  private restartLegendaryRegularParticles(card: JQuery): void {
    const cardId = card.attr('data-card-id') || 'legendary-regular-' + Date.now();

    const interval = setInterval(() => {
      this.createLegendaryParticle(card);
    }, 200);

    this.activeParticles.set(cardId + '-regular', [interval]);
  }

  /**
   * 创建旋涡粒子
   */
  private createVortexParticle(card: JQuery): void {
    // 检查卡牌是否仍然存在且可见
    if (!card.length || !card.is(':visible') || !card.offset()) {
      return;
    }

    const cardOffset = card.offset();
    if (!cardOffset) return;

    const particle = $(`
      <div class="vortex-particle" style="
        position: fixed;
        width: 3px;
        height: 3px;
        background: radial-gradient(circle, #fbbf24, #f59e0b);
        border-radius: 50%;
        pointer-events: none;
        z-index: 1000;
        box-shadow: 0 0 8px #f59e0b;
      "></div>
    `);

    // 从卡牌外围开始，螺旋向中心收缩
    const centerX = cardOffset.left + card.outerWidth()! / 2;
    const centerY = cardOffset.top + card.outerHeight()! / 2;
    const initialRadius = Math.max(card.outerWidth()!, card.outerHeight()!) * 0.8;
    const initialAngle = Math.random() * Math.PI * 2;

    const startX = centerX + Math.cos(initialAngle) * initialRadius;
    const startY = centerY + Math.sin(initialAngle) * initialRadius;

    particle.css({
      left: startX + 'px',
      top: startY + 'px',
    });

    $('body').append(particle);

    // 旋涡动画 - 螺旋收缩到中心
    const duration = 1500;
    const rotations = 3; // 旋转3圈
    let currentTime = 0;
    const animationStep = 16; // 约60fps

    const animate = () => {
      currentTime += animationStep;
      const progress = currentTime / duration;

      if (progress >= 1) {
        particle.remove();
        return;
      }

      // 计算当前位置
      const currentRadius = initialRadius * (1 - progress);
      const currentAngle = initialAngle + rotations * Math.PI * 2 * progress;
      const currentX = centerX + Math.cos(currentAngle) * currentRadius;
      const currentY = centerY + Math.sin(currentAngle) * currentRadius;
      const opacity = 1 - progress;

      particle.css({
        left: currentX + 'px',
        top: currentY + 'px',
        opacity: opacity,
      });

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }
}
