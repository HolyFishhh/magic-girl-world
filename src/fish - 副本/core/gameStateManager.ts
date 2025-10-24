import { inferIntentFromEffect } from '../shared/effectAnalysis';
import { BattlePhase, Card, Enemy, GameState, Player, Relic, StatusEffect } from '../types';

export class GameStateManager {
  private static instance: GameStateManager;
  private gameState: GameState;
  private listeners: Map<string, ((state: GameState) => void)[]> = new Map();

  private constructor() {
    this.initializeEmptyState();
  }

  public static getInstance(): GameStateManager {
    if (!GameStateManager.instance) {
      GameStateManager.instance = new GameStateManager();
    }
    return GameStateManager.instance;
  }

  private initializeEmptyState(): void {
    this.gameState = {
      player: this.createEmptyPlayer(),
      enemy: null,
      currentTurn: 0,
      phase: 'setup',
      isGameOver: false,
      winner: null,
    };
  }

  private createEmptyPlayer(): Player {
    return {
      maxHp: 80,
      currentHp: 80,
      maxLust: 100,
      currentLust: 0,
      energy: 3,
      maxEnergy: 3,
      block: 0,
      statusEffects: [],
      relics: [],
      deck: [],
      hand: [],
      drawPile: [],
      discardPile: [],
      exhaustPile: [],
      drawPerTurn: 5,
      gender: 'Male', // 保留gender，因为start模块还在使用
      corruption: 0, // 保留corruption，因为类型定义还需要
    };
  }

  // 状态获取方法
  public getGameState(): GameState {
    return { ...this.gameState };
  }

  public getPlayer(): Player {
    return { ...this.gameState.player };
  }

  public getEnemy(): Enemy | null {
    const enemy = this.gameState.enemy ? { ...this.gameState.enemy } : null;

    // 如果内存中没有敌人数据，尝试从MVU变量重新加载
    if (!enemy) {
      try {
        const variables = getVariables({ type: 'message' });

        // 🔍 详细的敌人数据恢复调试
        console.log('🔄 ===== 敌人数据恢复调试 =====');
        console.log('📋 当前内存中的gameState.enemy:', this.gameState.enemy);
        console.log('📋 variables?.stat_data?.battle?.enemy:', variables?.stat_data?.battle?.enemy);
        console.log('📋 variables?.battle?.enemy:', variables?.battle?.enemy);

        // 检查多个可能的路径，优先检查variables.battle.enemy
        const mvuEnemy = variables?.battle?.enemy || variables?.stat_data?.battle?.enemy;
        console.log('📋 最终选择的mvuEnemy:', mvuEnemy);

        if (mvuEnemy && mvuEnemy.name) {
          console.log('🔄 从MVU变量恢复敌人数据:', mvuEnemy.name);
          // 重新设置敌人数据
          this.gameState.enemy = {
            id: mvuEnemy.name,
            name: mvuEnemy.name,
            emoji: mvuEnemy.emoji || '👹',
            maxHp: mvuEnemy.max_hp || 100,
            currentHp: mvuEnemy.hp || mvuEnemy.max_hp || 100,
            maxLust: mvuEnemy.max_lust || 100,
            currentLust: mvuEnemy.lust || 0,
            energy: 0,
            maxEnergy: 0,
            block: 0,
            statusEffects: mvuEnemy.status_effects || [],
            intent: this.generateEnemyIntent(mvuEnemy),
            climaxPenalty: mvuEnemy.lust_effect?.effect || '',
            actions: mvuEnemy.actions || [],
            nextAction: null,
            abilities: mvuEnemy.abilities || [],
            dialogue: mvuEnemy.description || '',
            isBoss: false,
            lustEffect: mvuEnemy.lust_effect || {
              name: '欲望爆发',
              description: '敌人欲望达到上限时，对玩家造成额外伤害',
              effect: 'damage:5',
            },
          };
          return { ...this.gameState.enemy };
        }
      } catch (error) {
        console.error('从MVU变量恢复敌人数据失败:', error);
      }
      console.log('🔄 ===== 敌人数据恢复调试结束 =====');
    }

    return enemy;
  }

