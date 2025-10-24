/**
 * 统一效果执行器 - 执行解析后的效果表达式
 *
 * 负责：
 * 1. 执行各种类型的效果表达式
 * 2. 处理动态状态效果
 * 3. 触发动画和日志
 * 4. 管理效果的副作用和连锁反应
 */

import { GameStateManager } from '../core/gameStateManager';
import { BattleLog } from '../modules/battleLog';
import { RelicEffectManager } from '../modules/relicEffectManager';
import { Card, Enemy, Player, StatusEffect } from '../types';
import { AnimationManager } from '../ui/animationManager';
import { LustOverflowDisplay } from '../ui/lustOverflowDisplay';
import { CardSystem } from './cardSystem';
import { DynamicStatusDefinition, DynamicStatusManager } from './dynamicStatusManager';
import { getAttributePriority, isValidTrigger, PLAYER_ONLY_ATTRIBUTES_SET } from './effectDefinitions';
import { EffectExpression, UnifiedEffectParser } from './unifiedEffectParser';

export class UnifiedEffectExecutor {
  private static instance: UnifiedEffectExecutor;
  private gameStateManager: GameStateManager;
  private animationManager: AnimationManager;
  private lustOverflowDisplay: LustOverflowDisplay;
  private parser: UnifiedEffectParser;
  private dynamicStatusManager: DynamicStatusManager;
  private _relicEffectManager?: RelicEffectManager;
  private _cardSystem?: CardSystem;
  // 控制台详细日志开关（默认关闭，减少噪音）
  private verbose: boolean = false;

  // 执行上下文
  private executionContext: {
    sourceIsPlayer: boolean;
    targetType?: 'player' | 'enemy';
    triggerType?: string;
    cardContext?: any;
    battleContext?: any;
    isRelicEffect?: boolean;
    statusContext?: any;
    currentCard?: any;
    energyBeforeCardPlay?: number;
    abilityContext?: any;
  } = { sourceIsPlayer: false };

  // 当前正在执行的表达式（用于在子处理阶段访问解析附加信息，如卡牌数量）
  private currentExpression: EffectExpression | null = null;

  // 延迟死亡检查标记（确保效果完全执行后再处理死亡）
  private pendingDeaths: Set<'player' | 'enemy'> = new Set();

  private constructor() {
    this.gameStateManager = GameStateManager.getInstance();
    this.animationManager = AnimationManager.getInstance();
    this.lustOverflowDisplay = LustOverflowDisplay.getInstance();
    this.parser = UnifiedEffectParser.getInstance();
    this.dynamicStatusManager = DynamicStatusManager.getInstance();
    // 不在构造函数中初始化 relicEffectManager，避免循环依赖
  }

  /**
   * 延迟获取 RelicEffectManager 实例，避免循环依赖
   */
  private get relicEffectManager(): RelicEffectManager {
    if (!this._relicEffectManager) {
      this._relicEffectManager = RelicEffectManager.getInstance();
    }
    return this._relicEffectManager;
  }

  /**
   * 延迟获取 CardSystem 实例，避免循环依赖
   */
  private get cardSystem(): CardSystem {
    if (!this._cardSystem) {
      this._cardSystem = CardSystem.getInstance();
    }
    return this._cardSystem;
  }

  public static getInstance(): UnifiedEffectExecutor {
    if (!UnifiedEffectExecutor.instance) {
      UnifiedEffectExecutor.instance = new UnifiedEffectExecutor();
    }
    return UnifiedEffectExecutor.instance;
  }

  /**
   * 设置卡牌使用前的能量值（用于卡牌效果计算）
   */
  public setCardPlayEnergy(energy: number): void {
    this.executionContext.energyBeforeCardPlay = energy;
  }

  /**
   * 清除卡牌使用前的能量值
   */
  public clearCardPlayEnergy(): void {
    this.executionContext.energyBeforeCardPlay = undefined;
  }

  /**
   * 执行效果字符串
   */
  public async executeEffectString(effectString: string, sourceIsPlayer: boolean, context?: any): Promise<void> {
    // 简化日志输出

    // 设置执行上下文，合并而不是覆盖，并防止 context 覆盖 sourceIsPlayer
    const sanitizedContext = { ...(context || {}) } as any;
    if (sanitizedContext && typeof sanitizedContext === 'object' && 'sourceIsPlayer' in sanitizedContext) {
      delete sanitizedContext.sourceIsPlayer;
    }
    // 每次执行前重置上下文，避免上一次调用的 statusContext/triggerType 等污染本次解析
    this.executionContext = {
      sourceIsPlayer,
      ...sanitizedContext,
    };

    // 清除之前的待处理死亡标记
    this.pendingDeaths.clear();

    try {
      // 解析效果表达式
      const expressions = this.parser.parseEffectString(effectString);

      // 过滤无效表达式并记录错误
      const validExpressions = expressions.filter(expr => {
        if (!expr.isValid) {
          console.warn('跳过无效表达式:', expr.raw, expr.errorMessage);
          return false;
        }
        return true;
      });

      // 按优先级排序执行
      const sortedExpressions = this.sortExpressionsByPriority(validExpressions);

      // 如果是卡牌效果，一次性记录所有效果
      if (this.executionContext.cardContext) {
        const sourceInfo = this.getEffectSourceInfo();
        const entityName = sourceInfo?.entityName || (sourceIsPlayer ? '玩家' : '敌人');
        const cardName = this.executionContext.cardContext.name || '未知卡牌';
        const effectDescList = sortedExpressions.map(expr => expr.description || expr.raw);
        const effectDesc = effectDescList.join('，');
        const logMessage = `${entityName}卡牌: 使用了卡牌 ${cardName}，执行效果: ${effectDesc}`;
        BattleLog.addLog(logMessage, 'action', sourceInfo?.logSource);
      }

      // 逐个执行表达式
      for (const expression of sortedExpressions) {
        this.currentExpression = expression;
        await this.executeExpression(expression);
      }
      this.currentExpression = null;

      // 所有效果执行完毕后，检查是否有待处理的死亡
      await this.processPendingDeaths();
    } catch (error) {
      console.error('执行效果字符串失败:', effectString, error);
      throw error; // 重新抛出错误，让上层处理
    }
  }

  /**
   * 执行单个表达式
   */
  private async executeExpression(expression: EffectExpression): Promise<void> {
    try {
      // 对于卡牌效果和状态效果，已经有合并或专用日志，这里不再重复记录
      if (!this.executionContext.cardContext && !this.executionContext.statusContext) {
        // 简化日志，只记录到战斗日志
        // 生成带来源的日志信息
        const sourceInfo = this.getEffectSourceInfo();
        const sourcePrefix = sourceInfo ? `${sourceInfo.entityName}-${sourceInfo.sourceName}` : '';
        const effectDesc = expression.description || expression.raw;
        const logMessage = sourcePrefix ? `${sourcePrefix}执行效果：${effectDesc}` : `执行效果: ${effectDesc}`;

        BattleLog.addLog(logMessage, 'action', sourceInfo?.logSource);
      }

      // 特殊处理 ALL 目标：分别对玩家和敌人执行效果
      if (expression.target === 'ALL') {
        console.log('🎯 检测到ALL目标，将分别对玩家和敌人执行效果');

        // 创建两个副本，分别设置为 ME 和 OP 目标
        const playerExpression = { ...expression, target: 'ME' as 'ME' | 'OP' | 'ALL' };
        const enemyExpression = { ...expression, target: 'OP' as 'ME' | 'OP' | 'ALL' };

        // 先对玩家执行
        await this.executeExpression(playerExpression);
        // 再对敌人执行
        await this.executeExpression(enemyExpression);

        return;
      }

      // 处理条件表达式
      if (expression.isConditional) {
        await this.executeConditionalExpression(expression);
        return;
      }

      // 检查是否是带触发条件的效果（应该作为能力添加）
      // 遗物上下文中，直接执行括号内效果而不是注册为能力
      if (expression.prefix && this.isValidTriggerPrefix(expression.prefix)) {
        if (this.executionContext.isRelicEffect) {
          // passive 效果不执行，会在计算修饰符时自动读取
          if (expression.prefix === 'passive') {
            if (this.verbose) console.log('🔮 遗物passive效果，跳过执行（会在计算修饰符时自动读取）');
            return;
          }

          // 从 ability 定义中提取括号内内容并直接执行
          const abilityString = expression.value?.toString?.() || '';
          const innerMatch = abilityString.match(/^([\w_]+)\((.*)\)$/);
          if (innerMatch) {
            const innerEffects = innerMatch[2];
            if (this.verbose) console.log('🔮 遗物上下文，直接执行触发内效果:', innerEffects);
            await this.executeEffectString(innerEffects, this.executionContext.sourceIsPlayer, this.executionContext);
            return;
          }
        }
        if (this.verbose) console.log('🔮 检测到触发条件效果，作为能力添加:', expression.raw);
        BattleLog.addLog(`添加能力: ${expression.raw}`, 'system');

        // 解析能力的实际目标，而不是直接使用源发动者
        const abilityTargetType = this.resolveAbilityTarget(expression);
        console.log(`🎯 能力目标解析: ${expression.raw} -> ${abilityTargetType}`);

        await this.addAbility(abilityTargetType, expression.raw);
        return;
      }

      // 根据属性类型分发执行
      if (this.verbose) console.log('🔍 检查属性定义:', expression.attribute, 'target:', expression.target);
      const attrDef = this.parser.getAttributeDefinition(expression.attribute);
      if (!attrDef) {
        console.warn('⚠️ 未知属性:', expression.attribute);
        console.warn('🔍 完整表达式:', expression);
        BattleLog.addLog(`未知属性: ${expression.attribute}`, 'system');
        return;
      }

      switch (attrDef.category) {
        case 'basic':
          await this.executeBasicAttributeEffect(expression);
          break;
        case 'modifier':
          await this.executeModifierEffect(expression);
          break;
        case 'status':
          await this.executeStatusEffect(expression);
          break;
        case 'ability':
          await this.executeAbilityEffect(expression);
          break;
        case 'card':
          await this.executeCardEffect(expression);
          break;
        case 'special':
          await this.executeSpecialEffect(expression);
          break;
        default:
          console.warn('未知属性类别:', attrDef.category);
      }
    } catch (error) {
      console.error('执行表达式失败:', expression, error);
    }
  }

  /**
   * 执行修饰符效果
   */
  private async executeModifierEffect(expression: EffectExpression): Promise<void> {
    const targetType = this.resolveTarget(expression.target, expression.attribute);
    const entity = this.getEntity(targetType);

    if (!entity) {
      console.warn('⚠️ 目标实体不存在:', targetType);
      BattleLog.addLog(`目标实体不存在: ${targetType}`, 'system');
      return;
    }

    const { attribute, operator, value } = expression;
    let numValue: number;

    if (typeof value === 'number') {
      numValue = value;
    } else if (expression.isVariableReference) {
      // 处理变量引用或表达式
      numValue = this.calculateDynamicValue(value as string, targetType);
    } else {
      // 尝试解析为数值
      numValue = parseFloat(value as string);
      if (isNaN(numValue)) {
        console.warn('⚠️ 无效的数值:', value);
        BattleLog.addLog(`无效的数值: ${value}`, 'system');
        return;
      }
    }

    // 获取当前修饰符值
    const currentValue = this.getCurrentAttributeValue(entity, attribute);
    const newValue = this.calculateNewValue(currentValue, operator, numValue);

    // 应用修饰符变化
    await this.applyAttributeChange(targetType, attribute, newValue, entity);

    const targetName = targetType === 'player' ? '我方' : '对方';
    const attrName = this.getAttributeDisplayName(attribute);

    if (this.verbose) console.log(`✅ 修饰符变化: ${targetType}.${attribute} ${operator} ${numValue} = ${newValue}`);
    // 只在修饰符有显著变化时记录日志
    if (Math.abs(newValue - currentValue) >= 1) {
      BattleLog.addLog(`${targetName}的${attrName}: ${currentValue} ${operator} ${numValue} = ${newValue}`, 'info');
    }
  }

  /**
   * 执行条件表达式
   */
  private async executeConditionalExpression(expression: EffectExpression): Promise<void> {
    if (!expression.isConditional || !expression.condition) {
      console.error('❌ 无效的条件表达式');
      return;
    }

    try {
      const conditionResult = this.evaluateCondition(expression.condition);

      let effectToExecute: string;

      if (conditionResult) {
        if (!expression.trueEffect || expression.trueEffect.trim() === '') {
          return;
        }
        effectToExecute = expression.trueEffect;
      } else {
        if (!expression.falseEffect || expression.falseEffect.trim() === '') {
          return;
        }
        effectToExecute = expression.falseEffect;
      }

      // 执行选中的效果，并传递当前上下文（但不传递条件评估上下文）
      const contextForExecution = { ...this.executionContext };
      delete contextForExecution.triggerType; // 移除条件评估标记

      await this.executeEffectString(effectToExecute, this.executionContext.sourceIsPlayer, contextForExecution);
    } catch (error) {
      console.error('条件表达式执行失败:', error);
    }
  }

  /**
   * 评估条件表达式
   */
  private evaluateCondition(condition: string): boolean {
    try {
      // 设置条件评估上下文
      const originalTriggerType = this.executionContext.triggerType;
      this.executionContext.triggerType = 'condition_evaluation';

      // 替换条件中的变量为实际值
      let processedCondition = condition;

      // 先处理 stacks 二次指向（ME.stacks.buffid, OP.stacks.buffid, ALL.stacks.buffid）
      const stacksPattern = /(ME|OP|ALL)\.stacks\.(\w+)/g;
      processedCondition = processedCondition.replace(stacksPattern, (match, targetPrefix, stacksTarget) => {
        const stacksValue = this.resolveStacksReference(targetPrefix as 'ME' | 'OP' | 'ALL', stacksTarget);
        if (this.verbose) console.log(`🔄 条件stacks变量 ${match} -> ${stacksValue}`);
        return stacksValue.toString();
      });

      // 再处理普通变量引用（ME.属性、OP.属性和独立变量）
      const variablePattern = /(ME|OP|ALL)\.([a-zA-Z_][a-zA-Z0-9_]*)|([a-zA-Z_][a-zA-Z0-9_]*)/g;

      processedCondition = processedCondition.replace(variablePattern, (match, prefix, attribute, standalone) => {
        // 跳过已经被处理过的 stacks 引用
        if (attribute === 'stacks') {
          return match;
        }

        let targetType: 'player' | 'enemy';
        let varName: string;

        if (prefix && attribute) {
          // ME.属性 或 OP.属性 格式
          if (prefix === 'ME') {
            targetType = this.executionContext.sourceIsPlayer ? 'player' : 'enemy';
          } else if (prefix === 'OP') {
            targetType = this.executionContext.sourceIsPlayer ? 'enemy' : 'player';
          } else if (prefix === 'ALL') {
            // ALL 在条件中不适用，使用玩家的值作为默认
            console.warn('条件判断中不支持ALL目标，使用玩家值');
            targetType = 'player';
          } else {
            return match;
          }
          varName = attribute;
        } else if (standalone) {
          // 独立变量名
          varName = standalone;
          if (PLAYER_ONLY_ATTRIBUTES_SET.has(varName)) {
            targetType = 'player';
          } else {
            targetType = this.executionContext.sourceIsPlayer ? 'player' : 'enemy';
          }
        } else {
          return match;
        }

        const gameState = this.gameStateManager.getGameState();
        const entity = targetType === 'player' ? (gameState as any).player : (gameState as any).enemy;

        if (!entity) {
          console.warn(`无法获取实体: ${targetType}`);
          return '0';
        }

        const value = this.getVariableValue(varName, entity);
        if (this.verbose)
          console.log(`🔄 条件变量 ${match} -> ${value} (${targetType === 'player' ? '玩家' : '敌人'})`);
        const safeValue = Number.isFinite(value) ? value : 0;
        return safeValue.toString();
      });

      // 使用安全的条件求值
      const result = this.evaluateConditionExpression(processedCondition);
      if (this.verbose) console.log(`计算条件: ${condition} -> ${processedCondition} = ${result}`);

      // 恢复原始上下文
      this.executionContext.triggerType = originalTriggerType;

      return result;
    } catch (error) {
      console.error('条件评估失败:', error, '条件:', condition);

      // 恢复原始上下文
      const originalTriggerType = this.executionContext.triggerType;
      this.executionContext.triggerType = originalTriggerType;

      return false;
    }
  }

  /**
   * 安全的条件表达式求值
   */
  private evaluateConditionExpression(expression: string): boolean {
    // 清理表达式，移除空格
    const cleanExpression = expression.replace(/\s+/g, ' ').trim();

    // 归一化全角/数学符号
    const normalized = cleanExpression.replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/＝/g, '=').replace(/≠/g, '!=');

    // 验证表达式只包含数字、比较运算符、布尔运算符和括号
    if (!/^[0-9+\-*/.()>=<!&| ]+$/.test(normalized)) {
      throw new Error(`不安全的条件表达式: ${expression}`);
    }