  public getCurrentPhase(): BattlePhase {
    return this.gameState.phase;
  }

  public isGameOver(): boolean {
    return this.gameState.isGameOver;
  }

  // 状态更新方法
  public updatePlayer(updates: Partial<Player>, options?: { skipAttributeTriggers?: boolean }): void {
    this.gameState.player = { ...this.gameState.player, ...updates };
    this.notifyListeners('player_updated');
  }

  public updateEnemy(updates: Partial<Enemy>, options?: { skipAttributeTriggers?: boolean }): void {
    if (this.gameState.enemy) {
      this.gameState.enemy = { ...this.gameState.enemy, ...updates };
      this.notifyListeners('enemy_updated');
    }
  }

  public setEnemy(enemy: Enemy): void {
    this.gameState.enemy = enemy;
    this.notifyListeners('enemy_set');
  }

  public setPhase(phase: BattlePhase): void {
    this.gameState.phase = phase;
    this.notifyListeners('phase_changed');
  }

  public incrementTurn(): void {
    this.gameState.currentTurn++;
    this.notifyListeners('turn_incremented');
  }

  public setCurrentTurn(turn: number): void {
    this.gameState.currentTurn = turn;
    this.notifyListeners('turn_set');
  }

  public setGameOver(winner: 'player' | 'enemy'): void {
    this.gameState.isGameOver = true;
    this.gameState.winner = winner;
    this.gameState.phase = 'game_over';

    // 不在内存里变更结构；清空写回由统一效果执行器在战斗结束流程中处理
    this.notifyListeners('game_over');
  }

  // 状态效果管理
  public addStatusEffect(target: 'player' | 'enemy', effect: StatusEffect): void {
    const entity = target === 'player' ? this.gameState.player : this.gameState.enemy;
    if (!entity) return;

    const existingIndex = entity.statusEffects.findIndex(e => e.id === effect.id);
    if (existingIndex >= 0) {
      // 叠加现有状态
      entity.statusEffects[existingIndex].stacks += effect.stacks;
      if (effect.duration !== undefined) {
        entity.statusEffects[existingIndex].duration = Math.max(
          entity.statusEffects[existingIndex].duration || 0,
          effect.duration,
        );
      }
    } else {
      // 添加新状态
      entity.statusEffects.push({ ...effect });
    }

    this.notifyListeners(`${target}_status_added`);
  }

  public removeStatusEffect(target: 'player' | 'enemy', effectId: string): void {
    const entity = target === 'player' ? this.gameState.player : this.gameState.enemy;
    if (!entity) return;

    const index = entity.statusEffects.findIndex(e => e.id === effectId);
    if (index >= 0) {
      entity.statusEffects.splice(index, 1);
      this.notifyListeners(`${target}_status_removed`);
    }
  }

  public updateStatusEffect(target: 'player' | 'enemy', effectId: string, updates: Partial<StatusEffect>): void {
    const entity = target === 'player' ? this.gameState.player : this.gameState.enemy;
    if (!entity) return;

    const effect = entity.statusEffects.find(e => e.id === effectId);
    if (effect) {
      Object.assign(effect, updates);
      this.notifyListeners(`${target}_status_updated`);
    }
  }

  // 卡牌管理
  public addCardToHand(card: Card): void {
    this.gameState.player.hand.push({ ...card });
    this.notifyListeners('hand_updated');
  }

  public removeCardFromHand(cardId: string): Card | null {
    const index = this.gameState.player.hand.findIndex(c => c.id === cardId);
    if (index >= 0) {
      const card = this.gameState.player.hand.splice(index, 1)[0];
      this.notifyListeners('hand_updated');
      return card;
    }
    return null;
  }

  public moveCardToDiscard(card: Card): void {
    this.gameState.player.discardPile.push({ ...card });
    this.notifyListeners('discard_updated');
  }