    try {
      // 分阶段替换，避免将 === 变成 ==== 的边界问题
      let jsExpression = normalized;
      jsExpression = jsExpression.replace(/===/g, '§EQ3§').replace(/!==/g, '§NEQ3§');
      jsExpression = jsExpression.replace(/==/g, '§EQ2§').replace(/!=/g, '§NEQ2§');
      // 仅替换单个 =（前后都不是 =，且前一位也不能是比较符号）
      jsExpression = jsExpression.replace(/(?<![><!=])=(?![=])/g, '§EQ1§');
      // 还原占位并统一为严格比较
      jsExpression = jsExpression
        .replace(/§EQ3§/g, '===')
        .replace(/§NEQ3§/g, '!==')
        .replace(/§EQ2§|§EQ1§/g, '===')
        .replace(/§NEQ2§/g, '!==');

      // 使用Function构造器安全求值
      const result = new Function(`"use strict"; return (${jsExpression})`)();

      if (typeof result !== 'boolean') {
        throw new Error(`条件表达式结果不是布尔值: ${result}`);
      }

      return result;
    } catch (error) {
      console.error('条件表达式求值失败:', error);
      return false;
    }
  }

  /**
   * 清理实体的直接修饰符（用于状态移除时的清理）
   */
  private clearDirectModifiers(entity: Player | Enemy, statusId: string): void {
    // 这个方法用于清理由特定状态直接设置的修饰符
    // 检查状态定义是否有设置修饰符的效果
    const statusDef = this.dynamicStatusManager.getStatusDefinition(statusId);
    if (!statusDef || !(entity as any).modifiers) {
      return;
    }

    const modifierAttributes = [
      'damage_modifier',
      'damage_taken_modifier',
      'lust_damage_modifier',
      'lust_damage_taken_modifier',
      'heal_modifier',
      'block_modifier',
      'draw',
      'discard',
      'energy_gain',
      'card_play_limit',
    ];

    // 检查状态的所有触发器，看是否有设置修饰符的效果
    const triggers = statusDef?.triggers || {};
    // 兼容新的变量结构：触发器现在是字符串而不是数组
    const applyEffects = triggers.apply ? (Array.isArray(triggers.apply) ? triggers.apply : [triggers.apply]) : [];
    const tickEffects = triggers.tick ? (Array.isArray(triggers.tick) ? triggers.tick : [triggers.tick]) : [];
    const allEffects = [...applyEffects, ...tickEffects];

    const modifiersToRemove: string[] = [];

    for (const effect of allEffects) {
      for (const modifier of modifierAttributes) {
        if (effect.includes(modifier)) {
          modifiersToRemove.push(modifier);
        }
      }
    }

    // 清理相关的直接修饰符
    if (modifiersToRemove.length > 0) {
      const modifiers = { ...(entity as any).modifiers };
      let hasChanges = false;

      for (const modifier of modifiersToRemove) {
        if (modifiers[modifier] !== undefined) {
          console.log(`🧹 清理直接修饰符: ${modifier} = ${modifiers[modifier]} (来自状态: ${statusId})`);
          delete modifiers[modifier];
          hasChanges = true;
        }
      }

      if (hasChanges) {
        // 更新实体的修饰符
        const updateData: any = { modifiers };
        if (entity === this.gameStateManager.getPlayer()) {
          this.gameStateManager.updatePlayer(updateData);
        } else {
          this.gameStateManager.updateEnemy(updateData);
        }
        console.log(`✅ 已清理状态 "${statusId}" 的直接修饰符`);
      }
    }
  }

  /**
   * 执行基础属性效果
   */
  private async executeBasicAttributeEffect(expression: EffectExpression): Promise<void> {
    const targetType = this.resolveTarget(expression.target, expression.attribute);

    // 每次执行效果时都获取最新的实体状态，确保动态变量计算正确
    let entity = this.getEntity(targetType);

    if (!entity) {
      console.warn('目标实体不存在:', targetType);
      return;
    }

    // 添加debug日志
    console.log(`🎯 执行基础属性效果: ${expression.raw}`);
    console.log(
      `   目标: ${targetType}, 属性: ${expression.attribute}, 操作符: ${expression.operator}, 值: ${expression.value}`,
    );

    const { attribute, operator, value } = expression;
    let modifiedValue: number;

    // 处理变量引用、数学表达式和特殊值 - 动态获取最新值
    if (typeof expression.value === 'string') {
      // 检查是否是数学表达式（包含运算符）
      if (this.isMathExpression(expression.value)) {
        modifiedValue = this.calculateDynamicValue(expression.value, targetType);
        console.log(`动态计算表达式 ${expression.value}: ${modifiedValue} (目标: ${targetType})`);
      } else if (expression.isVariableReference) {
        // 检查是否是带前缀的变量（如 ME.block, OP.hp）
        if (typeof expression.value === 'string' && /^(ME|OP)\./.test(expression.value)) {
          // 带前缀的变量使用 calculateDynamicValue 处理
          modifiedValue = this.calculateDynamicValue(expression.value, targetType);
          console.log(`动态解析带前缀变量 ${expression.value}: ${modifiedValue} (目标: ${targetType})`);
        } else {
          // 检查是否是 stacks 二次指向或其他复杂引用
          const valueStr = expression.value as string;
          if (valueStr.includes('.stacks.') || valueStr.includes('ALL.')) {
            // 使用 calculateDynamicValue 处理复杂引用
            modifiedValue = this.calculateDynamicValue(valueStr, targetType);
            console.log(`动态计算复杂引用 ${valueStr}: ${modifiedValue} (目标: ${targetType})`);
          } else {
            // 简单变量名使用 resolveVariableReference 处理
            entity = this.getEntity(targetType); // 重新获取最新状态
            if (!entity) {
              console.warn('无法获取最新实体状态:', targetType);
              return;
            }
            modifiedValue = this.resolveVariableReference(valueStr, entity);
            console.log(`动态解析变量引用 ${valueStr}: ${modifiedValue} (目标: ${targetType})`);
          }
        }
      } else {
        // 尝试解析为数值
        const numValue = parseFloat(expression.value);
        if (isNaN(numValue)) {
          // 尝试按动态数学表达式求值（包含变量）
          if (typeof expression.value === 'string' && this.isMathExpression(expression.value)) {
            modifiedValue = this.calculateDynamicValue(expression.value, targetType);
            console.log(`动态计算表达式 ${expression.value}: ${modifiedValue} (目标: ${targetType})`);
          } else {
            console.warn('无效的数值:', value);
            return;
          }
        }
        modifiedValue = numValue;
      }
    } else {
      // 普通数值处理
      const numValue = typeof value === 'number' ? value : parseFloat(value as string);
      if (isNaN(numValue)) {
        console.warn('无效的数值:', value);
        return;
      }
      modifiedValue = numValue;
    }

    // 重新获取最新的实体状态，确保currentValue计算正确
    entity = this.getEntity(targetType);
    if (!entity) {
      console.warn('无法获取最新实体状态（计算currentValue时）:', targetType);
      return;
    }
    const currentValue = this.getCurrentAttributeValue(entity, attribute);

    // 对伤害和治疗应用修饰符
    const targetName = targetType === 'player' ? '我方' : '对方';
    if (attribute === 'hp' && operator === '-') {
      // 伤害：应用攻击者的damage_modifier和受害者的damage_taken_modifier
      const sourceEntity = this.getSourceEntity();
      if (sourceEntity) {
        modifiedValue = this.applyComplexModifiers(sourceEntity, 'damage_modifier', modifiedValue, '伤害修饰符');
      }

      // 应用受害者的受伤害修饰符
      modifiedValue = this.applyComplexModifiers(
        entity,
        'damage_taken_modifier',
        modifiedValue,
        `${targetName}受伤害修饰符`,
      );
    } else if (attribute === 'lust' && operator === '+') {
      // 欲望伤害：应用攻击者的lust_damage_modifier和受害者的lust_damage_taken_modifier
      const sourceEntity = this.getSourceEntity();
      if (sourceEntity) {
        modifiedValue = this.applyComplexModifiers(
          sourceEntity,
          'lust_damage_modifier',
          modifiedValue,
          '欲望伤害修饰符',
        );
      }

      // 应用受害者的受欲望伤害修饰符
      modifiedValue = this.applyComplexModifiers(
        entity,
        'lust_damage_taken_modifier',
        modifiedValue,
        `${targetName}受欲望伤害修饰符`,
      );
    } else if (attribute === 'block' && operator === '+') {
      // 格挡：应用格挡修饰符
      modifiedValue = this.applyComplexModifiers(entity, 'block_modifier', modifiedValue, `${targetName}格挡修饰符`);
    }

    // 护盾/格挡结算：在计算HP伤害前先用block抵消
    if (attribute === 'hp' && operator === '-') {
      const incoming = Math.max(0, Number(modifiedValue) || 0);
      const currentBlock = (entity as any).block || 0;
      if (incoming > 0 && currentBlock > 0) {
        const blockUsed = Math.min(currentBlock, incoming);
        const remaining = incoming - blockUsed;
        const newBlock = currentBlock - blockUsed;

        // 更新目标的格挡值
        if (targetType === 'player') {
          this.gameStateManager.updatePlayer({ block: newBlock });
        } else {
          this.gameStateManager.updateEnemy({ block: newBlock });
        }

        // 显示格挡抵消数字（蓝色，从格挡位置弹出）
        try {
          this.animationManager.showDamageNumber(targetType, blockUsed, 'block');
        } catch (e) {
          console.warn('显示格挡抵消动画失败:', e);
        }

        // 触发失去格挡的触发器（受到攻击时）
        await this.processAbilitiesByTrigger(targetType, 'lose_block');

        // 使用抵消后的伤害
        modifiedValue = remaining;
      }
    }

    const newValue = this.calculateNewValue(currentValue, operator, modifiedValue);
    const clampedValue = this.clampAttributeValue(attribute, newValue, entity, targetType);
    // 统一四舍五入到1位小数，避免过多小数
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const finalValue = round1(clampedValue);

    // 添加详细的计算日志（四舍五入到1位小数）
    console.log(
      `💻 计算结果: ${round1(currentValue)} ${operator} ${round1(modifiedValue)} = ${round1(newValue)}, 限制后: ${finalValue}`,
    );

    // 应用变化
    await this.applyAttributeChange(targetType, attribute, finalValue, entity);

    // 触发效果
    await this.triggerAttributeChangeEffects(targetType, attribute, finalValue, currentValue, entity);
  }

  /**
   * 执行状态效果
   */
  private async executeStatusEffect(expression: EffectExpression): Promise<void> {
    const targetType = this.resolveTarget(expression.target, expression.attribute);

    if (expression.operator === 'apply') {
      // 施加状态
      let statusId: string;
      let stacks: number = 1;

      if (typeof expression.value === 'string') {
        const valueStr = expression.value;

        // 检查是否包含空格，空格通常意味着 "statusId stacks" 格式
        if (valueStr.includes(' ')) {
          const parts = valueStr.split(/\s+/);
          statusId = parts[0];
          const stacksStr = parts.slice(1).join(' ');

          console.log(`📊 解析状态施加: statusId="${statusId}", stacksStr="${stacksStr}"`);

          // 检查是否是表达式或变量引用
          if (
            stacksStr.includes('.') ||
            stacksStr.includes('/') ||
            stacksStr.includes('*') ||
            stacksStr.includes('+') ||
            stacksStr.includes('-')
          ) {
            // 动态计算stacks值
            console.log(`🔢 动态计算stacks值: ${stacksStr} (targetType=${targetType})`);
            const calculatedStacks = this.calculateDynamicValue(stacksStr, targetType);
            stacks = Math.floor(calculatedStacks);
            console.log(`✅ 计算结果: ${calculatedStacks} -> ${stacks}`);
          } else {
            stacks = parseInt(stacksStr) || 1;
          }
        } else if (valueStr.includes(':')) {
          // 兼容旧格式 "statusId:stacks"
          const parts = valueStr.split(':');
          statusId = parts[0];
          const stacksStr = parts[1];

          if (
            stacksStr.includes('.') ||
            stacksStr.includes('/') ||
            stacksStr.includes('*') ||
            stacksStr.includes('+') ||
            stacksStr.includes('-')
          ) {
            stacks = Math.floor(this.calculateDynamicValue(stacksStr, targetType));
          } else {
            stacks = parseInt(stacksStr) || 1;
          }
        } else {
          statusId = valueStr;
          stacks = 1;
        }
      } else if (typeof expression.value === 'number') {
        // 这种情况不太可能，但为了安全
        statusId = String(expression.value);
        stacks = 1;
      } else {
        statusId = String(expression.value);
        stacks = 1;
      }

      const duration = expression.duration;
      await this.applyStatusEffect(targetType, statusId, stacks, duration);
    } else if (expression.operator === 'remove') {
      // 移除状态
      const statusId = expression.value as string;

      if (statusId === 'all_buffs') {
        // 移除所有状态（正面+负面）
        await this.removeAllStatuses(targetType);
      } else if (statusId === 'buffs') {
        // 仅移除所有正面buff
        await this.removeAllBuffs(targetType);
      } else if (statusId === 'debuffs') {
        // 仅移除所有负面debuff
        await this.removeAllDebuffs(targetType);
      } else {
        await this.removeStatusEffect(targetType, statusId);
      }
    }
  }

  /**
   * 执行能力效果
   */
  private async executeAbilityEffect(expression: EffectExpression): Promise<void> {
    // 统一到下方实现，避免重复定义
    const targetType = expression.target
      ? this.resolveTarget(expression.target, expression.attribute)
      : this.executionContext.sourceIsPlayer
        ? 'player'
        : 'enemy';
    if (expression.operator === 'add' || expression.operator === 'apply') {
      const abilityDefinition = expression.value as string;
      await this.addAbilityToTarget(targetType, abilityDefinition);
    } else if (expression.operator === 'remove') {
      const abilityIdentifier = expression.value as string;
      await this.removeAbility(targetType, abilityIdentifier);
    } else {
      console.warn('未支持的能力操作符:', expression.operator);
    }
  }

  /**
   * 解析能力的目标
   */
  private resolveAbilityTarget(expression: EffectExpression): 'player' | 'enemy' {
    // 如果能力效果中包含目标信息，使用它
    if (expression.target) {
      return this.resolveTarget(expression.target, expression.attribute);
    }

    // 解析能力字符串中的目标信息
    const abilityContent = this.extractEffectFromAbility(expression.raw);
    if (abilityContent.includes('ME.')) {
      return this.executionContext.sourceIsPlayer ? 'player' : 'enemy';
    } else if (abilityContent.includes('OP.')) {
      return this.executionContext.sourceIsPlayer ? 'enemy' : 'player';
    }

    // 默认情况下，能力添加到发动者身上
    return this.executionContext.sourceIsPlayer ? 'player' : 'enemy';
  }

  /**
   * 添加能力到目标
   */
  private async addAbility(targetType: 'player' | 'enemy', abilityString: string): Promise<void> {
    // 为避免重复实现与递归，直接调用新的实现
    return this.addAbilityNew(targetType, abilityString);
  }

  /**
   * 新实现：仅接受 trigger(effects) 形式
   */
  private async addAbilityNew(targetType: 'player' | 'enemy', abilityEffect: string): Promise<void> {
    const entity = this.getEntity(targetType);
    if (!entity) return;

    let trigger: string;

    const bracketMatch = abilityEffect.match(/^(?:(ME|OP)\.)?([\w_]+)\((.+)\)$/);
    if (bracketMatch) {
      // 忽略可选的目标前缀（ME.|OP.），以能力所属实体为准
      trigger = bracketMatch[2];
    } else {
      console.error('能力格式错误，应为 trigger(effects) 或 ME.OP 修饰的新格式');
      return;
    }

    const newAbility: any = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      trigger,
      effect: abilityEffect,
    };

    const updatedAbilities = [...(entity.abilities || []), newAbility] as any;

    if (targetType === 'player') {
      this.gameStateManager.updatePlayer({ abilities: updatedAbilities });
    } else {
      this.gameStateManager.updateEnemy({ abilities: updatedAbilities });
    }

    console.log(`✅ 添加能力: ${abilityEffect} (${targetType})`);
    BattleLog.addLog(`获得能力: ${abilityEffect}`, 'info');

    await this.processAbilitiesOnAbilityGain(targetType);

    // battle_start 只在游戏初始化时通过 processAbilitiesAtBattleStart 触发，不在添加能力时触发
  }

  /**
   * 从能力字符串中提取触发条件
   */
  private extractTriggerFromAbility(abilityString: string): string {
    // 仅支持 trigger(effects)
    const bracketMatch = abilityString.match(/^([\w_]+)\(/);
    return bracketMatch ? bracketMatch[1] : 'passive';
  }

  /**
   * 从能力字符串中提取效果部分
   */
  private extractEffectFromAbility(abilityString: string): string {
    const m = abilityString.match(/^[\w_]+\((.*)\)$/);
    return m ? m[1].trim() : abilityString;
  }

  /**
   * 执行卡牌效果
   */
  private async executeCardEffect(expression: EffectExpression): Promise<void> {
    const { attribute, value, selector } = expression;
    let numValue: number;
    if (typeof value === 'number') {
      numValue = value;
    } else if (expression.isVariableReference && typeof value === 'string') {
      // 变量或数学表达式，按当前上下文目标为玩家解析（draw/弃牌等为玩家独有）
      numValue = this.calculateDynamicValue(value, 'player');
    } else {
      const parsed = parseFloat(value as string);
      numValue = Number.isFinite(parsed) ? parsed : 0;
    }

    switch (attribute) {
      case 'draw': {
        // 容错：若为表达式，且包含 deck_size，则以当前抽牌堆实时值回退计算
        if (typeof value === 'string' && /deck_size/.test(value)) {
          const drawPileSize = (this.gameStateManager.getGameState() as any)?.player?.drawPile?.length || 0;
          if (!Number.isFinite(numValue) || numValue <= 0) {
            numValue = drawPileSize / 3;
          }
        }
        let toDraw = Math.max(0, Math.floor(numValue));
        // 进一步健壮：若推导结果为0，但效果并未显式指定为0，则回退抽1张
        if (toDraw === 0) {
          const raw = (expression.raw || '').toString();
          const hasExplicitZero = /\bdraw\b\s*[+\-=*/]?\s*0\b/.test(raw);
          if (!hasExplicitZero) {
            toDraw = 1;
          }
        }
        this.gameStateManager.drawCardsFromPile(toDraw);
        if (this.verbose) console.log(`抽取${toDraw}张卡牌`);
        break;
      }
      case 'discard':
        // 新的弃牌语法：discard.selector
        if (selector) {
          await this.executeDiscardWithSelector(selector, numValue);
        } else {
          // 兼容旧语法
          await this.discardRandomCards(numValue);
          console.log(`弃置${numValue}张卡牌`);
        }
        break;

      // 高级卡牌操作 - 使用统一选择系统
      case 'reduce_cost_all':
        await this.reduceCardsCost('all', numValue);
        console.log(`所有手牌费用减少${numValue}`);
        break;

      case 'reduce_cost':
        // 减少卡牌费用：reduce_cost.selector value
        if (expression.selector) {
          await this.executeReduceCostWithSelector(expression.selector, numValue);
        } else {
          // 兼容旧语法
          await this.reduceCardsCost('choose', numValue);
          console.log(`选择的卡牌费用减少${numValue}`);
        }
        break;
      case 'exile': {
        // 放逐/消耗选中的牌：exile.selector
        // 只实现手牌选择器
        const exSelector = expression.selector || 'hand.choose';
        const selected = await this.selectCardsWithSelector(exSelector, 1);
        if (selected.length > 0) {
          const card = selected[0];
          this.gameStateManager.updatePlayer({
            hand: this.gameStateManager.getPlayer().hand.filter(c => c.id !== card.id),
          });
          this.gameStateManager.moveCardToExhaust(card);
          BattleLog.addLog(`放逐了卡牌：${card.name}`, 'action', { type: 'card', name: card.name });
        }
        break;
      }

      case 'copy_card':
        // 复制卡牌：copy_card.selector
        if (expression.selector) {
          await this.executeCopyCardWithSelector(expression.selector);
        } else {
          // 兼容旧语法
          await this.copySelectedCard('choose');
          console.log(`复制了选择的卡牌`);
        }
        break;

      case 'trigger_effect':
        // 触发效果两次：trigger_effect.selector
        if (expression.selector) {
          await this.executeTriggerEffectWithSelector(expression.selector);
        } else {
          // 兼容旧语法
          await this.triggerCardEffectTwice('choose');
          console.log(`选择的卡牌效果触发两次`);
        }
        break;
      case 'exhaust':
        // 消耗效果通常在卡牌系统中处理
        console.log(`消耗效果: ${numValue}`);
        break;
      case 'add_to_hand':
        // 加入手牌
        await this.handleAddCardToHand(expression.target, expression.value);
        break;
      case 'add_to_deck':
        // 加入抽牌堆
        await this.handleAddCardToDeck(expression.target, expression.value);
        break;
      default:
        console.warn('未知卡牌效果:', attribute);
    }
  }

  /**
   * 执行能力效果
   */
  // 重复定义移除（已在上方实现）

  /**
   * 为指定目标添加能力（支持跨目标）
   */
  private async addAbilityToTarget(targetType: 'player' | 'enemy', abilityDefinition: string): Promise<void> {
    await this.addAbility(targetType, abilityDefinition);

    // 记录跨目标能力添加的日志
    const sourceType = this.executionContext.sourceIsPlayer ? '玩家' : '敌人';
    const targetName = targetType === 'player' ? '玩家' : '敌人';

    if (
      (this.executionContext.sourceIsPlayer && targetType === 'enemy') ||
      (!this.executionContext.sourceIsPlayer && targetType === 'player')
    ) {
      console.log(`🔄 跨目标能力添加: ${sourceType} 为 ${targetName} 添加了能力: ${abilityDefinition}`);
      BattleLog.addLog(`${sourceType} 为 ${targetName} 添加了能力`, 'info');
    }
  }

  /**
   * 执行特殊效果
   */
  private async executeSpecialEffect(expression: EffectExpression): Promise<void> {
    const { attribute, value } = expression;

    switch (attribute) {
      case 'narrate':
        await this.triggerNarrative(value as string);
        break;
      default:
        console.warn('未知特殊效果:', attribute);
    }
  }

  /**
   * 解析目标 - 仅使用 ME/OP 语法，但支持状态效果默认目标
   */
  private resolveTarget(targetFromExpression?: string, attribute?: string): 'player' | 'enemy' {
    console.log(
      `🎯 解析目标: targetFromExpression=${targetFromExpression}, attribute=${attribute}, sourceIsPlayer=${this.executionContext.sourceIsPlayer}`,
    );

    // ALL 目标应该在 executeExpression 中被处理，不应该到达这里
    if (targetFromExpression === 'ALL') {
      console.error('❌ ALL目标不应该到达resolveTarget方法，这是一个bug');
      // 降级处理：默认返回玩家
      return 'player';
    }

    // 特殊处理：状态效果中的ME/OP应该基于状态持有者
    // 注意：不能通过查找状态来判断持有者，因为敌我双方可能都有相同ID的状态
    // 应该直接使用 sourceIsPlayer 来判断
    if (this.executionContext.statusContext && this.executionContext.triggerType) {
      if (targetFromExpression === 'ME') {
        // 在状态效果中，ME指状态的持有者，直接使用sourceIsPlayer判断
        const result = this.executionContext.sourceIsPlayer ? 'player' : 'enemy';
        console.log(
          `🎯 状态效果中ME解析为: ${result} (状态持有者, sourceIsPlayer=${this.executionContext.sourceIsPlayer})`,
        );
        return result;
      }
      if (targetFromExpression === 'OP') {
        // 在状态效果中，OP指状态持有者的对手
        const result = this.executionContext.sourceIsPlayer ? 'enemy' : 'player';
        console.log(
          `🎯 状态效果中OP解析为: ${result} (状态持有者的对手, sourceIsPlayer=${this.executionContext.sourceIsPlayer})`,
        );
        return result;
      }
    }

    // 处理ME/OP语法 - 根据发动者来确定实际目标
    if (targetFromExpression === 'ME') {
      // ME 总是指发动者自己
      const result = this.executionContext.sourceIsPlayer ? 'player' : 'enemy';
      console.log(`🎯 ME解析为: ${result}`);
      return result;
    }
    if (targetFromExpression === 'OP') {
      // OP 总是指发动者的对手
      const result = this.executionContext.sourceIsPlayer ? 'enemy' : 'player';
      console.log(`🎯 OP解析为: ${result}`);
      return result;
    }

    // 玩家独有属性总是作用于玩家，无论发动者是谁
    if (attribute && this.isPlayerOnlyAttribute(attribute)) {
      return 'player';
    }

    // 特殊处理：状态效果默认作用于持有状态的实体
    if (this.executionContext.statusContext && this.executionContext.triggerType) {
      // 获取状态效果的持有者
      const player = this.gameStateManager.getPlayer();
      const enemy = this.gameStateManager.getEnemy();

      // 检查状态效果属于哪个实体
      const statusId = this.executionContext.statusContext.id;
      const playerHasStatus = player.statusEffects?.some(s => s.id === statusId);
      const enemyHasStatus = enemy?.statusEffects?.some(s => s.id === statusId);

      if (playerHasStatus) {
        console.log(`🎯 状态效果 "${attribute}" 默认作用于玩家（状态持有者）`);
        return 'player';
      } else if (enemyHasStatus) {
        console.log(`🎯 状态效果 "${attribute}" 默认作用于敌人（状态持有者）`);
        return 'enemy';
      }
    }

    // 其他情况必须明确指定目标
    throw new Error(`效果 "${attribute}" 必须明确指定目标 (ME. 或 OP.)`);
  }

  /**
   * 判断是否为玩家独有属性
   */
  private isPlayerOnlyAttribute(attribute: string): boolean {
    return PLAYER_ONLY_ATTRIBUTES_SET.has(attribute);
  }

  /**
   * 获取实体
   */
  private getEntity(targetType: 'player' | 'enemy'): Player | Enemy | null {
    return targetType === 'player' ? this.gameStateManager.getPlayer() : this.gameStateManager.getEnemy();
  }

  /**
   * 获取效果来源信息（用于日志记录）
   */
  private getEffectSourceInfo(): { entityName: string; sourceName: string; logSource?: any } | null {
    const entityName = this.executionContext.sourceIsPlayer ? '玩家' : '敌人';

    // 优先检查状态效果
    if (this.executionContext.statusContext) {
      const statusDef = this.dynamicStatusManager.getStatusDefinition(this.executionContext.statusContext.id);
      const statusName = statusDef?.name || this.executionContext.statusContext.id;
      return {
        entityName,
        sourceName: `buff-${statusName}`,
        logSource: {
          type: 'status' as const,
          name: statusName,
          details: statusDef?.description,
        },
      };
    }

    // 检查卡牌
    if (this.executionContext.cardContext) {
      const cardName = this.executionContext.cardContext.name || '未知卡牌';
      return {
        entityName,
        sourceName: cardName,
        logSource: {
          type: 'card' as const,
          name: cardName,
          details: this.executionContext.cardContext.description,
        },
      };
    }

    // 检查能力
    if (this.executionContext.abilityContext) {
      const abilityName = this.executionContext.abilityContext.name || '能力';
      return {
        entityName,
        sourceName: abilityName,
        logSource: {
          type: 'ability' as const,
          name: abilityName,
        },
      };
    }

    // 检查遗物
    if (this.executionContext.isRelicEffect && this.executionContext.cardContext?.name) {
      return {
        entityName,
        sourceName: `遗物-${this.executionContext.cardContext.name}`,
        logSource: {
          type: 'relic' as const,
          name: this.executionContext.cardContext.name,
        },
      };
    }

    // 检查敌人意图
    if (!this.executionContext.sourceIsPlayer && this.executionContext.battleContext?.intent) {
      const intentName = this.executionContext.battleContext.intent.name || '意图';
      return {
        entityName,
        sourceName: intentName,
        logSource: {
          type: 'ability' as const,
          name: intentName,
        },
      };
    }

    return null;
  }

  /**
   * 获取最新的实体状态（强制从游戏状态管理器刷新）
   */
  private getLatestEntity(targetType: 'player' | 'enemy'): Player | Enemy | null {
    // 强制刷新游戏状态，确保获取最新值
    const gameState = this.gameStateManager.getGameState() as any;
    if (!gameState) {
      console.warn('无法获取游戏状态');
      return null;
    }

    if (targetType === 'player') {
      return gameState.player;
    } else {
      return gameState.enemy;
    }
  }

  /**
   * 获取效果来源实体
   */
  private getSourceEntity(): Player | Enemy | null {
    return this.executionContext.sourceIsPlayer ? this.gameStateManager.getPlayer() : this.gameStateManager.getEnemy();
  }

  /**
   * 解析变量引用 - 获取当前效果目标实体的最新属性值
   */
  private resolveVariableReference(variableName: string, currentTargetEntity: Player | Enemy): number {
    // 变量引用应该引用当前效果目标实体的属性
    // 例如：ME.hp = max_hp，这里的max_hp应该是ME（当前目标）的最大生命值

    // 确定当前目标实体的类型
    const player = this.gameStateManager.getPlayer();
    const enemy = this.gameStateManager.getEnemy();

    let targetType: 'player' | 'enemy';
    if (currentTargetEntity === player || (currentTargetEntity as any).id === (player as any).id) {
      targetType = 'player';
    } else {
      targetType = 'enemy';
    }

    // 获取最新的实体状态
    const latestEntity = this.getEntity(targetType);

    if (!latestEntity) {
      console.warn(`无法获取最新的实体状态: ${targetType}`);
      return 0;
    }

    let resolvedValue: number;
    switch (variableName) {
      case 'max_hp':
        resolvedValue = latestEntity.maxHp || 0;
        console.log(`🔄 动态获取${targetType}的最新max_hp: ${resolvedValue}`);
        break;
      case 'max_lust':
        resolvedValue = latestEntity.maxLust || 0;
        console.log(`🔄 动态获取${targetType}的最新max_lust: ${resolvedValue}`);
        break;
      case 'max_energy':
        resolvedValue = (latestEntity as Player).maxEnergy || 0;
        console.log(`🔄 动态获取${targetType}的最新max_energy: ${resolvedValue}`);
        break;
      case 'current_hp':
        resolvedValue = (latestEntity as any).hp || (latestEntity as any).currentHp || 0;
        console.log(`🔄 动态获取${targetType}的最新current_hp: ${resolvedValue}`);
        break;
      case 'current_lust':
        resolvedValue = (latestEntity as any).lust || (latestEntity as any).currentLust || 0;
        console.log(`🔄 动态获取${targetType}的最新current_lust: ${resolvedValue}`);
        break;
      case 'current_energy':
        resolvedValue = (latestEntity as Player).energy || 0;
        console.log(`🔄 动态获取${targetType}的最新current_energy: ${resolvedValue}`);
        break;
      case 'hp':
        resolvedValue = (latestEntity as any).hp || (latestEntity as any).currentHp || 0;
        console.log(`🔄 动态获取${targetType}的最新hp: ${resolvedValue}`);
        break;
      case 'lust':
        resolvedValue = (latestEntity as any).lust || (latestEntity as any).currentLust || 0;
        console.log(`🔄 动态获取${targetType}的最新lust: ${resolvedValue}`);
        break;
      case 'energy':
        resolvedValue = (latestEntity as Player).energy || 0;
        console.log(`🔄 动态获取${targetType}的最新energy: ${resolvedValue}`);
        break;
      case 'block':
        resolvedValue = (latestEntity as any).block || 0;
        console.log(`🔄 动态获取${targetType}的最新block: ${resolvedValue}`);
        break;
      default:
        console.warn(`未知的变量引用: ${variableName}`);
        resolvedValue = 0;
    }

    return resolvedValue;
  }

  /**
   * 检查是否是有效的触发前缀
   */
  private isValidTriggerPrefix(prefix: string): boolean {
    return isValidTrigger(prefix);
  }

  /**
   * 获取当前属性值 - 修饰符通过状态效果动态计算
   */
  private getCurrentAttributeValue(entity: Player | Enemy, attribute: string): number {
    switch (attribute) {
      case 'hp':
        return entity.currentHp;
      case 'lust':
        return entity.currentLust;
      case 'energy':
        return (entity as Player).energy || 0;
      case 'block':
        return entity.block;
      case 'max_hp':
        return entity.maxHp;
      case 'max_lust':
        return entity.maxLust;
      case 'max_energy':
        return (entity as Player).maxEnergy || 0;
      case 'damage_modifier':
      case 'lust_damage_modifier':
      case 'lust_damage_taken_modifier':
      case 'damage_taken_modifier':
      case 'block_modifier':
        // 修饰符通过状态效果动态计算
        return this.calculateModifierFromStatusEffects(entity, attribute);
      default:
        return 0;
    }
  }

  /**
   * 检查实体是否被眩晕（无法行动）
   * 眩晕通过状态效果的 hold 触发器中的 ME.stun 来实现
   */
  public isStunned(targetType: 'player' | 'enemy'): boolean {
    const entity = this.getEntity(targetType);
    if (!entity) return false;

    for (const status of entity.statusEffects) {
      const statusDef = this.dynamicStatusManager.getStatusDefinition(status.id);
      if (!statusDef) continue;

      const holdEffects = statusDef.triggers?.hold;
      if (holdEffects) {
        const effects = Array.isArray(holdEffects) ? holdEffects : [holdEffects];
        for (const effect of effects) {
          // 检查是否包含 stun 效果
          if (/\bME\.stun\b|\bstun\b/i.test(effect)) {
            console.log(`⚡ ${targetType}被状态${status.name}眩晕，无法行动`);
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * 从状态效果计算修饰符值
   */
  // 计算修饰符（加法总和与乘法因子分别返回），用于UI展示
  public getModifierBreakdown(entity: Player | Enemy, modifierType: string): { add: number; mul: number } {
    let add = 0;
    let mul = 1;

    for (const status of entity.statusEffects) {
      const statusDef = this.dynamicStatusManager.getStatusDefinition(status.id);
      if (!statusDef) continue;
      const holdEffects = statusDef.triggers?.hold;
      if (holdEffects) {
        // 根据新的变量结构，hold现在是字符串而不是数组
        const effects = Array.isArray(holdEffects) ? holdEffects : [holdEffects];
        for (const effect of effects) {
          if (!effect.includes(modifierType)) continue;
          const processed = this.processStacksExpression(effect, status.stacks);
          // 匹配 modifierType op value 或 ME.modifierType op value
          const regex = new RegExp(`(?:ME\\.)?${modifierType}\\s*([+\\-*/=])\\s*([\\d.]+)`, 'i');
          const m = processed.match(regex);
          if (!m) continue;
          const op = m[1];
          const val = parseFloat(m[2]);
          if (isNaN(val)) continue;
          if (op === '+' || op === '-') add += op === '+' ? val : -val;
          else if (op === '*') mul *= val;
          else if (op === '/') {
            if (val !== 0) mul *= 1 / val;
          } else if (op === '=') {
            // 设置值语义复杂，这里当作加法覆盖显示
            add = val;
          }
        }
      }
    }

    // 直接存储的修饰符仅计入加法部分
    const direct = (entity as any).modifiers?.[modifierType];
    if (typeof direct === 'number' && direct !== 0) add += direct;

    // 只保留1位小数
    const round1 = (n: number) => Math.round(n * 10) / 10;
    add = round1(add);
    mul = round1(mul);
    return { add, mul };
  }

  public calculateModifierFromStatusEffects(entity: Player | Enemy, modifierType: string): number {
    let totalModifier = 0;

    // 遍历所有状态效果
    for (const status of entity.statusEffects) {
      const statusDef = this.dynamicStatusManager.getStatusDefinition(status.id);
      if (!statusDef) continue;

      // 检查状态效果的hold效果中是否包含该修饰符（持续性修饰符）
      const holdEffects = statusDef.triggers?.hold;
      if (holdEffects) {
        // 根据新的变量结构，hold现在是字符串而不是数组
        const effects = Array.isArray(holdEffects) ? holdEffects : [holdEffects];
        for (const effect of effects) {
          // 解析效果字符串，查找修饰符
          if (effect.includes(modifierType)) {
            // 处理stacks占位符
            const processedEffect = this.processStacksExpression(effect, status.stacks);

            // 提取修饰符值
            const modifierValue = this.extractModifierValue(processedEffect, modifierType);
            if (modifierValue !== null) {
              totalModifier += modifierValue;
              console.log(`🔢 状态${status.name}(${status.stacks}层)贡献${modifierType}: ${modifierValue}`);
            }
          }
        }
      }
    }

    // 同时检查直接存储的修饰符（向后兼容）
    const directModifier = (entity as any).modifiers?.[modifierType] || 0;
    if (directModifier !== 0) {
      totalModifier += directModifier;
      console.log(`🔢 直接修饰符${modifierType}: ${directModifier}`);
    }

    console.log(`📊 ${modifierType}总计: ${totalModifier}`);
    return totalModifier;
  }

  /**
   * 分析修饰符来源，分别统计加减与乘除贡献（用于UI展示）
   */
  public analyzeModifierFromStatusEffects(entity: Player | Enemy, modifierType: string): { add: number; mul: number } {
    let addSum = 0;
    let mulFactor = 1;

    // 检查遗物的 passive 修饰符（仅对玩家）
    if ((entity as any).relics) {
      const relics = (entity as any).relics || [];
      for (const relic of relics) {
        if (relic.effect && relic.effect.includes('passive(')) {
          // 提取 passive 括号内的内容
          const passiveMatch = relic.effect.match(/passive\((.*?)\)/);
          if (passiveMatch) {
            const passiveEffect = passiveMatch[1];
            if (passiveEffect.includes(modifierType)) {
              const regex = new RegExp(`(?:ME\\.)?${modifierType}\\s*([+\\-*/=])\\s*([\\d.]+)`, 'i');
              const m = passiveEffect.match(regex);
              if (m) {
                const op = m[1];
                const val = parseFloat(m[2]);
                if (!isNaN(val)) {
                  switch (op) {
                    case '+':
                      addSum += val;
                      break;
                    case '-':
                      addSum -= val;
                      break;
                    case '*':
                      mulFactor *= val;
                      break;
                    case '/':
                      if (val !== 0) mulFactor /= val;
                      break;
                    case '=':
                      // 设置类不计入加总，用计算路径体现；这里忽略
                      break;
                  }
                }
              }
            }
          }
        }
      }
    }

    // 遍历状态效果的持续修饰（hold）
    for (const status of entity.statusEffects) {
      const statusDef = this.dynamicStatusManager.getStatusDefinition(status.id);
      if (!statusDef) continue;
      const holdEffects = statusDef.triggers?.hold;
      if (holdEffects) {
        // 根据新的变量结构，hold现在是字符串而不是数组
        const effects = Array.isArray(holdEffects) ? holdEffects : [holdEffects];
        for (const effect of effects) {
          if (!effect.includes(modifierType)) continue;
          const processed = this.processStacksExpression(effect, status.stacks);
          const regex = new RegExp(`(?:ME\\.)?${modifierType}\\s*([+\\-*/=])\\s*([\\d.]+)`, 'i');
          const m = processed.match(regex);
          if (!m) continue;
          const op = m[1];
          const val = parseFloat(m[2]);
          if (isNaN(val)) continue;
          switch (op) {
            case '+':
              addSum += val;
              break;
            case '-':
              addSum -= val;
              break;
            case '*':
              mulFactor *= val;
              break;
            case '/':
              if (val !== 0) mulFactor /= val;
              break;
            case '=':
              // 设置类不计入加总，用计算路径体现；这里忽略
              break;
          }
        }
      }
    }

    // 直接修饰符（向后兼容）：按加法处理
    const direct = (entity as any).modifiers?.[modifierType] || 0;
    if (direct) addSum += direct;

    // 统一保留1位小数
    const round1 = (n: number) => Math.round(n * 10) / 10;
    return { add: round1(addSum), mul: round1(mulFactor) };
  }

  /**
   * 从效果字符串中提取修饰符值
   */
  private extractModifierValue(effectString: string, modifierType: string): number | null {
    // 匹配类似 "damage_modifier + 2" 或 "ME.damage_modifier + 2" 的模式
    const regex = new RegExp(`(?:ME\\.)?${modifierType}\\s*([+\\-*/=])\\s*([\\d.]+)`, 'i');
    const match = effectString.match(regex);

    if (match) {
      const operator = match[1];
      const value = parseFloat(match[2]);

      // 根据操作符返回相应的值
      switch (operator) {
        case '+':
          return value;
        case '-':
          return -value;
        case '*':
          // 对于乘法，我们需要特殊处理
          // 例如 ME.lust_damage_modifier / 2 意味着伤害减半
          // 这应该被处理为一个乘数修饰符，而不是加法修饰符
          console.log(`⚠️ 乘法修饰符暂不支持直接转换: ${effectString}`);
          return null;
        case '/':
          // 对于除法，我们需要特殊处理
          // 例如 ME.lust_damage_modifier / 2 意味着伤害减半
          console.log(`⚠️ 除法修饰符暂不支持直接转换: ${effectString}`);
          return null;
        case '=':
          // 设置值需要特殊处理，因为它不是累加的
          console.log(`⚠️ 设置修饰符暂不支持直接转换: ${effectString}`);
          return null;
        default:
          return null;
      }
    }

    return null;
  }

  /**
   * 应用复杂修饰符（支持加法、乘法、除法、设置）
   */
  private applyComplexModifiers(
    entity: Player | Enemy,
    modifierType: string,
    baseValue: number,
    logPrefix: string,
  ): number {
    let result = baseValue;
    let hasModifiers = false;

    // 检查遗物的 passive 修饰符（仅对玩家）
    if ((entity as any).relics) {
      const relics = (entity as any).relics || [];
      for (const relic of relics) {
        if (relic.effect && relic.effect.includes('passive(')) {
          // 提取 passive 括号内的内容
          const passiveMatch = relic.effect.match(/passive\((.*?)\)/);
          if (passiveMatch) {
            const passiveEffect = passiveMatch[1];
            if (passiveEffect.includes(modifierType)) {
              const modifierResult = this.applyModifierFromEffect(passiveEffect, modifierType, result);
              if (modifierResult !== null) {
                const oldValue = result;
                result = modifierResult;
                hasModifiers = true;
                console.log(`🔧 ${logPrefix} - 遗物${relic.name}: ${oldValue} → ${result}`);
                BattleLog.addLog(`${logPrefix} - 遗物${relic.name}: ${oldValue} → ${result}`, 'info');
              }
            }
          }
        }
      }
    }

    // 遍历所有状态效果，查找相关修饰符
    for (const status of entity.statusEffects) {
      const statusDef = this.dynamicStatusManager.getStatusDefinition(status.id);
      if (!statusDef) continue;

      // 检查hold效果中的修饰符（持续性修饰符）
      const holdEffects = statusDef.triggers?.hold;
      if (holdEffects) {
        // 根据新的变量结构，hold现在是字符串而不是数组
        const effects = Array.isArray(holdEffects) ? holdEffects : [holdEffects];
        for (const effect of effects) {
          if (effect.includes(modifierType)) {
            const processedEffect = this.processStacksExpression(effect, status.stacks);
            const modifierResult = this.applyModifierFromEffect(processedEffect, modifierType, result);

            if (modifierResult !== null) {
              const oldValue = result;
              result = modifierResult;
              hasModifiers = true;
              console.log(`🔧 ${logPrefix} - ${status.name}(${status.stacks}层): ${oldValue} → ${result}`);
              // 减少状态修饰符日志输出，只在有显著变化时记录
              if (Math.abs(result - oldValue) >= 1) {
                BattleLog.addLog(`${logPrefix} - ${status.name}: ${oldValue} → ${result}`, 'info');
              }
            }
          }
        }
      }
    }

    // 检查直接存储的修饰符（向后兼容）
    const directModifier = (entity as any).modifiers?.[modifierType] || 0;
    if (directModifier !== 0) {
      const oldValue = result;
      result = result + directModifier;
      hasModifiers = true;

      // 如果是异常的负数修饰符，输出详细调试信息
      if (directModifier < -50) {
        console.error(`🚨 异常修饰符检测: ${logPrefix} - 直接修饰符: ${directModifier}`);
        console.error(`🚨 实体修饰符对象:`, (entity as any).modifiers);
        console.error(`🚨 实体状态效果:`, entity.statusEffects);
      }

      console.log(`🔧 ${logPrefix} - 直接修饰符: ${oldValue} + ${directModifier} = ${result}`);
      // 减少直接修饰符日志输出
      if (Math.abs(directModifier) >= 1) {
        BattleLog.addLog(`${logPrefix} - 直接修饰符: ${oldValue} + ${directModifier} = ${result}`, 'info');
      }
    }

    if (hasModifiers) {
      console.log(`📊 ${logPrefix}最终结果: ${baseValue} → ${result}`);
    }

    return result;
  }

  /**
   * 从效果字符串应用修饰符
   */
  private applyModifierFromEffect(effectString: string, modifierType: string, currentValue: number): number | null {
    const regex = new RegExp(`(?:ME\\.)?${modifierType}\\s*([+\\-*/=])\\s*([\\d.]+)`, 'i');
    const match = effectString.match(regex);

    if (match) {
      const operator = match[1];
      const value = parseFloat(match[2]);

      switch (operator) {
        case '+':
          return currentValue + value;
        case '-':
          return currentValue - value;
        case '*':
          return currentValue * value;
        case '/':
          return value !== 0 ? currentValue / value : currentValue;
        case '=':
          return value;
        default:
          return null;
      }
    }

    return null;
  }

  /**
   * 计算新值
   */
  private calculateNewValue(current: number, operator: string, value: number): number {
    switch (operator) {
      case '+':
        return current + value;
      case '-':
        return current - value;
      case '*':
        return current * value;
      case '/':
        return value !== 0 ? current / value : current;
      case '=':
      case 'set':
        return value;
      default:
        return current;
    }
  }

  /**
   * 限制属性值范围
   */
  private clampAttributeValue(
    attribute: string,
    value: number,
    entity: Player | Enemy,
    targetTypeHint?: 'player' | 'enemy',
  ): number {
    // 对于hp和lust，需要实时获取最新的最大值，因为在同一个效果中可能先修改了最大值
    switch (attribute) {
      case 'hp': {
        // 使用 targetTypeHint 或通过ID比对来确定实体归属，避免引用比较失效
        const gameState: any = this.gameStateManager.getGameState();
        const isPlayer = targetTypeHint
          ? targetTypeHint === 'player'
          : (entity as any)?.id && gameState?.player && (entity as any).id === gameState.player.id;
        const latest = isPlayer ? gameState?.player : gameState?.enemy;
        const currentMaxHp = latest?.maxHp ?? entity.maxHp;
        return Math.max(0, Math.min(value, currentMaxHp));
      }
      case 'lust': {
        const gameState: any = this.gameStateManager.getGameState();
        const isPlayer = targetTypeHint
          ? targetTypeHint === 'player'
          : (entity as any)?.id && gameState?.player && (entity as any).id === gameState.player.id;
        const latest = isPlayer ? gameState?.player : gameState?.enemy;
        const currentMaxLust = latest?.maxLust ?? entity.maxLust;
        return Math.max(0, Math.min(value, currentMaxLust));
      }
      case 'energy':
      case 'block':
        return Math.max(0, value);
      case 'max_hp':
      case 'max_lust':
      case 'max_energy':
        return Math.max(1, value);
      default:
        return Math.max(0, value);
    }
  }

  /**
   * 应用属性变化
   */
  private async applyAttributeChange(
    targetType: 'player' | 'enemy',
    attribute: string,
    newValue: number,
    entity: Player | Enemy,
  ): Promise<void> {
    // 获取原始值用于调试
    let originalValue: any;
    switch (attribute) {
      case 'hp':
        originalValue = entity.currentHp;
        break;
      case 'lust':
        originalValue = entity.currentLust;
        break;
      case 'energy':
        originalValue = (entity as Player).energy;
        break;
      case 'block':
        originalValue = entity.block;
        break;
      case 'max_hp':
        originalValue = entity.maxHp;
        break;
      case 'max_lust':
        originalValue = entity.maxLust;
        break;
      case 'max_energy':
        originalValue = (entity as Player).maxEnergy;
        break;
      default:
        originalValue = 'unknown';
    }

    console.log(`🔧 应用属性变化: ${targetType}.${attribute} = ${newValue} (原值: ${originalValue})`);

    const updateData: any = {};

    switch (attribute) {
      case 'hp':
        updateData.currentHp = newValue;
        break;
      case 'lust':
        updateData.currentLust = newValue;
        break;
      case 'energy':
        updateData.energy = newValue;
        break;
      case 'block':
        updateData.block = newValue;
        break;
      case 'max_hp':
        updateData.maxHp = newValue;
        break;
      case 'max_lust':
        updateData.maxLust = newValue;
        break;
      case 'max_energy':
        updateData.maxEnergy = newValue;
        break;
      case 'damage_modifier':
      case 'lust_damage_modifier':
      case 'lust_damage_taken_modifier':
      case 'damage_taken_modifier':
      case 'heal_modifier':
      case 'block_modifier':
      case 'draw':
      case 'discard':
      case 'energy_gain':
      case 'card_play_limit':
        // 修饰符存储在modifiers对象中
        if (!updateData.modifiers) {
          updateData.modifiers = (entity as any).modifiers ? { ...(entity as any).modifiers } : {};
        }
        updateData.modifiers[attribute] = newValue;
        console.log(`设置修饰符 ${attribute} = ${newValue}`);
        break;
    }

    if (targetType === 'player') {
      this.gameStateManager.updatePlayer(updateData);
      // 如果是能量变化，立即刷新UI
      if (attribute === 'energy') {
        this.refreshUIAfterEnergyChange();
      }
    } else {
      this.gameStateManager.updateEnemy(updateData);
    }
  }

  /**
   * 能量变化后刷新UI
   */
  private refreshUIAfterEnergyChange(): void {
    try {
      // 延迟一小段时间确保状态更新完成
      setTimeout(() => {
        const gameState = this.gameStateManager.getGameState();
        if (gameState && gameState.player) {
          // 直接更新能量显示
          const playerEnergy = gameState.player.energy || 0;
          const maxEnergy = gameState.player.maxEnergy || 3;
          $('#player-energy').text(`${playerEnergy}/${maxEnergy}`);

          // 同时更新手牌的可用性显示
          this.updateHandCardsAfterEnergyChange(gameState.player);
        }
      }, 10);
    } catch (error) {
      console.warn('刷新UI失败:', error);
    }
  }

  /**
   * 能量变化后更新手牌显示
   */
  private updateHandCardsAfterEnergyChange(player: any): void {
    try {
      if (!player.hand) return;

      player.hand.forEach((card: any) => {
        const cardElement = $(`.card[data-card-id="${card.id}"]`);
        if (cardElement.length > 0) {
          // 重新计算是否可以使用
          let canAfford = false;
          if (card.cost === 'energy') {
            // X费允许0能量打出
            canAfford = player.energy >= 0;
          } else {
            canAfford = player.energy >= (card.cost || 0);
          }

          // 更新卡牌样式
          if (canAfford) {
            cardElement.removeClass('unaffordable').addClass('clickable');
            cardElement.find('.card-cost').removeClass('insufficient-energy');
          } else {
            cardElement.removeClass('clickable').addClass('unaffordable');
            cardElement.find('.card-cost').addClass('insufficient-energy');
          }
        }
      });
    } catch (error) {
      console.warn('更新手牌显示失败:', error);
    }
  }

  /**
   * 触发属性变化效果
   */
  private async triggerAttributeChangeEffects(
    targetType: 'player' | 'enemy',
    attribute: string,
    newValue: number,
    oldValue: number,
    entity: Player | Enemy,
  ): Promise<void> {
    const change = newValue - oldValue;

    // 获取最新的实体状态用于动画
    const latestEntity = this.getEntity(targetType);
    if (!latestEntity) {
      console.warn('无法获取最新实体状态用于动画:', targetType);
      return;
    }

    // 触发动画
    if (attribute === 'hp' && change < 0) {
      this.animationManager.showDamageNumber(targetType, Math.abs(change), 'damage');
      this.animationManager.updateHealthBarWithAnimation(targetType, newValue, (latestEntity as any).maxHp);

      if (targetType === 'player') {
        this.animationManager.showPlayerDamageEffect('damage');
      } else {
        this.animationManager.showEnemyDamageEffect('damage');
      }

      // 触发受到伤害时的能力
      await this.processAbilitiesOnTakeDamage(targetType);
    } else if (attribute === 'hp' && change > 0) {
      this.animationManager.showDamageNumber(targetType, change, 'heal');
      this.animationManager.updateHealthBarWithAnimation(targetType, newValue, (latestEntity as any).maxHp);

      // 触发受到治疗时的能力
      await this.processAbilitiesOnTakeHeal(targetType);
    } else if (attribute === 'lust') {
      this.animationManager.showDamageNumber(targetType, Math.abs(change), change > 0 ? 'lust' : 'heal');
      this.animationManager.updateLustBarWithAnimation(targetType, newValue, latestEntity.maxLust);

      // 触发欲望增加时的遗物效果（仅对玩家）
      if (change > 0 && targetType === 'player') {
        await this.relicEffectManager.triggerOnLustIncrease();
      }

      // 检查欲望溢出
      if (newValue >= (latestEntity as any).maxLust) {
        await this.handleLustOverflow(targetType);
      }
    } else if (attribute === 'block') {
      // 触发格挡变化触发器
      if (change > 0) {
        // 获得格挡时触发
        await this.processAbilitiesByTrigger(targetType, 'gain_block');
      } else if (change < 0) {
        // 失去格挡时触发
        await this.processAbilitiesByTrigger(targetType, 'lose_block');
      }
    }

    // 记录战斗日志
    this.logAttributeChange(targetType, attribute, change, newValue);

    // 检查死亡 - 不立即处理，而是标记待处理
    if (attribute === 'hp' && newValue <= 0) {
      this.pendingDeaths.add(targetType);
    }
  }

  /**
   * 应用状态效果
   */
  private async applyStatusEffect(
    targetType: 'player' | 'enemy',
    statusId: string,
    stacks: number,
    _duration?: number,
  ): Promise<void> {
    // 获取动态状态定义
    const statusDef = this.dynamicStatusManager.getStatusDefinition(statusId);
    if (!statusDef) {
      console.warn('⚠️ 未找到状态定义:', statusId);
      BattleLog.addLog(`未找到状态定义: ${statusId}`, 'system');
      return;
    }

    const statusEffect: StatusEffect = {
      id: statusId,
      name: statusDef.name,
      type: statusDef.type,
      description: statusDef.description,
      emoji: statusDef.emoji,
      stacks: Math.min(stacks, statusDef.maxStacks || 999),
    };

    this.gameStateManager.addStatusEffect(targetType, statusEffect);

    const targetName = targetType === 'player' ? '玩家' : '敌人';
    console.log(`✨ 对${targetName}施加${stacks}层${statusDef.name}`);
    BattleLog.logStatusEffect(targetName, statusDef.name, stacks, 0, true);

    // 执行应用时效果
    const applyEffects = this.dynamicStatusManager.getStatusTriggerEffects(statusId, 'apply');
    if (applyEffects.length > 0) {
      console.log(`🎯 触发${statusDef.name}的应用时效果:`, applyEffects);
      BattleLog.addLog(`${statusDef.name}触发应用时效果`, 'action');
      for (const effect of applyEffects) {
        // 状态触发时，ME/OP 以状态持有者为基准
        const holderIsPlayer = targetType === 'player';
        await this.executeEffectString(effect, holderIsPlayer, {
          triggerType: 'apply',
          statusContext: statusEffect,
        });
      }
    }
  }

  /**
   * 处理欲望溢出
   */
  private async handleLustOverflow(targetType: 'player' | 'enemy'): Promise<void> {
    if (targetType === 'player') {
      await this.handlePlayerClimax();
    } else {
      await this.handleEnemyClimax();
    }
  }

  /**
   * 处理玩家高潮
   */
  private async handlePlayerClimax(): Promise<void> {
    const enemy = this.gameStateManager.getEnemy();
    if (enemy && enemy.lustEffect) {
      console.log('玩家达到欲望上限，触发高潮惩罚！');

      this.animationManager.showLustEffectFlash();
      BattleLog.logLustOverflow('玩家', enemy.lustEffect.name || '欲望爆发');

      this.lustOverflowDisplay.showPlayerLustOverflow({
        name: enemy.lustEffect.name || '欲望爆发',
        description: enemy.lustEffect.description || '玩家欲望达到上限，触发敌人的特殊效果',
        effect: enemy.lustEffect.effect || '',
      });

      await this.executeEffectString(enemy.lustEffect.effect, false);
      this.gameStateManager.updatePlayer({ currentLust: 0 });
    }
  }

  /**
   * 处理敌人高潮
   */
  private async handleEnemyClimax(): Promise<void> {
    const gameState = this.gameStateManager.getGameState();
    const playerLustEffect = (gameState as any)?.battle?.player_lust_effect;

    if (playerLustEffect) {
      console.log('敌人达到欲望上限，触发玩家主导效果！');

      this.animationManager.showLustEffectFlash();
      BattleLog.logLustOverflow('敌人', playerLustEffect.name || '榨精支配');

      this.lustOverflowDisplay.showEnemyLustOverflow({
        name: playerLustEffect.name || '榨精支配',
        description: playerLustEffect.description || '敌人欲望达到上限，触发玩家的特殊效果',
        effect: playerLustEffect.effect || '',
      });

      await this.executeEffectString(playerLustEffect.effect, true);
      this.gameStateManager.updateEnemy({ currentLust: 0 });
    }
  }

  /**
   * 处理待处理的死亡
   * 在所有效果执行完毕后统一检查和处理死亡
   */
  private async processPendingDeaths(): Promise<void> {
    if (this.pendingDeaths.size === 0) {
      return;
    }

    // 如果双方都死亡，玩家优先（视为玩家胜利）
    if (this.pendingDeaths.has('player') && this.pendingDeaths.has('enemy')) {
      console.log('💀 双方同时死亡，判定为玩家胜利');
      await this.handleEntityDeath('enemy');
      return;
    }

    // 处理单方死亡
    for (const targetType of this.pendingDeaths) {
      await this.handleEntityDeath(targetType);
    }

    // 清空标记
    this.pendingDeaths.clear();
  }

  /**
   * 处理实体死亡
   */
  private async handleEntityDeath(targetType: 'player' | 'enemy'): Promise<void> {
    console.log(`💀 ${targetType === 'player' ? '玩家' : '敌人'}死亡，战斗结束！`);

    if (targetType === 'player') {
      this.gameStateManager.setGameOver('enemy');
      await this.handleBattleEnd('defeat');
    } else {
      this.gameStateManager.setGameOver('player');
      await this.handleBattleEnd('victory');
    }
  }

  /**
   * 处理战斗结束
   */
  private async handleBattleEnd(result: 'victory' | 'defeat'): Promise<void> {
    console.log(`🏆 战斗结束: ${result}`);

    // 保存战斗结果并触发叙事
    await this.saveBattleResultToMVU(result);
    await this.triggerBattleEndNarrative(result);

    // 延迟清除敌人数据，确保所有相关逻辑都已完成
    setTimeout(() => {
      this.clearEnemyFromMVU();
    }, 1000);
  }

  /**
   * 保存战斗结果到MVU变量 - 增强版，包含更多详细信息
   */
  private async saveBattleResultToMVU(result: 'victory' | 'defeat'): Promise<void> {
    try {
      const gameState = this.gameStateManager.getGameState();
      const player = gameState.player;
      const enemy = gameState.enemy;

      // 收集玩家状态效果信息
      const playerStatusEffects = player.statusEffects.map(status => ({
        name: status.name,
        stacks: status.stacks,
        type: status.type,
        description: status.description,
      }));

      // 收集玩家能力信息
      const playerAbilities = (player.abilities || []).map((ability: any) => ({
        effect: ability.effect,
        description: (ability as any).description || '无描述',
      }));

      // 获取初始状态（从MVU变量中读取）
      let initialPlayerHp = 100; // 默认值
      let initialPlayerLust = 0;

      try {
        const variables = getVariables({ type: 'message' });
        const battleData = variables?.stat_data?.battle;
        if (battleData?.core) {
          initialPlayerHp = battleData.core.hp || 100;
          initialPlayerLust = battleData.core.lust || 0;
        }
      } catch (error) {
        console.warn('无法获取初始状态数据:', error);
      }

      const battleResult = {
        result: result,
        // 玩家状态信息
        player: {
          initialHp: initialPlayerHp,
          finalHp: player.currentHp,
          maxHp: player.maxHp,
          initialLust: initialPlayerLust,
          finalLust: player.currentLust,
          maxLust: player.maxLust,
          statusEffects: playerStatusEffects,
          abilities: playerAbilities,
          remainingEnergy: player.energy,
          handSize: player.hand.length,
          deckSize: player.drawPile.length,
          discardSize: player.discardPile.length,
        },
        // 敌人状态信息
        enemy: enemy
          ? {
              name: enemy.name,
              finalHp: enemy.currentHp,
              maxHp: enemy.maxHp,
              finalLust: enemy.currentLust,
              maxLust: enemy.maxLust,
              statusEffects: enemy.statusEffects.map(status => ({
                name: status.name,
                stacks: status.stacks,
                type: status.type,
              })),
            }
          : null,
        // 战斗统计信息
        battleStats: {
          turnCount: gameState.currentTurn,
          totalTurns: gameState.currentTurn, // 总回合数
          timestamp: Date.now(),
        },
      };

      try {
        await insertOrAssignVariables({ battle_result: JSON.stringify(battleResult) }, { type: 'character' });
        console.log('✅ 详细战斗结果已保存到MVU变量');
      } catch (error) {
        console.error('❌ 保存战斗结果到MVU变量失败:', error);
      }
    } catch (error) {
      console.error('❌ 保存战斗结果失败:', error);
    }
  }

  /**
   * 清除战斗临时数据从MVU变量和游戏状态
   */
  private clearEnemyFromMVU(): void {
    try {
      // 按规范：不删除结构，仅清空字段；兼容两个路径
      updateVariablesWith(
        (variables: any) => {
          const statBattle = variables?.stat_data?.battle;
          const flatBattle = variables?.battle;
          const roots: any[] = [];
          if (statBattle && typeof statBattle === 'object' && statBattle.enemy) roots.push(statBattle.enemy);
          if (flatBattle && typeof flatBattle === 'object' && flatBattle.enemy) roots.push(flatBattle.enemy);

          const clearOne = (enemyRoot: any) => {
            if (!enemyRoot || typeof enemyRoot !== 'object') return;
            enemyRoot.name = '';
            enemyRoot.emoji = '';
            enemyRoot.max_hp = 0;
            enemyRoot.hp = 0;
            enemyRoot.max_lust = 100;
            enemyRoot.lust = 0;
            enemyRoot.description = '';
            enemyRoot.actions = [];
            enemyRoot.abilities = [];
            enemyRoot.status_effects = [];
            enemyRoot.lust_effect =
              enemyRoot.lust_effect && typeof enemyRoot.lust_effect === 'object' ? enemyRoot.lust_effect : {};
            if (!enemyRoot.lust_effect) enemyRoot.lust_effect = {};
            enemyRoot.lust_effect.name = '';
            enemyRoot.lust_effect.description = '';
            enemyRoot.lust_effect.effect = '';
            enemyRoot.action_mode = enemyRoot.action_mode || 'random';
            if (enemyRoot.action_config && typeof enemyRoot.action_config === 'object') {
              Object.keys(enemyRoot.action_config).forEach(k => delete enemyRoot.action_config[k]);
            } else {
              enemyRoot.action_config = {};
            }
          };

          roots.forEach(clearOne);
          console.log('✅ 已清空 MVU 的 battle.enemy 字段（保留结构）');
          return variables;
        },
        { type: 'message' },
      );
    } catch (error) {
      console.error('❌ 清除战斗临时数据失败:', error);
    }
  }

  /**
   * 处理加入手牌
   */
  private async handleAddCardToHand(target: string | undefined, cardData: any): Promise<void> {
    try {
      // 解析可选的数量（解析器会放在 expression._cardCount）
      const count = (this.currentExpression as any)?._cardCount || 1;
      for (let i = 0; i < count; i++) {
        const completeCard = this.ensureCompleteCardData(cardData);
        this.gameStateManager.addCardToHand(completeCard);
        console.log(`✅ 加入手牌: ${completeCard.name}`);
        BattleLog.addLog(`获得卡牌：${completeCard.name}`, 'info', {
          type: 'card',
          name: completeCard.name,
          details: completeCard.description || '',
        });
      }
    } catch (error) {
      console.error('❌ 加入手牌失败:', error);
    }
  }

  /**
   * 处理加入抽牌堆
   */
  private async handleAddCardToDeck(target: string | undefined, cardData: any): Promise<void> {
    try {
      const count = (this.currentExpression as any)?._cardCount || 1;
      for (let i = 0; i < count; i++) {
        const completeCard = this.ensureCompleteCardData(cardData);
        this.gameStateManager.addCardToDeck(completeCard);
        console.log(`✅ 加入抽牌堆: ${completeCard.name}`);
        BattleLog.addLog(`获得卡牌: ${completeCard.name} (加入抽牌堆)`, 'info');
      }
    } catch (error) {
      console.error('❌ 加入抽牌堆失败:', error);
    }
  }

  /**
   * 确保卡牌数据完整
   */
  private ensureCompleteCardData(cardData: any): any {
    // 如果是完整的卡牌对象，直接返回
    if (cardData && typeof cardData === 'object' && cardData.name && cardData.effect) {
      return {
        id: cardData.id || `generated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: cardData.name,
        emoji: cardData.emoji || '🃏',
        type: cardData.type || 'Skill',
        rarity: cardData.rarity || 'Common',
        cost: cardData.cost ?? 1,
        effect: cardData.effect,
        description: cardData.description || '由效果生成的卡牌',
        ...cardData, // 保留其他属性
      };
    }

    // 如果只是简单的ID或名称，创建基础卡牌
    const cardName = typeof cardData === 'string' ? cardData : cardData?.name || '未知卡牌';
    return {
      id: `generated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: cardName,
      emoji: '🃏',
      type: 'Skill',
      rarity: 'Common',
      cost: 1,
      effect: '',
      description: '由效果生成的基础卡牌',
    };
  }

  /**
   * 移除所有状态（正面+负面）
   */
  private async removeAllStatuses(targetType: 'player' | 'enemy'): Promise<void> {
    const entity = this.getEntity(targetType);
    if (!entity) return;

    const statusesToRemove = [...entity.statusEffects];

    for (const status of statusesToRemove) {
      await this.removeStatusEffect(targetType, status.id);
    }

    if (statusesToRemove.length > 0) {
      console.log(`✅ 移除了${targetType}的所有状态`);
      BattleLog.addLog(`移除了所有状态`, 'info');
    }
  }

  /**
   * 移除所有增益状态
   */
  private async removeAllBuffs(targetType: 'player' | 'enemy'): Promise<void> {
    const entity = this.getEntity(targetType);
    if (!entity) return;

    const buffsToRemove = entity.statusEffects.filter(status => {
      const statusDef = this.dynamicStatusManager.getStatusDefinition(status.id);
      return statusDef && statusDef.type === 'buff';
    });

    for (const buff of buffsToRemove) {
      await this.removeStatusEffect(targetType, buff.id);
    }

    if (buffsToRemove.length > 0) {
      console.log(`✅ 移除了${targetType}的所有增益状态`);
      BattleLog.addLog(`移除了所有增益状态`, 'info');
    }
  }

  /**
   * 移除所有减益状态
   */
  private async removeAllDebuffs(targetType: 'player' | 'enemy'): Promise<void> {
    const entity = this.getEntity(targetType);
    if (!entity) return;

    const debuffsToRemove = entity.statusEffects.filter(status => {
      const statusDef = this.dynamicStatusManager.getStatusDefinition(status.id);
      return statusDef && statusDef.type === 'debuff';
    });

    for (const debuff of debuffsToRemove) {
      await this.removeStatusEffect(targetType, debuff.id);
    }

    if (debuffsToRemove.length > 0) {
      console.log(`✅ 移除了${targetType}的所有减益状态`);
      BattleLog.addLog(`移除了所有减益状态`, 'info');
    }
  }

  /**
   * 移除指定状态效果
   */
  private async removeStatusEffect(targetType: 'player' | 'enemy', statusId: string): Promise<void> {
    const entity = this.getEntity(targetType);
    if (!entity) return;

    const statusIndex = entity.statusEffects.findIndex(s => s.id === statusId);
    if (statusIndex >= 0) {
      const removedStatus = entity.statusEffects[statusIndex];
      entity.statusEffects.splice(statusIndex, 1);

      console.log(`✅ 移除了${targetType}的状态: ${removedStatus.name}`);
      BattleLog.addLog(`移除了状态: ${removedStatus.name}`, 'info');

      // 触发移除时的效果
      const removeEffects = this.dynamicStatusManager.getStatusTriggerEffects(statusId, 'remove');
      for (const effect of removeEffects) {
        const processedEffect = effect.replace(/stacks/g, removedStatus.stacks.toString());
        const holderIsPlayer = targetType === 'player';
        await this.executeEffectString(processedEffect, holderIsPlayer, {
          triggerType: 'remove',
          statusContext: removedStatus,
        });
      }
    }
  }

  /**
   * 触发战斗结束叙事 - 增强版，包含详细的战斗信息
   */
  private async triggerBattleEndNarrative(result: 'victory' | 'defeat', narrativeText?: string): Promise<void> {
    try {
      const gameState = this.gameStateManager.getGameState();
      const player = gameState.player;
      const enemy = gameState.enemy;

      // 当 narrativeText 存在时，结果展示改为"战斗终止"
      const resultText = narrativeText ? '战斗终止' : result === 'victory' ? '胜利' : '失败';

      // 使用数组构建战斗总结，性能更好
      const summary: string[] = [`战斗结束！结果：${resultText}\n`];

      if (narrativeText) {
        summary.push(`【叙事】\n${narrativeText}\n`);
      }

      // 玩家状态信息
      summary.push(
        `【玩家状态】\n`,
        `- 生命值：${player.currentHp}/${player.maxHp}\n`,
        `- 欲望值：${player.currentLust}/${player.maxLust}\n`,
        `- 剩余能量：${player.energy}\n`,
      );

      // 玩家状态效果
      if (player.statusEffects.length > 0) {
        const statusList = player.statusEffects.map(s => `${s.name}${s.stacks > 1 ? s.stacks + '层' : ''}`).join('、');
        summary.push(`- 状态效果：${statusList}\n`);
      }

      // 敌人状态信息
      if (enemy) {
        summary.push(
          `\n【敌人状态】\n`,
          `- ${enemy.name}：生命值${enemy.currentHp}/${enemy.maxHp}，欲望值${enemy.currentLust}/${enemy.maxLust}\n`,
        );

        if (enemy.statusEffects.length > 0) {
          const enemyStatusList = enemy.statusEffects
            .map(s => `${s.name}${s.stacks > 1 ? s.stacks + '层' : ''}`)
            .join('、');
          summary.push(`- 状态效果：${enemyStatusList}\n`);
        }
      }

      // 战斗统计
      summary.push(
        `\n【战斗统计】\n`,
        `- 持续回合：${gameState.currentTurn}回合\n`,
        `- 手牌剩余：${player.hand.length}张\n`,
        `- 抽牌堆：${player.drawPile.length}张\n`,
        `- 弃牌堆：${player.discardPile.length}张\n`,
      );

      // 检查是否使用了叙事卡牌
      const narrativeCards = player.discardPile.filter(card => card.type === 'Event');
      if (narrativeCards.length > 0) {
        summary.push(`\n【叙事卡牌使用】\n`);
        narrativeCards.forEach(card => {
          summary.push(`- 使用了叙事卡牌：${card.name} - ${card.description}\n`);
        });
        summary.push(
          `\n请根据以上详细的战斗结果信息生成后续剧情，体现战斗过程对角色状态的影响。特别注意融入叙事卡牌的使用效果和影响。`,
        );
      } else {
        summary.push(`\n请根据以上详细的战斗结果信息生成后续剧情，体现战斗过程对角色状态的影响。`);
      }

      const battleSummary = summary.join('');

      // 弹出战斗结束确认弹窗，用户确认后才发起新对话
      await this.showBattleEndDialog(result, battleSummary, resultText);
      BattleLog.addLog(`战斗结束：${resultText}`, 'system');
    } catch (error) {
      console.error('❌ 触发战斗结束叙事失败:', error);
    }
  }

  /**
   * 显示战斗结束弹窗并处理后续对话
   */
  private async showBattleEndDialog(
    result: 'victory' | 'defeat',
    battleSummary: string,
    displayResultText?: string,
  ): Promise<void> {
    try {
      const resultText = displayResultText || (result === 'victory' ? '胜利' : '失败');
      const emoji = displayResultText === '战斗终止' ? '🕊️' : result === 'victory' ? '🎉' : '💀';

      // 使用jQuery创建模态弹窗
      const $dialog = $(`
        <div class="battle-end-dialog" style="
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          background: rgba(0, 0, 0, 0.8) !important;
          display: flex !important;
          justify-content: center !important;
          align-items: center !important;
          z-index: 99999 !important;
        ">
          <div style="
            background: white;
            border-radius: 12px;
            max-width: 500px;
            width: 90%;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          ">
            <div style="text-align: center; padding: 20px;">
              <h2 style="margin-bottom: 15px;">${emoji} 战斗结束！</h2>
              <h3 style="color: ${result === 'victory' ? '#4CAF50' : '#f44336'}; margin-bottom: 20px;">
                结果：${resultText}
              </h3>
              <p style="margin-bottom: 20px; font-size: 14px; color: #666;">
                点击确定将发起新的对话来描述后续剧情
              </p>
              <p style="margin-bottom: 10px; font-size: 14px; color: #999;">
                或者点击重新开始按钮重新游戏
              </p>
            </div>
            <div style="text-align: center; padding: 20px; border-top: 1px solid #eee;">
              <button class="battle-end-confirm" style="
                background: #4CAF50;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 6px;
                font-size: 16px;
                cursor: pointer;
                margin-right: 10px;
              ">确定</button>
              <button class="battle-end-restart" style="
                background: #2196F3;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 6px;
                font-size: 16px;
                cursor: pointer;
              ">🔄 重新开始</button>
            </div>
          </div>
        </div>
      `);

      // 添加到页面并立即显示
      $('body').append($dialog).css('overflow', 'hidden');
      $('#gameContainer, .game-interface').css('pointer-events', 'none');

      // 返回Promise，等待用户操作
      return new Promise(resolve => {
        // 确定按钮：显示加载提示，然后发起对话
        $dialog.find('.battle-end-confirm').on('click', async function () {
          const $btn = $(this);
          const originalText = $btn.text();

          // 禁用按钮并显示加载提示
          $btn.prop('disabled', true).text('正在生成对话...').css({
            background: '#999',
            cursor: 'not-allowed',
          });

          try {
            // 发起新对话
            await triggerSlash(`/send ${battleSummary}`);
            await triggerSlash('/trigger');

            // 关闭弹窗
            $dialog.remove();
            $('body').css('overflow', '');
            $('#gameContainer, .game-interface').css('pointer-events', '');
          } catch (error) {
            console.error('❌ 触发战斗结束叙事失败:', error);
            // 恢复按钮状态
            $btn.prop('disabled', false).text(originalText).css({
              background: '#4CAF50',
              cursor: 'pointer',
            });
          }
          resolve();
        });

        // 重新开始按钮：直接刷新页面
        $dialog.find('.battle-end-restart').on('click', () => {
          location.reload();
        });
      });
    } catch (error) {
      console.error('❌ 显示战斗结束弹窗失败:', error);
    }
  }

  /**
   * 使用选择器执行弃牌
   */
  private async executeDiscardWithSelector(selector: string, count: number): Promise<void> {
    if (this.verbose) console.log(`🎯 使用选择器 ${selector} 弃掉${count}张卡牌`);

    // 使用卡牌系统的选择器机制
    try {
      const selectedCards = await this.selectCardsWithSelector(selector, count);

      for (const card of selectedCards) {
        // 通过CardSystem的discardCard方法，这样会触发弃牌效果
        await this.cardSystem.discardCard(card.id);
        if (this.verbose) console.log(`弃掉卡牌: ${card.name}`);
      }

      if (this.verbose) console.log(`使用选择器 ${selector} 弃掉了${selectedCards.length}张卡牌`);
    } catch (error) {
      console.error('选择器弃牌失败:', error);
    }
  }

  /**
   * 弃置随机卡牌
   */
  private async discardRandomCards(count: number): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    let currentHand = [...player.hand];

    // 获取当前正在使用的卡牌（如果有）
    const currentlyPlayingCard = this.executionContext.currentCard;

    // 如果有正在使用的卡牌，从候选列表中排除
    if (currentlyPlayingCard) {
      currentHand = currentHand.filter(c => c.id !== currentlyPlayingCard.id);
      console.log(`🚫 排除当前正在使用的卡牌: ${currentlyPlayingCard.name}`);
    }

    // 随机排序
    const shuffledHand = this.fisherYatesShuffle(currentHand);
    const actualDiscardCount = Math.min(Number(count) || 0, shuffledHand.length);

    console.log(`🎲 随机弃牌: 需要弃置${count}张，实际弃置${actualDiscardCount}张`);

    // 收集要弃置的卡牌
    const cardsToDiscard = shuffledHand.slice(0, actualDiscardCount);

    // 逐张通过 CardSystem 的弃牌入口，确保触发弃牌效果与遗物
    for (const card of cardsToDiscard) {
      this.cardSystem.discardCard(card.id);
    }
  }

  /**
   * 触发叙事
   */
  private async triggerNarrative(text: string): Promise<void> {
    try {
      // 叙事事件视为战斗的结束分支之一，与战斗结束共用同一叙事方法
      await this.saveBattleResultToMVU('victory'); // 仍保存结果用于统计，但展示将使用“战斗终止”
      await this.triggerBattleEndNarrative('victory', text);
      console.log('✅ 已触发叙事(携带详细战斗数据):', text);
    } catch (error) {
      console.error('❌ 触发叙事失败:', error);
    }
  }

  /**
   * 减少卡牌费用
   */
  private async reduceCardsCost(
    selectionType: 'all' | 'choose' | 'leftmost' | 'rightmost' | 'random',
    reduction: number,
  ): Promise<void> {
    let selectedCards = await this.cardSystem.selectCards(selectionType as any, selectionType === 'all' ? 999 : 1);
    // 在选择阶段即过滤不可减费牌
    selectedCards = selectedCards.filter(
      c => (c as any).type !== 'Curse' && (c as any).cost !== 'energy' && Number((c as any).cost) > 0,
    );
    if (selectedCards.length === 0) {
      BattleLog.addLog('无可减费目标，效果跳过', 'info');
      return;
    }

    for (const card of selectedCards) {
      const oldCost = Number((card as any).cost) || 0;
      const newCost = Math.max(0, oldCost - reduction);
      (card as any).cost = newCost;
      console.log(`${card.name} 费用从 ${oldCost} 减少到 ${newCost}`);
      BattleLog.addLog(`减少费用：${card.name} ${oldCost} → ${newCost}`, 'info', { type: 'card', name: card.name });
    }

    // 交由 GameStateManager 自身的方法触发事件，此处不直接访问私有方法
    const hand = this.gameStateManager.getPlayer().hand;
    this.gameStateManager.updatePlayer({ hand });
  }

  /**
   * 复制选中的卡牌
   */
  private async copySelectedCard(selectionType: 'choose' | 'leftmost' | 'rightmost' | 'random'): Promise<void> {
    // 过滤不可减费/不可交互的牌时，需要在上游过滤；此处复制不限制
    const selectedCards = await this.cardSystem.selectCards(selectionType as any, 1);

    if (selectedCards.length === 0) {
      console.log('没有卡牌可复制');
      return;
    }

    const cardToCopy = selectedCards[0];
    const copiedCard = {
      ...cardToCopy,
      id: `${cardToCopy.id}_copy_${Date.now()}`, // 生成新的ID
    };

    // 添加到手牌
    const player = this.gameStateManager.getPlayer();
    const hand = [...player.hand, copiedCard] as any;
    this.gameStateManager.updatePlayer({ hand });

    console.log(`复制了卡牌: ${cardToCopy.name}`);
  }

  /**
   * 让选中的卡牌效果触发两次
   */
  private async triggerCardEffectTwice(
    selectionType: 'choose' | 'leftmost' | 'rightmost' | 'random' | 'all',
  ): Promise<void> {
    const selectedCards = await this.cardSystem.selectCards(selectionType as any, 1);

    if (selectedCards.length === 0) {
      console.log('没有卡牌可触发');
      return;
    }

    const card = selectedCards[0];

    // 标记这张卡牌下次使用时效果触发两次
    (card as any).doubleEffect = true;

    console.log(`${card.name} 下次使用时效果将触发两次`);
  }

  /**
   * 使用选择器执行弃牌操作
   */
  // 删除重复定义：保留上面的版本，此处改名避免冲突（不被调用，仅占位以避免名称冲突）
  private async executeDiscardWithSelectorV2(_selector: string, _count: number = 1): Promise<void> {
    // no-op
  }

  /**
   * 使用选择器执行减少费用操作
   */
  private async executeReduceCostWithSelector(selector: string, reduction: number): Promise<void> {
    const isAll = /(?:^|\.)all$/.test(selector) || selector === 'all';

    // 解析域（hand/draw/discard），默认 hand
    let domain: 'hand' | 'draw' | 'discard' = 'hand';
    let selectorCore = selector;
    const domainMatch = selector.match(/^(hand|draw|discard)\.(.+)$/);
    if (domainMatch) {
      domain = domainMatch[1] as any;
      selectorCore = domainMatch[2];
    }

    const playerState = this.gameStateManager.getPlayer();
    const pool =
      domain === 'hand' ? playerState.hand : domain === 'draw' ? playerState.drawPile : playerState.discardPile;
    const isReducible = (card: any) => card?.type !== 'Curse' && card?.cost !== 'energy' && Number(card?.cost) > 0;
    const eligible = pool.filter(isReducible);

    // 直接处理常用选择器以确保减费一定从可减费池中选
    if (/\brandom(\d+)?\b/.test(selectorCore)) {
      if (eligible.length === 0) {
        BattleLog.addLog('无可减费目标，效果跳过', 'info');
        return;
      }
      const countMatch = selectorCore.match(/random(\d+)/);
      const count = Math.max(1, Math.min(countMatch ? parseInt(countMatch[1], 10) : 1, eligible.length));
      const shuffled = this.fisherYatesShuffle([...eligible]);
      const selectedCards = shuffled.slice(0, count);
      for (const card of selectedCards) {
        const oldCost = Number((card as any).cost) || 0;
        const newCost = Math.max(0, oldCost - reduction);
        (card as any).cost = newCost;
        console.log(`${card.name} 费用从 ${oldCost} 减少到 ${newCost}`);
        BattleLog.addLog(`减少费用：${card.name} ${oldCost} → ${newCost}`, 'info', { type: 'card', name: card.name });
      }
      this.gameStateManager.updatePlayer({ hand: this.gameStateManager.getPlayer().hand });
      return;
    }

    if (/\ball\b/.test(selectorCore) || isAll) {
      if (eligible.length === 0) {
        BattleLog.addLog('无可减费目标，效果跳过', 'info');
        return;
      }
      for (const card of eligible) {
        const oldCost = Number((card as any).cost) || 0;
        const newCost = Math.max(0, oldCost - reduction);
        (card as any).cost = newCost;
        console.log(`${card.name} 费用从 ${oldCost} 减少到 ${newCost}`);
        BattleLog.addLog(`减少费用：${card.name} ${oldCost} → ${newCost}`, 'info', { type: 'card', name: card.name });
      }
      this.gameStateManager.updatePlayer({ hand: this.gameStateManager.getPlayer().hand });
      return;
    }

    if (/\bchoose\b/.test(selectorCore)) {
      if (eligible.length === 0) {
        BattleLog.addLog('无可减费目标，效果跳过', 'info');
        return;
      }
      let selectedCards: Card[] = [];
      try {
        selectedCards = await this.showCardSelectionUI(eligible as any, 1, '选择要减费的卡牌');
      } catch {
        selectedCards = [];
      }
      if (selectedCards.length === 0) return;
      const card = selectedCards[0] as any;
      const oldCost = Number(card.cost) || 0;
      const newCost = Math.max(0, oldCost - reduction);
      card.cost = newCost;
      console.log(`${card.name} 费用从 ${oldCost} 减少到 ${newCost}`);
      BattleLog.addLog(`减少费用：${card.name} ${oldCost} → ${newCost}`, 'info', { type: 'card', name: card.name });
      this.gameStateManager.updatePlayer({ hand: this.gameStateManager.getPlayer().hand });
      return;
    }

    // 其他情况，退回通用选择器，再次过滤
    let selectedCards = await this.selectCardsWithSelector(selector, isAll ? 999 : 1);
    selectedCards = selectedCards.filter(isReducible as any);
    if (selectedCards.length === 0) {
      BattleLog.addLog('无可减费目标，效果跳过', 'info');
      return;
    }

    for (const card of selectedCards) {
      const oldCost = Number((card as any).cost) || 0;
      const newCost = Math.max(0, oldCost - reduction);
      (card as any).cost = newCost;
      console.log(`${card.name} 费用从 ${oldCost} 减少到 ${newCost}`);
      BattleLog.addLog(`减少费用：${card.name} ${oldCost} → ${newCost}`, 'info', { type: 'card', name: card.name });
    }

    // 通过updatePlayer触发事件
    this.gameStateManager.updatePlayer({ hand: this.gameStateManager.getPlayer().hand });
    console.log(`使用选择器 ${selector} 减少了${selectedCards.length}张卡牌的费用`);
  }

  /**
   * 使用选择器执行复制卡牌操作
   */
  private async executeCopyCardWithSelector(selector: string): Promise<void> {
    const selectedCards = await this.selectCardsWithSelector(selector, 1);

    if (selectedCards.length === 0) {
      console.log('没有卡牌可复制');
      return;
    }

    const cardToCopy = selectedCards[0];
    const copiedCard = {
      ...cardToCopy,
      id: `${cardToCopy.id}_copy_${Date.now()}`, // 生成新的ID
    };

    // 添加到手牌
    const player = this.gameStateManager.getPlayer();
    this.gameStateManager.addCardToHand(copiedCard as any);

    console.log(`使用选择器 ${selector} 复制了卡牌: ${cardToCopy.name}`);
  }

  /**
   * 使用选择器执行触发效果两次操作
   */
  private async executeTriggerEffectWithSelector(selector: string): Promise<void> {
    const selectedCards = await this.selectCardsWithSelector(selector, 1);

    if (selectedCards.length === 0) {
      console.log('没有卡牌可触发');
      return;
    }

    const card = selectedCards[0];

    // 标记这张卡牌下次使用时效果触发两次
    (card as any).doubleEffect = true;

    console.log(`使用选择器 ${selector} 标记了 ${card.name} 下次使用时效果将触发两次`);
  }

  /**
   * 使用选择器选择卡牌
   */
  private async selectCardsWithSelector(selector: string, count: number): Promise<Card[]> {
    const player = this.gameStateManager.getPlayer();
    // 解析域前缀：hand.|draw.|discard.  默认为 hand
    let domain: 'hand' | 'draw' | 'discard' = 'hand';
    let selectorCore = selector;
    const domainMatch = selector.match(/^(hand|draw|discard)\.(.+)$/);
    if (domainMatch) {
      domain = domainMatch[1] as any;
      selectorCore = domainMatch[2];
    }

    let availableCards: Card[] = [];
    if (domain === 'hand') availableCards = [...player.hand];
    if (domain === 'draw') availableCards = [...player.drawPile];
    if (domain === 'discard') availableCards = [...player.discardPile];

    if (availableCards.length === 0) {
      return [];
    }

    // 处理组合选择器（用+分隔）
    const selectors = selectorCore.split('+');
    const selectedCards: Card[] = [];

    for (const sel of selectors) {
      const trimmedSel = sel.trim();
      let cardsFromThisSelector: Card[] = [];

      // 支持 all_cards：三个堆域全部一起选
      if (trimmedSel === 'all_cards') {
        const union = [...player.hand, ...player.drawPile, ...player.discardPile];
        for (const c of union) {
          if (!selectedCards.some(s => s.id === c.id)) selectedCards.push(c);
        }
        continue;
      }

      switch (trimmedSel) {
        case 'random': {
          // 通用随机：不带任何过滤，交由具体操作自行过滤（如减费）
          if (availableCards.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableCards.length);
            cardsFromThisSelector = [availableCards[randomIndex]];
          }
          break;
        }
        case 'leftmost': {
          if (availableCards.length > 0) {
            cardsFromThisSelector = [availableCards[0]];
          }
          break;
        }
        case 'rightmost': {
          if (availableCards.length > 0) {
            cardsFromThisSelector = [availableCards[availableCards.length - 1]];
          }
          break;
        }
        case 'all': {
          // 通用“全部”：不带任何过滤，交由具体操作（如减费）自行筛选
          cardsFromThisSelector = [...availableCards];
          break;
        }
        case 'choose': {
          try {
            cardsFromThisSelector = await this.showCardSelectionUI(availableCards, count, '选择要操作的卡牌');
          } catch (error) {
            console.log('用户取消了卡牌选择');
            cardsFromThisSelector = [];
          }
          if (cardsFromThisSelector.length === 0) {
            toastr?.info?.('无可选目标');
          }
          break;
        }
        default: {
          // 处理数字选择器，如 leftmost2, rightmost3, random2, choose1
          const numMatch = trimmedSel.match(/^(leftmost|rightmost|random|choose)(\d+)$/);
          if (numMatch) {
            const [, type, num] = numMatch;
            const numCards = Math.min(parseInt(num, 10), availableCards.length);

            if (type === 'leftmost') {
              cardsFromThisSelector = availableCards.slice(0, numCards);
            } else if (type === 'rightmost') {
              cardsFromThisSelector = availableCards.slice(-numCards);
            } else if (type === 'random') {
              const shuffled = this.fisherYatesShuffle([...availableCards]);
              cardsFromThisSelector = shuffled.slice(0, numCards);
            } else if (type === 'choose') {
              // 处理 choose1, choose2 等
              try {
                cardsFromThisSelector = await this.showCardSelectionUI(availableCards, numCards, '选择要操作的卡牌');
              } catch (error) {
                console.log('用户取消了卡牌选择');
                cardsFromThisSelector = [];
              }
              if (cardsFromThisSelector.length === 0) {
                toastr?.info?.('无可选目标');
              }
            }
          } else if (trimmedSel.startsWith('random') && /random\d+$/.test(trimmedSel)) {
            // 已由上面的分支处理，这里仅保证健壮性
            // no-op
          }
          break;
        }
      }

      // 添加到选中的卡牌列表，避免重复
      for (const card of cardsFromThisSelector) {
        if (!selectedCards.some(selected => selected.id === card.id)) {
          selectedCards.push(card);
        }
      }

      // 从可用卡牌中移除已选中的卡牌，避免重复选择
      availableCards = availableCards.filter(card => !cardsFromThisSelector.some(selected => selected.id === card.id));
    }

    // 如果包含 all/all_cards 选择器，则忽略数量限制，返回全部命中的卡
    const hasAllSelector = selectors.some(s => s.trim() === 'all' || s.trim() === 'all_cards');
    return hasAllSelector ? selectedCards : selectedCards.slice(0, count);
  }

  /**
   * 显示卡牌选择UI（通用版本）
   */
  private async showCardSelectionUI(
    availableCards: Card[],
    count: number,
    title: string = '选择卡牌',
    allowCancel: boolean = true,
  ): Promise<Card[]> {
    return new Promise((resolve, reject) => {
      if (!availableCards || availableCards.length === 0) {
        toastr?.info?.('无可选目标');
        return resolve([]);
      }
      const selectedCards: Card[] = [];

      // 创建选择模态框
      const modal = $(`
        <div class="card-selection-modal">
          <div class="modal-backdrop"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3>${title}</h3>
              <p>请选择 ${count} 张卡牌</p>
              <div class="selection-counter">已选择: <span class="selected-count">0</span> / ${count}</div>
            </div>
            <div class="modal-body">
              <div class="selection-cards-container">
                ${availableCards
                  .map(
                    card => `
                  <div class="selection-card" data-card-id="${card.id}">
                    <div class="card-emoji">${card.emoji}</div>
                    <div class="card-name">${card.name}</div>
                    <div class="card-cost">${card.cost}</div>
                    <div class="card-description">${card.description || ''}</div>
                  </div>
                `,
                  )
                  .join('')}
              </div>
            </div>
            <div class="modal-footer">
              ${allowCancel ? '<button class="btn btn-secondary cancel-selection">取消</button>' : ''}
              <button class="btn btn-primary confirm-selection" disabled>确认选择</button>
            </div>
          </div>
        </div>
      `);

      // 添加到页面
      $('body').append(modal);
      modal.fadeIn(200);

      // 卡牌选择事件
      modal.on('click', '.selection-card', function () {
        const cardId = $(this).data('card-id');
        const card = availableCards.find(c => c.id === cardId);

        if (!card) return;

        if ($(this).hasClass('selected')) {
          // 取消选择
          $(this).removeClass('selected');
          const index = selectedCards.findIndex(c => c.id === cardId);
          if (index > -1) {
            selectedCards.splice(index, 1);
          }
        } else if (selectedCards.length < count) {
          // 选择卡牌
          $(this).addClass('selected');
          selectedCards.push(card);
        }

        // 更新计数器和按钮状态
        modal.find('.selected-count').text(selectedCards.length);
        modal.find('.confirm-selection').prop('disabled', selectedCards.length !== count);
      });

      // 确认按钮
      modal.on('click', '.confirm-selection', () => {
        modal.fadeOut(200, () => modal.remove());
        resolve(selectedCards);
      });

      // 取消按钮
      modal.on('click', '.cancel-selection, .modal-backdrop', () => {
        if (allowCancel) {
          modal.fadeOut(200, () => modal.remove());
          reject(new Error('卡牌选择被取消'));
        }
      });
    });
  }

  /**
   * 检查字符串是否是数学表达式
   */
  private isMathExpression(value: string): boolean {
    // 检查是否包含数学运算符
    return /[+\-*/()]/.test(value) && /[a-zA-Z_]/.test(value);
  }

  /**
   * 计算动态变量值（支持数学表达式）
   */
  private calculateDynamicValue(expression: string, contextTargetType: 'player' | 'enemy'): number {
    try {
      console.log(`🧮 calculateDynamicValue 输入: expression="${expression}", contextTargetType=${contextTargetType}`);

      // 解析表达式中的变量引用
      let processedExpression = expression;

      // 首先处理 stacks 二次指向语法 (ME/OP/ALL.stacks.buffid)
      const stacksPattern = /(ME|OP|ALL)\.stacks\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
      processedExpression = processedExpression.replace(stacksPattern, (match, targetPrefix, stacksTarget) => {
        const stacksValue = this.resolveStacksReference(targetPrefix as 'ME' | 'OP' | 'ALL', stacksTarget);
        console.log(`🔄 解析stacks二次指向 ${match}: ${stacksValue}`);
        return stacksValue.toString();
      });

      console.log(`🧮 stacks处理后: processedExpression="${processedExpression}"`);

      // 匹配所有可能的变量引用（包括ME.属性和OP.属性）
      const variablePattern = /(ME|OP|ALL)\.([a-zA-Z_][a-zA-Z0-9_]*)|([a-zA-Z_][a-zA-Z0-9_]*)/g;

      processedExpression = processedExpression.replace(variablePattern, (match, prefix, attribute, standalone) => {
        let targetType: 'player' | 'enemy';
        let varName: string;

        if (prefix && attribute) {
          // ME.属性、OP.属性 或 ALL.属性 格式
          if (prefix === 'ALL') {
            // ALL.属性 的情况，对于普通属性取双方的平均值或总和（根据语义决定）
            // 但通常 ALL 应该只用于外层效果，不应该在这里作为变量引用
            console.warn(`⚠️ ALL.${attribute} 在表达式中作为变量引用，这可能不是预期的用法`);
            return '0';
          }

          if (prefix === 'ME') {
            targetType = this.executionContext.sourceIsPlayer ? 'player' : 'enemy';
          } else {
            // OP
            targetType = this.executionContext.sourceIsPlayer ? 'enemy' : 'player';
          }
          varName = attribute;
        } else if (standalone) {
          // 独立变量名，检查是否是玩家独有属性
          varName = standalone;

          // 特殊变量处理
          if (varName === 'stacks') {
            // stacks变量应该在传入前已经被替换，如果还存在说明上下文有问题
            const stacksValue = this.executionContext?.statusContext?.stacks || 0;
            console.log(`🔄 解析stacks变量: ${stacksValue}`);
            return stacksValue.toString();
          }

          // 玩家独有属性总是解析为玩家的值
          if (PLAYER_ONLY_ATTRIBUTES_SET.has(varName)) {
            targetType = 'player';
          } else {
            // 其他属性使用上下文目标
            targetType = contextTargetType;
          }
        } else {
          return match; // 无法解析，保持原样
        }

        // 直接从游戏状态获取最新值
        const gameState = this.gameStateManager.getGameState();
        const entity = targetType === 'player' ? (gameState as any).player : (gameState as any).enemy;

        if (!entity) {
          console.warn(`无法获取实体: ${targetType}`);
          return '0';
        }

        const value = this.getVariableValue(varName, entity);
        const displayName = this.getVariableDisplayName(varName);
        if (this.verbose) {
          console.log(
            `🔄 解析最新变量 ${match} -> ${value} (${targetType === 'player' ? '玩家' : '敌人'}的${displayName})`,
          );
        }
        const safeValue = Number.isFinite(value) ? value : 0;
        return safeValue.toString();
      });

      // 使用安全的数学表达式求值
      const result = this.evaluateMathExpression(processedExpression);
      console.log(`🧮 最终计算: ${expression} -> ${processedExpression} = ${result}`);
      return result;
    } catch (error) {
      console.error('❌ 动态变量计算失败:', error, '表达式:', expression);
      return 0;
    }
  }

  /**
   * 获取变量显示名称（中文）
   */
  private getVariableDisplayName(varName: string): string {
    // 统一复用 shared/variableNames，避免在多处维护映射
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { variableDisplayMap } = require('../shared/variableNames');
    return variableDisplayMap[varName] || varName;
  }

  /**
   * 解析 stacks 二次指向
   * 支持格式：
   * - ME.stacks.buffid - 我方的某个buff的层数
   * - OP.stacks.buffid - 对方的某个buff的层数
   * - ALL.stacks.buffid - 双方的某个buff的层数总和
   * - ME.stacks.all_buffs - 我方所有状态(正面+负面)的层数总和
   * - ME.stacks.buffs - 我方所有正面buff的层数总和
   * - ME.stacks.debuffs - 我方所有负面buff的层数总和
   */
  private resolveStacksReference(targetPrefix: 'ME' | 'OP' | 'ALL', stacksTarget: string): number {
    const player = this.gameStateManager.getPlayer();
    const enemy = this.gameStateManager.getEnemy();

    // 根据目标前缀确定实际目标
    const getTargetEntity = (prefix: 'ME' | 'OP'): Player | Enemy | null => {
      if (prefix === 'ME') {
        return this.executionContext.sourceIsPlayer ? player : enemy;
      } else {
        return this.executionContext.sourceIsPlayer ? enemy : player;
      }
    };

    // 获取指定实体的指定buff/debuff的层数
    const getStacksFromEntity = (entity: Player | Enemy | null, target: string): number => {
      if (!entity) return 0;

      if (target === 'all_buffs') {
        // 获取所有状态的层数总和（包括正面和负面）
        return entity.statusEffects.reduce((sum, s) => sum + (s.stacks || 0), 0);
      } else if (target === 'buffs') {
        // 获取所有正面buff的层数总和
        return entity.statusEffects
          .filter(s => {
            const def = this.dynamicStatusManager.getStatusDefinition(s.id);
            return def && def.type === 'buff';
          })
          .reduce((sum, s) => sum + (s.stacks || 0), 0);
      } else if (target === 'debuffs') {
        // 获取所有负面debuff的层数总和
        return entity.statusEffects
          .filter(s => {
            const def = this.dynamicStatusManager.getStatusDefinition(s.id);
            return def && def.type === 'debuff';
          })
          .reduce((sum, s) => sum + (s.stacks || 0), 0);
      } else {
        // 获取指定buffid的层数
        const status = entity.statusEffects.find(s => s.id === target);
        return status ? status.stacks : 0;
      }
    };

    // 根据目标前缀获取层数
    if (targetPrefix === 'ALL') {
      // ALL表示获取双方的总和
      const playerStacks = getStacksFromEntity(player, stacksTarget);
      const enemyStacks = getStacksFromEntity(enemy, stacksTarget);
      const total = playerStacks + enemyStacks;
      console.log(`🔢 解析ALL.stacks.${stacksTarget}: 玩家${playerStacks} + 敌人${enemyStacks} = ${total}`);
      return total;
    } else {
      const entity = getTargetEntity(targetPrefix);
      const stacks = getStacksFromEntity(entity, stacksTarget);
      const entityName = entity === player ? '玩家' : '敌人';
      console.log(`🔢 解析${targetPrefix}.stacks.${stacksTarget}: ${entityName}的${stacks}层`);
      return stacks;
    }
  }

  /**
   * 获取变量值
   */
  private getVariableValue(varName: string, entity: Player | Enemy): number {
    switch (varName) {
      case 'hp':
        return (entity as any).hp || (entity as any).currentHp || 0;
      case 'max_hp':
        return entity.maxHp || 0;
      case 'lust':
        return (entity as any).lust || (entity as any).currentLust || 0;
      case 'max_lust':
        return entity.maxLust || 0;
      case 'energy':
        return this.getEnergyValue(entity);
      case 'max_energy':
        return this.getMaxEnergyValue(entity);
      case 'block':
        return (entity as any).block || 0;
      case 'damage_modifier':
      case 'lust_damage_modifier':
      case 'damage_taken_modifier':
      case 'lust_damage_taken_modifier':
      case 'heal_modifier':
      case 'block_modifier':
      case 'draw':
      case 'discard':
      case 'energy_gain':
      case 'card_play_limit':
        // 修饰符从modifiers对象中获取
        const modifiersInCase = (entity as any).modifiers || {};
        return (modifiersInCase as any)[varName] || 0;
      case 'hand_size':
        // 手牌数只有玩家才有
        if ((entity as any).hand !== undefined) {
          return (entity as Player).hand.length || 0;
        } else {
          const player = this.gameStateManager.getPlayer();
          return player.hand.length || 0;
        }
      case 'cards_played_this_turn':
        // 本回合出牌数，从游戏状态获取
        const gameStateInCase = this.gameStateManager.getGameState();
        return (gameStateInCase as any)?.cardsPlayedThisTurn || 0;
      case 'deck_size':
        // 牌库数只有玩家才有
        if ((entity as any).drawPile !== undefined) {
          return (entity as Player).drawPile.length || 0;
        } else {
          const player = this.gameStateManager.getPlayer();
          return player.drawPile.length || 0;
        }
      case 'discard_pile_size':
        // 弃牌堆数只有玩家才有
        if ((entity as any).discardPile !== undefined) {
          return (entity as Player).discardPile.length || 0;
        } else {
          const player = this.gameStateManager.getPlayer();
          return player.discardPile.length || 0;
        }
      default:
        console.warn(`未知变量: ${varName}`);
        return 0;
    }
  }

  /**
   * 获取能量值 - 根据上下文决定使用哪个能量值
   */
  private getEnergyValue(entity: Player | Enemy): number {
    // 获取玩家实体（能量只有玩家才有）
    const player = (entity as any).energy !== undefined ? (entity as Player) : this.gameStateManager.getPlayer();

    if (!player) {
      return 0;
    }

    // 根据执行上下文决定使用哪个能量值
    const context = this.executionContext;

    // 1. 如果是在卡牌效果执行中，且需要使用打出前的能量值
    if (context.energyBeforeCardPlay !== undefined && context.cardContext) {
      console.log(`[Debug] 卡牌效果中使用打出前能量: ${context.energyBeforeCardPlay}`);
      return context.energyBeforeCardPlay;
    }

    // 2. 如果是在条件判断中，使用当前实时能量值
    if (context.triggerType === 'condition_evaluation') {
      const currentEnergy = player.energy || 0;
      console.log(`[Debug] 条件判断中使用当前能量: ${currentEnergy}`);
      return currentEnergy;
    }

    // 3. 默认情况下使用当前能量值
    const currentEnergy = player.energy || 0;
    console.log(`[Debug] 默认使用当前能量: ${currentEnergy}`);
    return currentEnergy;
  }

  /**
   * 获取最大能量值
   */
  private getMaxEnergyValue(entity: Player | Enemy): number {
    // 最大能量只有玩家才有
    const player = (entity as any).maxEnergy !== undefined ? (entity as Player) : this.gameStateManager.getPlayer();

    return player?.maxEnergy || 0;
  }

  /**
   * 安全的数学表达式求值
   */
  private evaluateMathExpression(expression: string): number {
    // 移除空格
    const cleanExpression = expression.replace(/\s+/g, '');

    // 验证表达式只包含数字、运算符和括号
    if (!/^[0-9+\-*/.()]+$/.test(cleanExpression)) {
      throw new Error(`不安全的表达式: ${expression}`);
    }

    try {
      // 使用Function构造器安全求值
      const result = new Function(`"use strict"; return (${cleanExpression})`)();

      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error(`表达式结果无效: ${result}`);
      }

      return Math.floor(result); // 向下取整到整数
    } catch (error) {
      console.error('数学表达式求值失败:', error);
      return 0;
    }
  }

  /**
   * 记录属性变化日志
   */
  private logAttributeChange(targetType: string, attribute: string, change: number, newValue: number): void {
    const target = targetType === 'player' ? '玩家' : '敌人';
    const attrName = this.getAttributeDisplayName(attribute);

    // 获取来源信息
    const sourceInfo = this.getEffectSourceInfo();
    // 对于状态效果，不使用前缀（BattleLog已经用图标显示状态名称，无需重复）
    // 对于其他来源（卡牌、能力等），使用前缀
    const sourcePrefix = sourceInfo && sourceInfo.logSource?.type !== 'status' ? `${sourceInfo.sourceName}-` : '';

    if (change > 0) {
      const message = `${sourcePrefix}${target}的${attrName}增加${change}点，当前${newValue}`;
      BattleLog.addLog(message, 'info', sourceInfo?.logSource);
    } else if (change < 0) {
      const message = `${sourcePrefix}${target}的${attrName}减少${Math.abs(change)}点，当前${newValue}`;
      BattleLog.addLog(message, 'info', sourceInfo?.logSource);
    }
  }

  /**
   * 获取属性显示名称
   */
  private getAttributeDisplayName(attribute: string): string {
    const attrDef = this.parser.getAttributeDefinition(attribute);
    return attrDef ? attrDef.displayName : attribute;
  }

  /**
   * 按优先级排序表达式
   */
  private sortExpressionsByPriority(expressions: EffectExpression[]): EffectExpression[] {
    // 为每个表达式添加原始索引，用于保持相同优先级时的原始顺序
    const indexedExpressions = expressions.map((expr, index) => ({ expr, index }));

    const sorted = indexedExpressions.sort((a, b) => {
      // 使用集中配置的优先级
      let priorityA = getAttributePriority(a.expr.attribute);
      let priorityB = getAttributePriority(b.expr.attribute);

      // 条件判断不再使用特殊优先级，而是保持原有顺序
      // 这样确保条件判断按照公式中的顺序执行
      if (a.expr.isConditional) priorityA = 999; // 使用最低优先级，让它在最后执行
      if (b.expr.isConditional) priorityB = 999;

      // 如果优先级相同，保持原始顺序
      if (priorityA === priorityB) {
        return a.index - b.index;
      }

      return priorityA - priorityB;
    });

    return sorted.map(item => item.expr);
  }

  /**
   * 重新加载动态状态定义
   */
  public loadDynamicStatusDefinitions(): void {
    this.dynamicStatusManager.forceReload();
  }

  /**
   * 获取动态状态定义
   */
  public getDynamicStatusDefinition(statusId: string): DynamicStatusDefinition | undefined {
    return this.dynamicStatusManager.getStatusDefinition(statusId);
  }

  /**
   * 处理状态效果的回合开始触发
   */
  public async processStatusEffectsAtTurnStart(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processStatusEffectsByTrigger(targetType, 'turn_start');
    // tick 改为在回合结束时触发，以避免与 apply 当回合冲突
    // 衰减在 turn_end 统一执行
  }

  /**
   * 处理状态效果的战斗开始触发
   */
  public async processStatusEffectsAtBattleStart(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processStatusEffectsByTrigger(targetType, 'battle_start');
  }

  /**
   * 处理状态效果的回合结束触发
   */
  public async processStatusEffectsAtTurnEnd(targetType: 'player' | 'enemy'): Promise<void> {
    // 先触发 tick（每回合效果），再触发 turn_end，然后再执行层数衰减
    await this.processStatusEffectsByTrigger(targetType, 'tick');
    await this.processStatusEffectsByTrigger(targetType, 'turn_end');
    // 回合结束再执行层数衰减/变化
    await this.applyStatusStacksDecay(targetType);
  }

  /**
   * 处理能力的回合开始触发
   */
  public async processAbilitiesAtTurnStart(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'turn_start');
  }

  /**
   * 处理能力的战斗开始触发
   */
  public async processAbilitiesAtBattleStart(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'battle_start');
  }

  /**
   * 处理能力的回合结束触发
   */
  public async processAbilitiesAtTurnEnd(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'turn_end');
  }

  /**
   * 处理能力的受到伤害触发
   */
  public async processAbilitiesOnTakeDamage(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'take_damage');
  }

  /**
   * 处理能力的受到治疗触发
   */
  public async processAbilitiesOnTakeHeal(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'take_heal');
  }

  /**
   * 处理能力的造成伤害触发
   */
  public async processAbilitiesOnDealDamage(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'deal_damage');
  }

  /**
   * 处理能力的造成治疗触发
   */
  public async processAbilitiesOnDealHeal(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'deal_heal');
  }

  /**
   * 处理能力的欲望增加触发
   */
  public async processAbilitiesOnLustIncrease(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'lust_increase');
  }

  /**
   * 处理能力的欲望减少触发
   */
  public async processAbilitiesOnLustDecrease(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'lust_decrease');
  }

  /**
   * 处理能力的造成欲望增加触发
   */
  public async processAbilitiesOnDealLustIncrease(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'deal_lust_increase');
  }

  /**
   * 处理能力的造成欲望减少触发
   */
  public async processAbilitiesOnDealLustDecrease(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'deal_lust_decrease');
  }

  /**
   * 处理能力的获得增益触发
   */
  public async processAbilitiesOnGainBuff(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'gain_buff');
  }

  /**
   * 处理能力的获得减益触发
   */
  public async processAbilitiesOnGainDebuff(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'gain_debuff');
  }

  /**
   * 处理能力的失去增益触发
   */
  public async processAbilitiesOnLoseBuff(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'lose_buff');
  }

  /**
   * 处理能力的失去减益触发
   */
  public async processAbilitiesOnLoseDebuff(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'lose_debuff');
  }

  /**
   * 处理能力的敌人获得增益触发
   */
  public async processAbilitiesOnEnemyGainBuff(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'enemy_gain_buff');
  }

  /**
   * 处理能力的敌人获得减益触发
   */
  public async processAbilitiesOnEnemyGainDebuff(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'enemy_gain_debuff');
  }

  /**
   * 处理能力的敌人失去增益触发
   */
  public async processAbilitiesOnEnemyLoseBuff(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'enemy_lose_buff');
  }

  /**
   * 处理能力的敌人失去减益触发
   */
  public async processAbilitiesOnEnemyLoseDebuff(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'enemy_lose_debuff');
  }

  /**
   * 处理能力的获得能力时触发
   */
  public async processAbilitiesOnAbilityGain(targetType: 'player' | 'enemy'): Promise<void> {
    await this.processAbilitiesByTrigger(targetType, 'ability_gain');
  }

  /**
   * 通用的状态效果触发处理
   */
  private async processStatusEffectsByTrigger(targetType: 'player' | 'enemy', trigger: string): Promise<void> {
    const entity = this.getEntity(targetType);
    if (!entity) return;

    const effectsToProcess = [...entity.statusEffects];

    for (const status of effectsToProcess) {
      // 只处理支持的触发类型
      const supportedTriggers = ['apply', 'remove', 'tick', 'stack'] as const;
      if (!supportedTriggers.includes(trigger as any)) continue;

      const triggerEffects = this.dynamicStatusManager.getStatusTriggerEffects(status.id, trigger as any);
      for (const effect of triggerEffects) {
        // 替换效果字符串中的 'stacks' 占位符并计算数学表达式
        const processedEffect = this.processStacksExpression(effect, status.stacks);
        const holderIsPlayer = targetType === 'player';
        await this.executeEffectString(processedEffect, holderIsPlayer, {
          triggerType: trigger,
          statusContext: status,
        });
      }
    }
  }

  /**
   * 通用的能力触发处理
   */
  public async processAbilitiesByTrigger(targetType: 'player' | 'enemy', trigger: string): Promise<void> {
    const entity = this.getEntity(targetType);
    if (!entity || !entity.abilities) return;

    const abilitiesToProcess = [...entity.abilities];

    for (const ability of abilitiesToProcess) {
      if (!ability.effect) {
        console.warn(`能力格式错误，缺少效果: ${JSON.stringify(ability)}`);
        continue;
      }

      // 解析新的能力语法：trigger(effect1, effect2, ...)
      let abilityTrigger: string;
      let abilityEffects: string;

      // 检查是否是新的括号语法
      const bracketMatch = ability.effect.match(/^(?:(ME|OP)\.)?([\w_]+)\((.+)\)$/);
      if (bracketMatch) {
        const [, _optionalTarget, triggerPart, effectsPart] = bracketMatch as unknown as [
          string,
          string?,
          string,
          string,
        ];
        abilityTrigger = triggerPart;
        abilityEffects = effectsPart;
      } else {
        // 仅支持新的括号格式（可选 ME.|OP. 前缀）
        console.warn(`能力格式错误，应使用新格式 trigger(effects): ${ability.effect}`);
        continue;
      }

      if (abilityTrigger === trigger) {
        console.log(`🔥 触发能力: ${trigger}(${abilityEffects}) (${targetType})`);

        // 执行能力效果 - 能力的发动者就是拥有该能力的实体
        // 效果日志会在executeExpression中由getEffectSourceInfo自动生成
        await this.executeEffectString(abilityEffects, targetType === 'player', {
          triggerType: trigger,
          abilityContext: ability,
        });

        // 不需要重复记录日志，executeExpression已经记录了详细的效果日志
      }
    }
  }

  /**
   * 处理状态效果的层数变化和持续时间
   */
  private async applyStatusStacksDecay(targetType: 'player' | 'enemy'): Promise<void> {
    const entity = this.getEntity(targetType);
    if (!entity) return;

    const updatedEffects = entity.statusEffects
      .map(effect => {
        const newEffect = { ...effect };

        // 处理层数衰减/变化系统
        const statusDef = this.dynamicStatusManager.getStatusDefinition(effect.id);
        if (statusDef && statusDef.stacks_change !== undefined) {
          const change = statusDef.stacks_change;

          if (typeof change === 'number') {
            if (change > 0) {
              // 正数：每回合增加层数
              newEffect.stacks = Math.max(0, newEffect.stacks + change);
            } else if (change < 0) {
              // 负数：每回合减少层数
              newEffect.stacks = Math.max(0, newEffect.stacks + change);
            }
            // 0：不变化
          } else if (typeof change === 'string') {
            // 处理百分比变化，如 "x0.5"
            if (change.startsWith('x')) {
              const multiplier = parseFloat(change.substring(1));
              if (!isNaN(multiplier)) {
                newEffect.stacks = Math.floor(newEffect.stacks * multiplier);
              }
            }
          }
        }

        return newEffect;
      })
      .filter(effect => {
        // 移除层数为0的状态
        const hasStacks = effect.stacks > 0;
        return hasStacks;
      });

    if (targetType === 'player') {
      this.gameStateManager.updatePlayer({ statusEffects: updatedEffects });
    } else {
      this.gameStateManager.updateEnemy({ statusEffects: updatedEffects });
    }

    // 记录移除的状态，并触发移除效果
    const removedEffects = entity.statusEffects.filter(
      oldEffect => !updatedEffects.some(newEffect => newEffect.id === oldEffect.id),
    );

    for (const removedEffect of removedEffects) {
      console.log(`✅ 状态效果结束: ${removedEffect.name} (${targetType})`);
      BattleLog.addLog(`状态效果结束: ${removedEffect.name}`, 'info');

      // 触发移除时的效果（包括清理修饰符）
      try {
        const removeEffects = this.dynamicStatusManager.getStatusTriggerEffects(removedEffect.id, 'remove');
        for (const effect of removeEffects) {
          const processedEffect = effect.replace(/stacks/g, removedEffect.stacks.toString());
          const holderIsPlayer = targetType === 'player';
          await this.executeEffectString(processedEffect, holderIsPlayer, {
            triggerType: 'remove',
            statusContext: removedEffect,
          });
        }

        // 清理直接修饰符（如果有的话）
        this.clearDirectModifiers(entity, removedEffect.id);
      } catch (error) {
        console.error('处理状态移除效果失败:', error);
      }
    }
  }

  /**
   * 添加能力
   */
  private async addAbilityNewImpl(targetType: 'player' | 'enemy', abilityEffect: string): Promise<void> {
    const entity = this.getEntity(targetType);
    if (!entity) return;

    // 新的能力格式：trigger(effect1, effect2, ...)
    let trigger: string;

    const bracketMatch = abilityEffect.match(/^(?:(ME|OP)\.)?([\w_]+)\((.+)\)$/);
    if (bracketMatch) {
      // 新格式（可选 ME.|OP. 前缀）
      trigger = bracketMatch[2];
    } else {
      // 不再支持旧格式
      console.error('能力格式错误，应为 trigger(effects)');
      return;
    }

    // 支持多个相同能力的叠加，不检查重复
    const newAbility = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      trigger,
      effect: abilityEffect,
    } as any;

    const updatedAbilities = [...(entity.abilities || []), newAbility] as any;

    if (targetType === 'player') {
      this.gameStateManager.updatePlayer({ abilities: updatedAbilities });
    } else {
      this.gameStateManager.updateEnemy({ abilities: updatedAbilities });
    }

    console.log(`✅ 添加能力: ${abilityEffect} (${targetType})`);
    BattleLog.addLog(`获得能力: ${abilityEffect}`, 'info');

    // 触发获得能力时的效果
    await this.processAbilitiesOnAbilityGain(targetType);

    // battle_start 只在游戏初始化时通过 processAbilitiesAtBattleStart 触发，不在添加能力时触发
  }

  /**
   * 移除能力
   */
  private async removeAbility(targetType: 'player' | 'enemy', abilityIdentifier: string): Promise<void> {
    const entity = this.getEntity(targetType);
    if (!entity) return;

    let updatedAbilities;
    let removedCount = 0;

    // 按完整效果匹配移除
    updatedAbilities = (entity.abilities || []).filter((ability: any) => {
      const shouldRemove = ability.effect === abilityIdentifier;
      if (shouldRemove) removedCount++;
      return !shouldRemove;
    });

    if (removedCount > 0) {
      if (targetType === 'player') {
        this.gameStateManager.updatePlayer({ abilities: updatedAbilities });
      } else {
        this.gameStateManager.updateEnemy({ abilities: updatedAbilities });
      }

      console.log(`✅ 移除能力: ${abilityIdentifier} (${targetType})`);
      BattleLog.addLog(`失去能力: ${abilityIdentifier}`, 'info');
    } else {
      console.log(`⚠️ 未找到要移除的能力: ${abilityIdentifier} (${targetType})`);
    }
  }

  /**
   * 处理包含stacks的数学表达式
   */
  private processStacksExpression(effect: string, stacks: number): string {
    // 替换 stacks 占位符
    let processedEffect = effect.replace(/stacks/g, stacks.toString());

    // 为没有ME前缀的修饰符自动添加ME前缀
    const modifierTypes = [
      'damage_modifier',
      'lust_damage_modifier',
      'received_damage_modifier',
      'received_lust_damage_modifier',
      'block_modifier',
      'energy_modifier',
      'card_play_limit',
      'draw_limit',
    ];

    for (const modifierType of modifierTypes) {
      // 匹配没有ME.前缀的修饰符（使用简单的字符串匹配避免负向后查找兼容性问题）
      const pattern = `ME.${modifierType}`;
      if (!processedEffect.includes(pattern)) {
        // 只有在不包含ME.前缀时才替换
        const regex = new RegExp(`\\b${modifierType}\\b`, 'g');
        processedEffect = processedEffect.replace(regex, `ME.${modifierType}`);
      }
    }

    // 查找并计算数学表达式，如 "2 * 0.25"
    const mathExpressionRegex = /(\d+(?:\.\d+)?)\s*([*\/])\s*(\d+(?:\.\d+)?)/g;
    processedEffect = processedEffect.replace(mathExpressionRegex, (match, num1, operator, num2) => {
      const a = parseFloat(num1);
      const b = parseFloat(num2);
      let result: number;

      switch (operator) {
        case '*':
          result = a * b;
          break;
        case '/':
          result = a / b;
          break;
        default:
          return match; // 不支持的操作符，返回原始字符串
      }

      // 保留小数点后两位
      return result.toFixed(2).replace(/\.?0+$/, '');
    });

    return processedEffect;
  }

  /**
   * Fisher-Yates 洗牌算法（标准洗牌算法，保证均匀随机）
   */
  private fisherYatesShuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