  public moveCardToExhaust(card: Card): void {
    this.gameState.player.exhaustPile.push({ ...card });
    this.notifyListeners('exhaust_updated');
  }

  public drawCardsFromPile(amount: number): Card[] {
    const drawnCards: Card[] = [];

    for (let i = 0; i < amount; i++) {
      // 如果抽牌堆为空，洗牌
      if (this.gameState.player.drawPile.length === 0) {
        this.shuffleDiscardIntoDraw();
      }

      // 如果抽牌堆仍为空，跳出循环
      if (this.gameState.player.drawPile.length === 0) break;

      // 手牌上限检查：超过10则不再抽取，不消耗抽牌堆
      if (this.gameState.player.hand.length >= 10) {
        break;
      }
      const card = this.gameState.player.drawPile.pop()!;
      drawnCards.push(card);
      this.gameState.player.hand.push(card);
    }

    if (drawnCards.length > 0) {
      this.notifyListeners('cards_drawn');
    }

    return drawnCards;
  }

  public shuffleDiscardIntoDraw(): void {
    // 将弃牌堆洗入抽牌堆（使用 Fisher-Yates 洗牌算法保证随机性）
    const shuffled = this.fisherYatesShuffle([...this.gameState.player.discardPile]);
    this.gameState.player.drawPile.push(...shuffled);
    this.gameState.player.discardPile = [];
    this.notifyListeners('deck_shuffled');
  }

  /**
   * Fisher-Yates 洗牌算法（标准洗牌算法，保证均匀随机）
   * 使用增强的随机性确保每次洗牌结果都不同
   */
  private fisherYatesShuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    // 添加时间戳和性能计数器作为额外的随机因子
    const randomSeed = Date.now() * Math.random() * (performance.now() || 1);

    for (let i = shuffled.length - 1; i > 0; i--) {
      // 使用更好的随机数生成，结合时间戳和位置信息增加随机性
      const randomFactor = (Math.random() + randomSeed / (i + 1000)) % 1;
      const j = Math.floor(randomFactor * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  }

  /**
   * 添加卡牌到手牌
   */
  public addCardToHand(card: Card): void {
    // 手牌上限为10；超过上限则忽略本次加入
    if (this.gameState.player.hand.length >= 10) {
      console.log('⚠️ 已达手牌上限(10)，忽略加入手牌的卡牌:', (card as any)?.name || '未知');
      return;
    }
    const newCard = { ...card };
    this.gameState.player.hand.push(newCard);
    this.notifyListeners('card_added_to_hand');
    console.log(`✅ 卡牌加入手牌: ${newCard.name}`);
  }

  /**
   * 添加卡牌到抽牌堆
   */
  public addCardToDeck(card: Card): void {
    const newCard = { ...card };
    // 随机插入到抽牌堆中
    const insertIndex = Math.floor(Math.random() * (this.gameState.player.drawPile.length + 1));
    this.gameState.player.drawPile.splice(insertIndex, 0, newCard);
    this.notifyListeners('card_added_to_deck');
    console.log(`✅ 卡牌加入抽牌堆: ${newCard.name}`);
  }

  // 遗物管理
  public addRelic(relic: Relic): void {
    this.gameState.player.relics.push({ ...relic });
    this.notifyListeners('relic_added');
  }

  public removeRelic(relicId: string): void {
    const index = this.gameState.player.relics.findIndex(r => r.id === relicId);
    if (index >= 0) {
      this.gameState.player.relics.splice(index, 1);
      this.notifyListeners('relic_removed');
    }
  }

  // 事件监听系统
  public addEventListener(event: string, listener: (state: GameState) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  public removeEventListener(event: string, listener: (state: GameState) => void): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index >= 0) {
        eventListeners.splice(index, 1);
      }
    }
  }

  private notifyListeners(event: string): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(listener => listener(this.gameState));
    }

    // 同时触发通用的状态变更事件
    const allListeners = this.listeners.get('state_changed');
    if (allListeners) {
      allListeners.forEach(listener => listener(this.gameState));
    }
  }

  // 持久化相关方法
  public async saveToSillyTavern(): Promise<void> {
    try {
      const gameStateString = JSON.stringify(this.gameState);
      await insertOrAssignVariables({ fishRPG_gameState: gameStateString }, { type: 'character' });
      console.log('游戏状态已保存到 SillyTavern');
    } catch (error) {
      console.error('保存游戏状态失败:', error);
      throw error;
    }
  }

  // 已移除 clearEnemyInMVU：统一在 unifiedEffectExecutor.clearEnemyFromMVU 中按“清空不删除”处理外部变量

  public async loadFromSillyTavern(): Promise<boolean> {
    try {
      // 首次读取：从MVU变量加载战斗数据
      const variables = getVariables({ type: 'message' });

      // 检查多个可能的路径
      const battleData = variables?.stat_data?.battle || variables?.battle;

      // 🔍 完整的变量调试输出
      console.log('🔍 ===== 完整的MVU变量调试信息 =====');
      console.log('📋 variables 根对象:', variables);

      if (variables) {
        console.log('📋 variables 的所有键:', Object.keys(variables));

        // 检查 stat_data
        if (variables.stat_data) {
          console.log('📋 variables.stat_data:', variables.stat_data);
          console.log('📋 stat_data 的所有键:', Object.keys(variables.stat_data));

          // 检查 stat_data.battle
          if (variables.stat_data.battle) {
            console.log('📋 variables.stat_data.battle:', variables.stat_data.battle);
            console.log('📋 stat_data.battle 的所有键:', Object.keys(variables.stat_data.battle));

            // 检查敌人数据
            if (variables.stat_data.battle.enemy) {
              console.log('📋 variables.stat_data.battle.enemy:', variables.stat_data.battle.enemy);
            } else {
              console.log('❌ variables.stat_data.battle.enemy 不存在');
            }
          } else {
            console.log('❌ variables.stat_data.battle 不存在');
          }
        } else {
          console.log('❌ variables.stat_data 不存在');
        }

        // 检查直接的 battle
        if (variables.battle) {
          console.log('📋 variables.battle:', variables.battle);
          console.log('📋 battle 的所有键:', Object.keys(variables.battle));

          if (variables.battle.enemy) {
            console.log('📋 variables.battle.enemy:', variables.battle.enemy);
          } else {
            console.log('❌ variables.battle.enemy 不存在');
          }
        } else {
          console.log('❌ variables.battle 不存在');
        }
      } else {
        console.log('❌ variables 根对象不存在');
      }

      console.log('🔍 ===== MVU变量调试信息结束 =====');

      if (battleData) {
        // 转换MVU数据到GameState格式
        this.convertMVUToGameState(battleData);
        this.notifyListeners('state_loaded');

        // 验证敌人数据是否正确加载
        const enemy = this.getEnemy();
        if (enemy) {
          console.log(`✅ 战斗状态已加载，敌人: ${enemy.name}`);
        } else {
          console.log('⚠️ 战斗状态已加载，但未找到敌人数据');
        }
        return true;
      }

      return false;
    } catch (error) {
      console.error('加载游戏状态失败:', error);
      return false;
    }
  }

  /**
   * 将MVU变量数据转换为GameState格式
   */
  // 规范化 MVU 数组：支持 [valueArray, description]、[[...]]、混合形态，过滤元标记
  private normalizeMVUArray(value: any): any[] {
    // 统一兼容多形态：
    // - [ [ ...items ], 'desc', {extra}, {extra2} ]
    // - [ [ ...items ] ]
    // - [ item1, item2, ... ]
    // - { single }
    // 规则：展开任何嵌套数组；仅保留对象项；过滤元标记/空值；忽略描述性字符串
    if (!value) return [];
    const isMeta = (x: any) => x === '$__META_EXTENSIBLE__$' || x === '[]' || x == null || x === '';

    const out: any[] = [];
    if (Array.isArray(value)) {
      for (const el of value) {
        if (Array.isArray(el)) {
          for (const sub of el) {
            if (!isMeta(sub) && typeof sub === 'object') out.push(sub);
          }
        } else if (typeof el === 'object' && !isMeta(el)) {
          out.push(el);
        } else {
          // 字符串/描述性元素忽略
        }
      }
      return out;
    }
    if (typeof value === 'object') return [value];
    return [];
  }

  public syncNewCardsFromMVU(): void {
    try {
      // 从 MVU 变量读取最新的 cards（兼容 stat_data.battle.cards 与 battle.cards）
      const variables = getVariables({ type: 'message' });
      const rawCards = variables?.battle?.cards || variables?.stat_data?.battle?.cards;
      const mvuCards = this.normalizeMVUArray(rawCards);
      if (!mvuCards || mvuCards.length === 0) return;

      const player = this.gameState.player;
      if (!player) return;

      // 统计当前牌堆系中各 originalId 的数量（不含 player.deck，避免与初始化时的快照重复计算）
      const currentCounts = new Map<string, number>();
      const countCard = (c: any) => {
        const key = c.originalId || c.id || c.name;
        if (!key) return;
        currentCounts.set(key, (currentCounts.get(key) || 0) + 1);
      };
      [...player.hand, ...player.drawPile, ...player.discardPile, ...player.exhaustPile].forEach(countCard);

      // 统计期望数量
      const desiredCounts = new Map<string, { card: any; count: number }>();
      for (const c of mvuCards) {
        if (!c || typeof c !== 'object') continue;
        const key = c.id || c.name;
        if (!key) continue;
        const qty = Math.max(1, Number(c.quantity) || 1);
        const prev = desiredCounts.get(key);
        desiredCounts.set(key, { card: c, count: (prev?.count || 0) + qty });
      }

      // 逐项补齐缺失的卡牌到抽牌堆（随机插入）
      for (const [key, { card, count }] of desiredCounts.entries()) {
        const have = currentCounts.get(key) || 0;
        if (have >= count) continue;
        const need = count - have;
        for (let i = 0; i < need; i++) {
          const one = { ...card, quantity: 1 };
          // 复用现有转换逻辑，生成带 originalId 的实例
          const converted = this.convertCards([one])[0];
          if (converted) {
            this.addCardToDeck(converted);
            console.log(`🔄 同步新卡至抽牌堆: ${converted.name}`);
          }
        }
      }
    } catch (e) {
      console.warn('同步MVU新增卡牌失败:', e);
    }
  }

  private convertMVUToGameState(battleData: any): void {
    const core = battleData.core || {};
    // 尝试从多个可能的路径获取敌人数据
    let enemy = battleData.enemy || null;

    // 如果在battleData中没找到敌人，尝试直接从variables.battle.enemy获取
    if (!enemy) {
      const variables = getVariables({ type: 'message' });
      enemy = variables?.battle?.enemy || null;
      console.log('🔍 从variables.battle.enemy获取敌人数据:', enemy?.name || '未找到');
    }

    // 合并两个来源的卡牌定义：stat_data.battle.cards 与 battle.cards（若存在）
    const cardsStat = this.normalizeMVUArray(battleData.cards);
    let cardsRuntime: any[] = [];
    try {
      const variables2 = getVariables({ type: 'message' });
      cardsRuntime = this.normalizeMVUArray(variables2?.battle?.cards);
    } catch {}
    const mergedCardsMap = new Map<string, any>();
    const put = (c: any) => {
      if (!c || typeof c !== 'object') return;
      const key = c.id || c.name;
      if (!key) return;
      if (!mergedCardsMap.has(key)) mergedCardsMap.set(key, c);
    };
    cardsStat.forEach(put);
    cardsRuntime.forEach(put);
    const cards = Array.from(mergedCardsMap.values());

    const artifacts = this.normalizeMVUArray(battleData.artifacts);
    const playerAbilities = this.normalizeMVUArray(battleData.player_abilities);
    const playerStatusEffects = this.normalizeMVUArray(battleData.player_status_effects);

    // 简化日志输出
    console.log(
      `🔄 转换MVU数据: ${cards.length}张卡牌, ${artifacts.length}个遗物${enemy ? ', 敌人: ' + enemy.name : ', 无敌人'}`,
    );

    // 转换卡牌数据
    const convertedCards = this.convertCards(cards);

    // 更新玩家状态
    this.gameState.player = {
      ...this.gameState.player,
      currentHp: core['hp'] || 80,
      maxHp: 100, // 固定值
      currentLust: core['lust'] || 0,
      maxLust: core['max_lust'] || 100,
      energy: 3, // 战斗中计算，不从MVU读取
      maxEnergy: 3, // 固定值
      block: 0, // 战斗中计算，不从MVU读取
      drawPerTurn: 5, // 固定值，不从MVU读取
      // 设置卡牌数据
      deck: [...convertedCards],
      hand: [], // 手牌在游戏开始时为空，稍后抽取
      drawPile: [], // 先初始化为空，稍后洗牌后填充
      discardPile: [], // 弃牌堆初始为空
      exhaustPile: [], // 消耗堆初始为空
      // 转换遗物数据
      relics: this.convertRelics(artifacts),
      // 设置能力和状态效果
      abilities: playerAbilities || [],
      statusEffects: playerStatusEffects || [],
    };

    // 对所有卡牌进行洗牌后放入抽牌堆
    const shuffledCards = this.fisherYatesShuffle([...convertedCards]);
    this.gameState.player.drawPile = shuffledCards;
    console.log(`🎲 初始化时洗牌完成，抽牌堆共 ${shuffledCards.length} 张`);

    // 抽取起始手牌
    const startingHandSize = this.gameState.player.drawPerTurn;
    const startingHand = this.drawCardsFromPile(startingHandSize);
    this.gameState.player.hand = startingHand; // 设置起始手牌
    console.log(
      `🃏 抽取起始手牌 ${startingHand.length} 张:`,
      startingHand.map(c => c.name),
    );

    // 更新敌人状态
    if (enemy && enemy.name) {
      this.gameState.enemy = {
        id: enemy.name,
        name: enemy.name,
        emoji: enemy.emoji || '👹',
        maxHp: enemy.max_hp || 100,
        currentHp: enemy.hp || enemy.max_hp || 100,
        maxLust: enemy.max_lust || 100,
        currentLust: enemy.lust || 0,
        energy: 0,
        maxEnergy: 0,
        block: 0,
        statusEffects: enemy.status_effects || [],
        intent: this.generateEnemyIntent(enemy),
        climaxPenalty: enemy.lust_effect?.effect || '',
        actions: enemy.actions || [],
        nextAction: null,
        abilities: enemy.abilities || [],
        dialogue: enemy.description || '',
        isBoss: false,
        lustEffect: enemy.lust_effect || {
          name: '欲望爆发',
          description: '敌人欲望达到上限时，对玩家造成额外伤害',
          effect: 'damage:5',
        },
      } as any;

      // 传递行动模式配置（兼容 action_mode / actionMode 与 action_config / actionConfig）
      (this.gameState.enemy as any).actionMode = enemy.action_mode || enemy.actionMode || 'random';
      (this.gameState.enemy as any).actionConfig = enemy.action_config || enemy.actionConfig || {};

      // 初始化敌人意图
      if (this.gameState.enemy.actions && this.gameState.enemy.actions.length > 0) {
        const EnemyIntentManager = require('../modules/enemyIntent').EnemyIntentManager;
        EnemyIntentManager.initializeEnemyIntent(this.gameState.enemy);
      }
    } else {
      // 无法读取敌人数据时的错误处理
      console.error('❌ 无法读取敌人数据！battle.enemy 变量未正确设置');

      // 显示错误提示给用户
      const errorMessage = `
        <div style="color: red; font-weight: bold; padding: 20px; text-align: center; background: #ffe0e0; border: 2px solid red; border-radius: 8px; margin: 20px;">
          <h2>⚠️ 战斗系统错误</h2>
          <p>无法读取敌人数据！</p>
          <p>请确保 battle.enemy 变量已正确设置。</p>
          <p>当前敌人数据：${JSON.stringify(enemy || 'undefined')}</p>
          <p style="font-size: 14px; margin-top: 10px;">请检查AI是否正确生成了敌人信息，或刷新页面重试。</p>
        </div>
      `;

      // 在战斗日志区域显示错误
      const logContainer = document.querySelector('.battle-log-content');
      if (logContainer) {
        logContainer.innerHTML = errorMessage;
      }

      // 在主界面也显示错误
      const mainContainer = document.querySelector('.enemy-info');
      if (mainContainer) {
        mainContainer.innerHTML = errorMessage;
      }

      // 抛出错误以阻止继续执行
      throw new Error('敌人数据未找到或无效。请确保AI已正确生成敌人信息。');
    }

    // 设置战斗数据
    this.gameState.battle = {
      ...battleData,
      player_lust_effect: battleData.player_lust_effect || {
        name: '榨精支配',
        description: '敌人欲望达到上限时，你获得治疗并对敌人施加虚弱',
        effect: 'heal:15,apply_status:enemy:weak:2:2',
      },
    };

    // 保障玩家最大欲望值来自 MVU 核心配置，避免被其他流程意外覆盖
    if (typeof core['max_lust'] === 'number' && core['max_lust'] > 0) {
      this.gameState.player.maxLust = core['max_lust'];
    }

    // 更新游戏状态
    this.gameState.currentTurn = core['回合数'] || 1;
    this.gameState.phase = 'player_turn';

    console.log(`✅ MVU数据转换完成: 回合${this.gameState.currentTurn}`);
  }

  /**
   * 转换卡牌数据
   */
  private convertCards(mvuCards: any[]): any[] {
    const cards: any[] = [];
    let cardIndex = 0;

    mvuCards.forEach(card => {
      if (card && card.id && card.name) {
        // 根据quantity展开卡牌
        const quantity = card.quantity || 1;
        for (let i = 0; i < quantity; i++) {
          const uniqueId = `${card.id}_${cardIndex++}_${Date.now()}`;
          // 兼容多种AI字段命名
          const discardEffect = card.discard_effect || card.discardEffect || card.on_discard || card.onDiscard || '';
          cards.push({
            id: uniqueId,
            originalId: card.id,
            name: card.name,
            emoji: card.emoji || '🃏',
            type: card.type || 'Skill',
            rarity: card.rarity || 'Common',
            cost: card.cost || 0,
            description: card.description || '',
            effect: card.effect || '',
            discard_effect: discardEffect, // 保留弃牌效果（兼容多命名）
            retain: card.retain || false,
            exhaust: card.exhaust || false,
            ethereal: card.ethereal || false,
          });
        }
      }
    });

    // 简化日志输出
    console.log(`🃏 转换了 ${cards.length} 张卡牌`);
    return cards;
  }

  /**
   * 转换遗物数据
   */
  private convertRelics(mvuArtifacts: any[]): any[] {
    const relics: any[] = [];

    mvuArtifacts.forEach(artifact => {
      if (artifact && artifact.id && artifact.name) {
        relics.push({
          id: artifact.id,
          name: artifact.name,
          emoji: artifact.emoji || '🔮',
          description: artifact.description || '',
          effect: artifact.effect || '',
          rarity: 'Common', // MVU中没有稀有度信息，默认为Common
        });
      }
    });

    console.log(`🔮 转换了 ${relics.length} 个遗物`);
    return relics;
  }

  /**
   * 生成敌人意图
   */
  private generateEnemyIntent(enemy: any): any {
    if (enemy.actions && enemy.actions.length > 0) {
      // 根据actionMode选择行动
      let selectedAction = null;

      if (enemy.actionMode === 'probability' && enemy.actionConfig) {
        // 概率模式：根据权重随机选择
        const totalWeight = Object.values(enemy.actionConfig).reduce(
          (sum: number, weight: any) => sum + (weight || 0),
          0,
        );
        let random = Math.random() * totalWeight;

        for (const [actionName, weight] of Object.entries(enemy.actionConfig)) {
          random -= (weight as number) || 0;
          if (random <= 0) {
            selectedAction = enemy.actions.find((action: any) => action.name === actionName);
            break;
          }
        }
      } else {
        // 默认随机模式
        selectedAction = enemy.actions[Math.floor(Math.random() * enemy.actions.length)];
      }

      if (selectedAction) {
        return {
          type: this.getIntentType(selectedAction.effect),
          description: selectedAction.description || selectedAction.name,
          emoji: this.getIntentEmoji(selectedAction.effect),
        };
      }
    }

    return {
      type: 'attack',
      description: '准备行动',
      emoji: '❓',
    };
  }

  /**
   * 根据效果字符串判断意图类型
   */
  private getIntentType(effect: string): 'attack' | 'defend' | 'buff' | 'debuff' | 'special' {
    const summary = inferIntentFromEffect(effect || '');
    switch (summary.type) {
      case 'attack':
      case 'lust_attack':
        return 'attack';
      case 'defend':
        return 'defend';
      case 'buff':
        return 'buff';
      case 'debuff':
        return 'debuff';
      default:
        return 'special';
    }
  }

  /**
   * 根据效果字符串获取意图图标
   */
  private getIntentEmoji(effect: string): string {
    if (!effect) return '❓';

    if (effect.includes('damage:')) {
      return '⚔️';
    } else if (effect.includes('lust_damage:')) {
      return '💋';
    } else if (effect.includes('block:')) {
      return '🛡️';
    } else if (effect.includes('apply_status:')) {
      return '🎯';
    } else {
      return '❓';
    }
  }

  // 状态重置
  public resetGame(): void {
    this.initializeEmptyState();
    this.notifyListeners('game_reset');
  }

  // 快照和回滚功能
  private snapshots: Map<string, GameState> = new Map();

  public createSnapshot(name: string): void {
    this.snapshots.set(name, JSON.parse(JSON.stringify(this.gameState)));
  }

  public restoreSnapshot(name: string): boolean {
    const snapshot = this.snapshots.get(name);
    if (snapshot) {
      this.gameState = JSON.parse(JSON.stringify(snapshot));
      this.notifyListeners('snapshot_restored');
      return true;
    }
    return false;
  }

  public deleteSnapshot(name: string): void {
    this.snapshots.delete(name);
  }

  /**
   * 清除临时修饰符（每回合结束时调用）
   */
  public clearTemporaryModifiers(): void {
    console.log('🧹 清除临时修饰符...');

    // 需要清除的临时修饰符列表
    const temporaryModifiers = ['draw', 'discard', 'energy_gain', 'card_play_limit'];

    // 清除玩家的临时修饰符
    const player = this.gameState.player;
    if (player.modifiers) {
      const updatedModifiers = { ...player.modifiers };
      temporaryModifiers.forEach(modifier => {
        if (updatedModifiers[modifier] !== undefined) {
          console.log(`  移除玩家临时修饰符: ${modifier} = ${updatedModifiers[modifier]}`);
          delete updatedModifiers[modifier];
        }
      });
      this.updatePlayer({ modifiers: updatedModifiers });
    }

    // 清除敌人的临时修饰符
    const enemy = this.gameState.enemy;
    if (enemy && enemy.modifiers) {
      const updatedModifiers = { ...enemy.modifiers };
      temporaryModifiers.forEach(modifier => {
        if (updatedModifiers[modifier] !== undefined) {
          console.log(`  移除敌人临时修饰符: ${modifier} = ${updatedModifiers[modifier]}`);
          delete updatedModifiers[modifier];
        }
      });
      this.updateEnemy({ modifiers: updatedModifiers });
    }

    console.log('✅ 临时修饰符已清除');
  }
}
