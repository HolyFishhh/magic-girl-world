/**
 * 统一效果显示器 - 使用新的统一效果解析器生成UI显示
 *
 * 负责：
 * 1. 将统一效果表达式转换为用户友好的显示文本
 * 2. 根据效果的正负性和目标显示不同的颜色和图标
 * 3. 符合游戏逻辑的显示方式
 */

import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import {
  ATTRIBUTE_DISPLAY_CONFIG,
  PLAYER_ONLY_ATTRIBUTES_SET,
  TRIGGER_DISPLAY_CONFIG,
} from '../combat/effectDefinitions';
import { EffectExpression, UnifiedEffectParser } from '../combat/unifiedEffectParser';

export interface EffectDisplayTag {
  text: string;
  icon: string;
  color: string;
  category: 'beneficial' | 'harmful' | 'neutral' | 'utility' | 'special';
}

export class UnifiedEffectDisplay {
  private static instance: UnifiedEffectDisplay;
  private parser: UnifiedEffectParser;
  private statusManager: DynamicStatusManager;

  // 属性显示配置（使用集中配置，保留本地定义以支持特殊UI场景）
  private attributeDisplayConfig = ATTRIBUTE_DISPLAY_CONFIG;

  // 本地扩展配置（仅用于特殊UI展示需求）
  private localAttributeDisplayConfig = {
    hp: {
      name: '生命值',
      positiveIcon: '💚',
      negativeIcon: '💔',
      positiveColor: '#44ff44',
      negativeColor: '#ff4444',
    },
    lust: {
      name: '欲望值',
      positiveIcon: '💕',
      negativeIcon: '✨',
      positiveColor: '#ff69b4',
      negativeColor: '#87ceeb',
    },
    energy: {
      name: '能量',
      positiveIcon: '⚡',
      negativeIcon: '⚡',
      positiveColor: '#ffff00',
      negativeColor: '#888888',
    },
    block: {
      name: '格挡',
      positiveIcon: '🛡️',
      negativeIcon: '🛡️',
      positiveColor: '#4169e1',
      negativeColor: '#888888',
    },
    max_hp: {
      name: '最大生命值',
      positiveIcon: '💪',
      negativeIcon: '💔',
      positiveColor: '#44ff44',
      negativeColor: '#ff4444',
    },
    max_lust: {
      name: '最大欲望值',
      positiveIcon: '💖',
      negativeIcon: '💔',
      positiveColor: '#ff69b4',
      negativeColor: '#ff4444',
    },
    max_energy: {
      name: '最大能量',
      positiveIcon: '⚡',
      negativeIcon: '⚡',
      positiveColor: '#ffff00',
      negativeColor: '#888888',
    },
    draw: {
      name: '抽牌',
      positiveIcon: '🃏',
      negativeIcon: '🃏',
      positiveColor: '#ffd700',
      negativeColor: '#888888',
    },
    discard: {
      name: '弃牌',
      positiveIcon: '🗂️',
      negativeIcon: '🗂️',
      positiveColor: '#888888',
      negativeColor: '#ff4444',
    },
    damage_modifier: {
      name: '伤害修饰',
      positiveIcon: '⚔️',
      negativeIcon: '⚔️',
      positiveColor: '#ef4444',
      negativeColor: '#ef4444',
    },
    lust_damage_modifier: {
      name: '欲望伤害修饰',
      positiveIcon: '💖',
      negativeIcon: '💖',
      positiveColor: '#ec4899',
      negativeColor: '#ec4899',
    },
    lust_damage_taken_modifier: {
      name: '受到欲望伤害修饰',
      positiveIcon: '💔',
      negativeIcon: '💔',
      positiveColor: '#dc2626',
      negativeColor: '#dc2626',
    },
    damage_taken_modifier: {
      name: '受到伤害修饰',
      positiveIcon: '🛡️',
      negativeIcon: '⚔️',
      positiveColor: '#10b981',
      negativeColor: '#ef4444',
    },
    block_modifier: {
      name: '格挡修饰',
      positiveIcon: '🛡️',
      negativeIcon: '🛡️',
      positiveColor: '#3b82f6',
      negativeColor: '#3b82f6',
    },
    add_to_hand: {
      name: '加入手牌',
      positiveIcon: '🃏',
      negativeIcon: '🃏',
      positiveColor: '#10b981',
      negativeColor: '#10b981',
    },
    add_to_deck: {
      name: '加入抽牌堆',
      positiveIcon: '📚',
      negativeIcon: '📚',
      positiveColor: '#8b5cf6',
      negativeColor: '#8b5cf6',
    },
  };

  // 触发器显示配置（使用集中配置）
  private prefixDisplayConfig = TRIGGER_DISPLAY_CONFIG;

  private constructor() {
    this.parser = UnifiedEffectParser.getInstance();
    this.statusManager = DynamicStatusManager.getInstance();
  }

  public static getInstance(): UnifiedEffectDisplay {
    if (!UnifiedEffectDisplay.instance) {
      UnifiedEffectDisplay.instance = new UnifiedEffectDisplay();
    }
    return UnifiedEffectDisplay.instance;
  }

  /**
   * 获取属性显示配置（优先使用集中配置，回退到本地扩展）
   */
  private getAttributeConfig(attribute: string): any {
    return this.attributeDisplayConfig[attribute] || this.localAttributeDisplayConfig[attribute];
  }

  /**
   * 获取触发器显示配置
   */
  private getTriggerConfig(trigger: string): any {
    return this.prefixDisplayConfig[trigger];
  }

  /**
   * 解析效果字符串为显示标签
   */
  public parseEffectToTags(
    effectString: string,
    context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
  ): EffectDisplayTag[] {
    if (!effectString || effectString.trim() === '') {
      return [];
    }

    const expressions = this.parser.parseEffectString(effectString);
    const tags: EffectDisplayTag[] = [];

    for (const expression of expressions) {
      if (!expression.isValid) {
        // 显示错误的效果
        tags.push({
          text: `错误: ${expression.raw}`,
          icon: '❌',
          color: '#ff4444',
          category: 'harmful',
        });
        continue;
      }

      const displayTags = this.convertExpressionToTags(expression, context);
      tags.push(...displayTags);
    }

    return tags;
  }

  /**
   * 解析带触发条件的效果字符串（用于状态效果）
   */
  public parseTriggeredEffectToTags(
    triggerType: string,
    effectString: string,
    context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
  ): EffectDisplayTag[] {
    if (!effectString || effectString.trim() === '') {
      return [];
    }

    const expressions = this.parser.parseEffectString(effectString);
    const tags: EffectDisplayTag[] = [];

    // 获取触发条件配置
    const triggerConfig = this.getTriggerConfig(triggerType);

    // 添加效果标签，但合并为一个整体描述
    const effectTexts: string[] = [];
    for (const expression of expressions) {
      if (!expression.isValid) {
        effectTexts.push(`错误: ${expression.raw}`);
        continue;
      }

      const displayTags = this.convertExpressionToTags(expression, context);
      effectTexts.push(...displayTags.map(tag => tag.text));
    }

    // 将触发条件和效果合并为一个标签
    if (effectTexts.length > 0) {
      const combinedText = triggerConfig ? `${triggerConfig.name}：${effectTexts.join('，')}` : effectTexts.join('，');

      tags.push({
        text: combinedText,
        color: triggerConfig?.color || '#e2e8f0',
        icon: triggerConfig?.icon || '⚡',
        category: 'special',
      });
    }

    return tags;
  }

  /**
   * 将单个表达式转换为显示标签
   */
  private convertExpressionToTags(
    expression: EffectExpression,
    context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
  ): EffectDisplayTag[] {
    const tags: EffectDisplayTag[] = [];

    // 对于带前缀的效果，我们将前缀和效果合并为一个标签
    if (expression.prefix) {
      const prefixConfig = this.getTriggerConfig(expression.prefix);
      let effectText = '';
      let effectIcon = '⚡';

      // 获取主要效果的文本
      if (expression.attribute === 'status') {
        const statusTags = this.convertStatusEffectToTags(expression, context);
        effectText = statusTags.map(tag => tag.text).join('，');
        if (statusTags.length > 0) {
          effectIcon = statusTags[0].icon;
        }
      } else if (expression.attribute === 'narrate') {
        effectText = `叙事: ${expression.value}`;
        effectIcon = '📖';
      } else {
        const attributeTags = this.convertAttributeEffectToTags(expression, context);
        effectText = attributeTags.map(tag => tag.text).join('，');
        if (attributeTags.length > 0) {
          effectIcon = attributeTags[0].icon;
        }
      }

      // 合并前缀和效果为一个标签
      if (prefixConfig && effectText) {
        tags.push({
          text: `${prefixConfig.name}: ${effectText}`,
          icon: `${prefixConfig.icon}${effectIcon}`,
          color: prefixConfig.color,
          category: 'special',
        });
      }
    } else {
      // 没有前缀的普通效果
      if (expression.isConditional) {
        // 条件表达式
        const conditionalTags = this.convertConditionalExpressionToTags(expression, context);
        tags.push(...conditionalTags);
      } else if (expression.attribute === 'ability') {
        // 能力效果 - 处理新的能力语法
        const abilityTags = this.convertAbilityEffectToTags(expression, context);
        tags.push(...abilityTags);
      } else if (expression.attribute === 'status') {
        // 状态效果
        const statusTags = this.convertStatusEffectToTags(expression, context);
        tags.push(...statusTags);
      } else if (expression.attribute === 'narrate') {
        // 叙事效果
        tags.push({
          text: `叙事: ${expression.value}`,
          icon: '📖',
          color: '#9370db',
          category: 'utility',
        });
      } else if (expression.selector) {
        // 带选择器的卡牌操作效果
        const cardOperationTags = this.convertCardOperationToTags(expression, context);
        tags.push(...cardOperationTags);
      } else {
        // 基础属性效果
        const attributeTags = this.convertAttributeEffectToTags(expression, context);
        tags.push(...attributeTags);
      }
    }

    return tags;
  }

  /**
   * 转换条件表达式为显示标签
   */
  private convertConditionalExpressionToTags(
    expression: EffectExpression,
    context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
  ): EffectDisplayTag[] {
    if (!expression.isConditional || !expression.condition) {
      return [];
    }

    // 优先使用解析器生成的完整描述
    let description = expression.description;

    if (!description) {
      // 如果没有描述，构建一个详细的描述
      const conditionText = this.translateCondition(expression.condition);
      const trueEffectText = expression.trueEffect ? this.parseEffectDescription(expression.trueEffect) : '';

      if (expression.falseEffect && expression.falseEffect.trim() !== '') {
        const falseEffectText = this.parseEffectDescription(expression.falseEffect);
        description = `如果${conditionText}，则${trueEffectText}；否则${falseEffectText}`;
      } else {
        description = `如果${conditionText}，则${trueEffectText}`;
      }
    }

    // 根据条件复杂度选择不同的图标和颜色
    const isComplexCondition =
      expression.condition.includes('&&') || expression.condition.includes('||') || expression.falseEffect;

    return [
      {
        text: description,
        icon: isComplexCondition ? '🔀' : '❓',
        color: isComplexCondition ? '#9333ea' : '#8b5cf6',
        category: 'special',
      },
    ];
  }

  /**
   * 翻译条件表达式为中文（从解析器复制）
   */
  private translateCondition(condition: string): string {
    // 替换变量名为中文
    let translatedCondition = this.replaceVariablesInExpression(condition);

    // 替换操作符为数学符号
    translatedCondition = translatedCondition
      .replace(/>=/g, '≥')
      .replace(/<=/g, '≤')
      .replace(/==/g, '=')
      .replace(/!=/g, '≠')
      .replace(/>/g, '＞')
      .replace(/</g, '＜');

    return translatedCondition;
  }

  /**
   * 替换表达式中的变量引用为中文显示名称
   */
  private replaceVariablesInExpression(expression: string): string {
    // 复用共享映射，避免重复
    const variableNamesMod = require('../shared/variableNames');
    const variableDisplayMap: { [key: string]: string } =
      (variableNamesMod && variableNamesMod.variableDisplayMap) || {};

    let result = expression;

    // 先处理 stacks 二次指向（优先级更高）
    result = result.replace(/(ME|OP|ALL)\.stacks\.(\w+)/g, (_, target, buffid) => {
      const targetName = target === 'ME' ? '己方' : target === 'OP' ? '对方' : '双方';
      // 尝试获取buff的显示名称
      const statusDef = this.statusManager?.getStatusDefinition(buffid);
      const buffName = statusDef?.name || buffid;
      return `${targetName}${buffName}层数`;
    });

    // 替换ME.属性、OP.属性和ALL.属性
    result = result.replace(/(ME|OP|ALL)\.(\w+)/g, (_, target, attribute) => {
      const displayName = variableDisplayMap[attribute] || this.getAttributeDisplayName(attribute) || attribute;
      const targetName = target === 'ME' ? '己方' : target === 'OP' ? '对方' : '双方';
      return `${targetName}的${displayName}`;
    });

    // 替换独立变量
    Object.entries(variableDisplayMap).forEach(([variable, displayName]) => {
      const regex = new RegExp(`\\b${variable}\\b`, 'g');
      result = result.replace(regex, displayName);
    });

    return result;
  }

  /**
   * 转换能力效果为显示标签
   */
  private convertAbilityEffectToTags(
    expression: EffectExpression,
    context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
  ): EffectDisplayTag[] {
    const abilityString = expression.value.toString();

    // 检查新的括号格式：trigger(effects)
    const bracketMatch = abilityString.match(/^([\w_]+)\((.+)\)$/);
    if (bracketMatch) {
      const [, trigger, effectPart] = bracketMatch;

      // 获取触发条件的配置
      const triggerConfig = this.getTriggerConfig(trigger);

      if (triggerConfig) {
        // 解析内部效果字符串并生成更详细的描述
        try {
          const innerExpressions = this.parser.parseEffectString(effectPart);
          const effectDescriptions: string[] = [];

          for (const innerExpr of innerExpressions) {
            if (!innerExpr.isValid) {
              effectDescriptions.push(innerExpr.raw);
              continue;
            }

            // 条件表达式（if[...] 或 if[...]else[...]）
            if (innerExpr.isConditional) {
              const conditionalTags = this.convertConditionalExpressionToTags(innerExpr, context);
              if (conditionalTags.length > 0) {
                effectDescriptions.push(...conditionalTags.map(tag => tag.text));
              } else if (innerExpr.description) {
                effectDescriptions.push(innerExpr.description);
              } else {
                effectDescriptions.push(innerExpr.raw);
              }
              continue;
            }

            // 避免递归调用，针对已知类型分别处理
            if (innerExpr.attribute === 'status') {
              const statusTags = this.convertStatusEffectToTags(innerExpr, context);
              effectDescriptions.push(...statusTags.map(tag => tag.text));
            } else if (innerExpr.attribute === 'narrate') {
              effectDescriptions.push(`叙事: ${innerExpr.value}`);
            } else if (innerExpr.selector) {
              const cardOperationTags = this.convertCardOperationToTags(innerExpr, context);
              effectDescriptions.push(...cardOperationTags.map(tag => tag.text));
            } else {
              // 基础属性效果
              const attributeTags = this.convertAttributeEffectToTags(innerExpr, context);
              effectDescriptions.push(...attributeTags.map(tag => tag.text));
            }
          }

          const effectText = effectDescriptions.length > 0 ? effectDescriptions.join('，') : effectPart;

          return [
            {
              text: `${triggerConfig.name}: ${effectText}`,
              icon: `${triggerConfig.icon}⚡`,
              color: triggerConfig.color,
              category: 'special',
            },
          ];
        } catch (error) {
          console.warn('解析能力内部效果失败:', error);
          // 回退到简单显示
          return [
            {
              text: `${triggerConfig.name}: ${effectPart}`,
              icon: `${triggerConfig.icon}⚡`,
              color: triggerConfig.color,
              category: 'special',
            },
          ];
        }
      } else {
        console.warn(`未找到触发条件配置: ${trigger}`);
        // 使用默认配置
        return [
          {
            text: `${trigger}: ${effectPart}`,
            icon: '⚡',
            color: '#a855f7',
            category: 'special',
          },
        ];
      }
    }

    // 如果解析失败，显示原始字符串
    return [
      {
        text: `能力: ${abilityString}`,
        icon: '⭐',
        color: '#a855f7',
        category: 'special',
      },
    ];
  }

  /**
   * 转换卡牌操作效果为显示标签
   */
  private convertCardOperationToTags(
    expression: EffectExpression,
    _context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
  ): EffectDisplayTag[] {
    const selectorDesc = this.getSelectorDescription(expression.selector || '');

    switch (expression.attribute) {
      case 'discard':
        const discardCount = typeof expression.value === 'number' ? expression.value : 1;
        const discardText =
          discardCount === 1 ? `弃掉${selectorDesc}的卡牌` : `弃掉${selectorDesc}的${discardCount}张卡牌`;
        return [
          {
            text: discardText,
            icon: '🗑️',
            color: '#6b7280',
            category: 'harmful',
          },
        ];
      case 'exile': {
        const text = `放逐${selectorDesc}的卡牌`;
        return [{ text, icon: '🔥', color: '#ef4444', category: 'harmful' }];
      }
      case 'reduce_cost': {
        const text = /^(所有手牌|所有抽牌堆|所有弃牌堆|全部卡牌)/.test(selectorDesc)
          ? `${selectorDesc}费用减少${expression.value}`
          : `${selectorDesc}的卡牌费用减少${expression.value}`;
        return [
          {
            text,
            icon: '⚡',
            color: '#ffd700',
            category: 'beneficial',
          },
        ];
      }
      case 'copy_card': {
        // 若是 hand.choose / draw.choose 等，描述为“复制一张手牌/抽牌堆的牌”；若 random 描述为“复制随机手牌”
        let text = `复制${selectorDesc}的卡牌`;
        if (/手牌选择/.test(selectorDesc)) text = '复制一张手牌';
        if (/抽牌堆选择/.test(selectorDesc)) text = '复制抽牌堆中的一张牌';
        if (/弃牌堆选择/.test(selectorDesc)) text = '复制弃牌堆中的一张牌';
        if (/手牌随机/.test(selectorDesc)) text = '复制随机手牌';
        return [{ text, icon: '📄', color: '#4a9eff', category: 'beneficial' }];
      }
      case 'trigger_effect':
        return [
          {
            text: `${selectorDesc}的卡牌下次使用效果触发两次`,
            icon: '⚡⚡',
            color: '#ff6b6b',
            category: 'beneficial',
          },
        ];
      default:
        return [
          {
            text: `${expression.attribute}.${expression.selector}`,
            icon: '❓',
            color: '#888888',
            category: 'neutral',
          },
        ];
    }
  }

  /**
   * 获取选择器描述
   */
  private getSelectorDescription(selector: string): string {
    // 统一复用 shared 工具，避免重复实现
    // 注意：采用动态引入以避免循环依赖
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { describeSelector } = require('../shared/selectorUtils');
    return describeSelector(selector);
  }

  /**
   * 转换状态效果为显示标签
   */
  private convertStatusEffectToTags(
    expression: EffectExpression,
    context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
  ): EffectDisplayTag[] {
    const isPlayerCard = context?.isPlayerCard ?? true;

    // 处理 remove 操作符
    if (expression.operator === 'remove') {
      const statusId = expression.value as string;
      const targetText =
        expression.target === 'ME'
          ? '己方'
          : expression.target === 'OP'
            ? '对方'
            : expression.target === 'ALL'
              ? '双方'
              : '对方';

      let text = '';
      if (statusId === 'all_buffs') {
        text = `${targetText}移除所有状态`;
      } else if (statusId === 'buffs') {
        text = `${targetText}移除所有正面buff`;
      } else if (statusId === 'debuffs') {
        text = `${targetText}移除所有负面buff`;
      } else {
        // 尝试获取状态定义
        const statusDef = this.statusManager.getStatusDefinition(statusId);
        const statusName = statusDef?.name || statusId;
        text = `${targetText}移除${statusName}`;
      }

      return [
        {
          text: text,
          icon: '🗑️',
          color: '#4169e1',
          category: 'utility',
        },
      ];
    }

    // 处理 apply 操作符
    if (expression.operator !== 'apply') {
      return [];
    }

    // 解析状态ID和层数
    let statusId: string;
    let stacksExpr: string = '1';

    const valueStr = expression.value as string;

    // 支持新格式 "statusId stacksExpr" 和旧格式 "statusId:stacks"
    const firstSpaceIndex = valueStr.indexOf(' ');
    if (firstSpaceIndex > 0) {
      // 新格式：空格分隔
      statusId = valueStr.substring(0, firstSpaceIndex);
      stacksExpr = valueStr.substring(firstSpaceIndex + 1).trim();
    } else if (valueStr.includes(':')) {
      // 旧格式：冒号分隔
      const parts = valueStr.split(':');
      statusId = parts[0];
      stacksExpr = parts[1] || '1';
    } else {
      // 只有状态ID
      statusId = valueStr;
      stacksExpr = '1';
    }

    // 获取状态定义
    const statusDef = this.statusManager.getStatusDefinition(statusId);
    if (!statusDef) {
      return [
        {
          text: `未知状态: ${statusId}`,
          icon: '❓',
          color: '#888888',
          category: 'neutral',
        },
      ];
    }

    // 构建游戏化的状态效果显示文本
    const gameText = this.getStatusGameText(expression, statusDef, context, stacksExpr);
    const isPositive = this.isStatusGameActionPositive(expression, statusDef, context);

    // 确定颜色和类别
    const category = isPositive ? 'beneficial' : 'harmful';
    const color = isPositive ? '#44ff44' : '#ff4444';

    return [
      {
        text: gameText,
        icon: statusDef.emoji,
        color: color,
        category: category,
      },
    ];
  }

  /**
   * 获取状态效果的游戏化文本
   */
  private getStatusGameText(
    expression: EffectExpression,
    statusDef: any,
    context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
    stacksExprFromParent?: string,
  ): string {
    const isPlayerCard = context?.isPlayerCard ?? true;
    const isStatusDisplay = context?.isStatusDisplay ?? false;

    // 正确映射目标
    let effectTarget: string;
    if (expression.target === 'ME') {
      effectTarget = 'player';
    } else if (expression.target === 'OP') {
      effectTarget = 'enemy';
    } else if (expression.target === 'ALL') {
      effectTarget = 'both'; // ALL目标表示双方
    } else {
      // 如果没有明确目标，根据卡牌类型推断
      effectTarget = isPlayerCard ? 'enemy' : 'player';
    }

    // 解析层数表达式
    let stacksExpr: string = stacksExprFromParent ?? '1';
    if (!stacksExprFromParent && typeof expression.value === 'string') {
      const valueStr = expression.value;
      const firstSpaceIndex = valueStr.indexOf(' ');
      if (firstSpaceIndex > 0) {
        stacksExpr = valueStr.substring(firstSpaceIndex + 1).trim();
      } else if (valueStr.includes(':')) {
        const parts = valueStr.split(':');
        stacksExpr = parts[1] || '1';
      }
    }

    // 构建文本
    let text = '';

    // 如果是状态栏显示，不需要目标前缀，直接显示状态名
    if (isStatusDisplay) {
      text = statusDef.name;
    } else {
      // 卡牌效果显示，需要目标前缀
      if (effectTarget === 'both') {
        text = `双方获得${statusDef.name}`;
      } else if (effectTarget === 'player' && isPlayerCard) {
        text = `获得${statusDef.name}`;
      } else if (effectTarget === 'enemy' && isPlayerCard) {
        text = `对方获得${statusDef.name}`;
      } else if (effectTarget === 'player' && !isPlayerCard) {
        text = `我方获得${statusDef.name}`;
      } else {
        text = `对方获得${statusDef.name}`;
      }
    }

    // 添加层数
    if (stacksExpr === '1') {
      // 1层时不显示
      if (isStatusDisplay) {
        text += ' 1';
      }
    } else if (/^\d+$/.test(stacksExpr)) {
      // 纯数字
      const stacksNum = parseInt(stacksExpr);
      text += ` ${stacksNum}层`;
    } else {
      // 表达式，需要翻译
      const translatedExpr = this.translateMathExpressionToChinese(stacksExpr);
      text += ` ${translatedExpr}`;
    }

    // 移除持续时间展示（统一使用层数与衰减机制）

    return text;
  }

  /**
   * 判断状态效果是否为正面效果
   */
  private isStatusGameActionPositive(
    expression: EffectExpression,
    statusDef: any,
    context?: { isPlayerCard?: boolean },
  ): boolean {
    const isPlayerCard = context?.isPlayerCard ?? true;
    const effectTarget = expression.target || (isPlayerCard ? 'enemy' : 'player');
    const isTargetingPlayer = effectTarget === 'player';

    // 从玩家视角判断：
    // - 给玩家施加buff是正面的
    // - 给敌人施加debuff是正面的
    // - 给玩家施加debuff是负面的
    // - 给敌人施加buff是负面的

    if (statusDef.type === 'buff') {
      return isTargetingPlayer; // buff给玩家是正面的
    } else if (statusDef.type === 'debuff') {
      return !isTargetingPlayer; // debuff给敌人是正面的
    }

    return false; // 默认为负面
  }

  /**
   * 转换属性效果为显示标签
   */

  private convertAttributeEffectToTags(
    expression: EffectExpression,
    context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
  ): EffectDisplayTag[] {
    // 特殊处理能力属性
    if (expression.attribute === 'ability' && expression.operator === 'add') {
      // 对于能力，需要正确解析触发条件和效果
      const abilityString = expression.value.toString();

      // 检查新的括号格式：trigger(effects)
      const bracketMatch = abilityString.match(/^([\w_]+)\((.+)\)$/);
      if (bracketMatch) {
        const [, trigger, effectPart] = bracketMatch;

        // 获取触发条件的中文名称
        const triggerConfig = this.getTriggerConfig(trigger);
        const triggerText = triggerConfig ? triggerConfig.name : trigger;

        // 解析效果部分，使用统一的效果解析
        const effectDescription = this.parseEffectDescription(effectPart);

        return [
          {
            text: `${triggerText}: ${effectDescription}`,
            icon: '🔮',
            color: '#9370db',
            category: 'special',
          },
        ];
      } else {
        // 如果没有触发条件，直接显示
        return [
          {
            text: abilityString,
            icon: '🔮',
            color: '#9370db',
            category: 'special',
          },
        ];
      }
    }

    // 特殊处理卡牌操作，不需要数值解析
    if (expression.attribute === 'add_to_hand' || expression.attribute === 'add_to_deck') {
      const location = expression.attribute === 'add_to_hand' ? '手牌' : '抽牌堆';
      const cardData = expression.value;

      let cardName = '未知卡牌';
      if (typeof cardData === 'object' && cardData !== null && 'name' in cardData) {
        cardName = (cardData as any).name;
      } else if (typeof cardData === 'string') {
        cardName = cardData;
      }

      return [
        {
          text: `加入${location}"${cardName}"`,
          icon: '🃏',
          color: '#4ade80',
          category: 'beneficial',
        },
      ];
    }

    const attrConfig = this.getAttributeConfig(expression.attribute);
    if (!attrConfig) {
      return [
        {
          text: `${expression.attribute} ${expression.operator} ${expression.value}`,
          icon: '❓',
          color: '#888888',
          category: 'neutral',
        },
      ];
    }

    // 处理变量引用 - 不显示实时数值
    let value: number;
    if (
      expression.isVariableReference ||
      (typeof expression.value === 'string' && this.isVariableReference(expression.value))
    ) {
      // 对于变量引用，生成中文描述但不显示实时数值
      const gameText = this.getGameActionTextForVariableReference(expression, context);
      const isPositive = this.isGameActionPositive(expression, context);

      const icon = isPositive ? attrConfig.positiveIcon : attrConfig.negativeIcon;
      const color = isPositive ? attrConfig.positiveColor : attrConfig.negativeColor;
      const category = isPositive ? 'beneficial' : 'harmful';

      return [
        {
          text: gameText,
          icon: icon,
          color: color,
          category: category,
        },
      ];
    }

    if (typeof expression.value === 'number') {
      value = expression.value;
    } else if (expression.isVariableReference) {
      // 变量引用的特殊处理
      value = 1; // 用于判断正负性，变量引用通常是正面的
    } else {
      value = parseFloat(expression.value as string);
      if (isNaN(value)) {
        return [
          {
            text: `无效数值: ${expression.value}`,
            icon: '❌',
            color: '#ff4444',
            category: 'harmful',
          },
        ];
      }
    }

    // 构建游戏化的显示文本
    const gameText = this.getGameActionText(expression, context);
    const isPositive = this.isGameActionPositive(expression, context);

    // 选择图标和颜色
    const icon = isPositive ? attrConfig.positiveIcon : attrConfig.negativeIcon;
    const color = isPositive ? attrConfig.positiveColor : attrConfig.negativeColor;
    const category = isPositive ? 'beneficial' : 'harmful';

    return [
      {
        text: gameText,
        icon: icon,
        color: color,
        category: category,
      },
    ];
  }

  /**
   * 获取游戏化的行动文本
   */
  private getGameActionText(
    expression: EffectExpression,
    context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
  ): string {
    const { attribute, operator, value, target } = expression;
    let numValue: number;
    let displayValue: string;

    if (typeof value === 'number') {
      numValue = value;
      displayValue = value.toString();
    } else if (expression.isVariableReference) {
      // 变量引用的特殊处理
      displayValue = this.getVariableDisplayName(value as string);
      numValue = 1; // 用于判断正负性
    } else {
      numValue = parseFloat(value as string);
      displayValue = numValue.toString();
    }

    const isPlayerCard = context?.isPlayerCard ?? true;

    // 对于玩家独有属性，不需要目标判断
    if (PLAYER_ONLY_ATTRIBUTES_SET.has(attribute)) {
      const targetPrefix = '';
      return this.getAttributeActionText(attribute, operator, displayValue, targetPrefix);
    }

    // 转换目标格式：ME -> player, OP -> enemy, ALL -> both
    let effectTarget: string;
    if (target === 'ME') {
      effectTarget = 'player';
    } else if (target === 'OP') {
      effectTarget = 'enemy';
    } else if (target === 'ALL') {
      effectTarget = 'both';
    } else {
      // 对于状态显示（buff/debuff），如果没有明确指定目标，
      // 说明这是附加在目标身上的效果，不需要目标前缀
      if (context?.isStatusDisplay) {
        effectTarget = 'self'; // 表示作用于持有者自身
      } else {
        // 卡牌效果的默认逻辑
        effectTarget = isPlayerCard ? 'enemy' : 'player';
      }
    }

    // 获取目标前缀
    const targetPrefix = this.getGameTargetPrefix(effectTarget, isPlayerCard);

    return this.getAttributeActionText(attribute, operator, displayValue, targetPrefix, expression);
  }

  /**
   * 获取属性行动文本的通用方法
   */
  private getAttributeActionText(
    attribute: string,
    operator: string,
    displayValue: string | number,
    targetPrefix: string,
    expression?: EffectExpression,
  ): string {
    const valueStr = typeof displayValue === 'string' ? displayValue : displayValue.toString();
    const numValue = typeof displayValue === 'number' ? displayValue : parseFloat(displayValue as string);

    // 对于变量引用，直接构建显示文本
    if (typeof displayValue === 'string' && isNaN(numValue)) {
      return `${targetPrefix}${this.getAttributeDisplayName(attribute)}${this.getOperatorSymbol(operator)}${valueStr}`;
    }

    switch (attribute) {
      case 'hp':
        return this.getHealthActionText(operator, numValue, targetPrefix);
      case 'lust':
        return this.getLustActionText(operator, numValue, targetPrefix);
      case 'energy':
        return this.getEnergyActionText(operator, numValue, targetPrefix);
      case 'block':
        return this.getBlockActionText(operator, numValue, targetPrefix);
      case 'max_hp':
        return this.getMaxHealthActionText(operator, numValue, targetPrefix);
      case 'max_lust':
        return this.getMaxLustActionText(operator, numValue, targetPrefix);
      case 'max_energy':
        return this.getMaxEnergyActionText(operator, numValue, targetPrefix);
      case 'draw':
        return this.getDrawActionText(operator, numValue);
      case 'discard':
        return this.getDiscardActionText(operator, numValue, targetPrefix);
      case 'damage_modifier':
        return this.getDamageModifierActionText(operator, numValue, targetPrefix);
      case 'lust_damage_modifier':
        return this.getLustDamageModifierActionText(operator, numValue, targetPrefix);
      case 'damage_taken_modifier':
        return this.getDamageTakenModifierActionText(operator, numValue, targetPrefix);
      case 'lust_damage_taken_modifier':
        return this.getLustDamageTakenActionText(operator, numValue, targetPrefix);
      case 'block_modifier':
        return this.getBlockModifierActionText(operator, numValue, targetPrefix);
      case 'add_to_hand':
        return expression ? this.getAddCardActionText(expression, '手牌') : `${targetPrefix}添加卡牌到手牌`;
      case 'add_to_deck':
        return expression ? this.getAddCardActionText(expression, '抽牌堆') : `${targetPrefix}添加卡牌到抽牌堆`;
      default:
        return `${targetPrefix}${attribute}${this.getOperatorSymbol(operator)}${numValue}`;
    }
  }

  /**
   * 获取游戏化的目标前缀
   */
  private getGameTargetPrefix(target: string, isPlayerCard: boolean): string {
    if (target === 'player') {
      return isPlayerCard ? '' : '我方'; // 玩家卡牌默认作用于自己
    } else if (target === 'enemy') {
      return '对方';
    } else if (target === 'self') {
      return ''; // buff/debuff效果作用于持有者自身，不需要前缀
    } else if (target === 'both' || target === 'ALL') {
      return '双方'; // ALL目标表示双方
    } else {
      return '对方';
    }
  }

  /**
   * 生命值行动文本
   */
  private getHealthActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return `${targetPrefix}治疗${value}点`;
      case '-':
        return `${targetPrefix}伤害${value}点`;
      case '*':
        return `${targetPrefix}生命×${value}`;
      case '/':
        return `${targetPrefix}生命÷${value}`;
      case '=':
        return `${targetPrefix}生命=${value}`;
      default:
        return `${targetPrefix}生命${operator}${value}`;
    }
  }

  /**
   * 欲望值行动文本
   */
  private getLustActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return `${targetPrefix}欲望+${value}`;
      case '-':
        return `${targetPrefix}欲望-${value}`;
      case '*':
        return `${targetPrefix}欲望×${value}`;
      case '/':
        return `${targetPrefix}欲望÷${value}`;
      case '=':
        return `${targetPrefix}欲望=${value}`;
      default:
        return `${targetPrefix}欲望${operator}${value}`;
    }
  }

  /**
   * 能量行动文本
   */
  private getEnergyActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return targetPrefix ? `${targetPrefix}获得${value}点能量` : `获得${value}点能量`;
      case '-':
        return targetPrefix ? `${targetPrefix}失去${value}点能量` : `失去${value}点能量`;
      case '*':
        return `${targetPrefix}能量×${value}`;
      case '/':
        return `${targetPrefix}能量÷${value}`;
      case '=':
        return `${targetPrefix}能量=${value}`;
      default:
        return `${targetPrefix}能量${operator}${value}`;
    }
  }

  /**
   * 格挡行动文本
   */
  private getBlockActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return targetPrefix ? `${targetPrefix}获得${value}点格挡` : `获得${value}点格挡`;
      case '-':
        return targetPrefix ? `${targetPrefix}失去${value}点格挡` : `失去${value}点格挡`;
      default:
        return `${targetPrefix}格挡${operator}${value}`;
    }
  }

  /**
   * 最大生命值行动文本
   */
  private getMaxHealthActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return targetPrefix ? `${targetPrefix}最大生命值+${value}` : `最大生命值+${value}`;
      case '-':
        return targetPrefix ? `${targetPrefix}最大生命值-${value}` : `最大生命值-${value}`;
      default:
        return `${targetPrefix}最大生命值${operator}${value}`;
    }
  }

  /**
   * 最大欲望值行动文本
   */
  private getMaxLustActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return targetPrefix ? `${targetPrefix}最大欲望值+${value}` : `最大欲望值+${value}`;
      case '-':
        return targetPrefix ? `${targetPrefix}最大欲望值-${value}` : `最大欲望值-${value}`;
      default:
        return `${targetPrefix}最大欲望值${operator}${value}`;
    }
  }

  /**
   * 最大能量行动文本
   */
  private getMaxEnergyActionText(operator: string, value: number, _targetPrefix: string): string {
    switch (operator) {
      case '+':
        return `最大能量+${value}`;
      case '-':
        return `最大能量-${value}`;
      default:
        return `最大能量${operator}${value}`;
    }
  }

  /**
   * 抽牌行动文本
   */
  private getDrawActionText(operator: string, value: number): string {
    switch (operator) {
      case '+':
        return `抽${value}张牌`;
      case '-':
        return `少抽${value}张牌`;
      default:
        return `抽牌${operator}${value}`;
    }
  }

  /**
   * 弃牌行动文本
   */
  private getDiscardActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return targetPrefix ? `${targetPrefix}弃${value}张牌` : `弃${value}张牌`;
      default:
        return `${targetPrefix}弃牌${operator}${value}`;
    }
  }

  /**
   * 判断游戏行动是否为正面效果
   */
  private isGameActionPositive(expression: EffectExpression, context?: { isPlayerCard?: boolean }): boolean {
    const { attribute, operator, target } = expression;
    const isPlayerCard = context?.isPlayerCard ?? true;
    const effectTarget = target || (isPlayerCard ? 'enemy' : 'player');

    // 从玩家视角判断：对玩家有利的是正面，对敌人有利的是负面
    const isTargetingPlayer = effectTarget === 'player';

    switch (attribute) {
      case 'hp':
        if (operator === '+') return isTargetingPlayer; // 治疗我方是正面
        if (operator === '-') return !isTargetingPlayer; // 伤害对方是正面
        break;
      case 'lust':
        if (operator === '+') return !isTargetingPlayer; // 对方欲望+为负面
        if (operator === '-') return isTargetingPlayer; // 我方欲望-为正面
        break;
      case 'energy':
      case 'max_energy':
      case 'max_hp':
      case 'max_lust':
      case 'block':
        if (operator === '+') return isTargetingPlayer; // 我方+格挡为正面
        if (operator === '-') return !isTargetingPlayer; // 对方-格挡为正面
        break;
      case 'draw':
        return operator === '+'; // 抽牌总是正面
      case 'discard':
        if (operator === '+') return !isTargetingPlayer; // 让敌人弃牌是正面
        break;
    }

    return false; // 默认为负面，保守处理
  }

  /**
   * 获取操作符符号
   */
  private getOperatorSymbol(operator: string): string {
    switch (operator) {
      case '+':
        return '+';
      case '-':
        return '-';
      case '*':
        return '×';
      case '/':
        return '÷';
      case '=':
        return '=';
      default:
        return operator;
    }
  }

  /**
   * 获取目标显示文本（旧版本，保留兼容性）
   */
  private _getTargetDisplayText(target?: string, context?: { isPlayerCard?: boolean }): string {
    if (!target) {
      // 如果没有明确指定目标，根据上下文推断
      const isPlayerCard = context?.isPlayerCard ?? true;
      return isPlayerCard ? '' : '我方的';
    }

    switch (target) {
      case 'player':
        return '我方的';
      case 'enemy':
        return '对方的';
      default:
        return '';
    }
  }

  /**
   * 获取操作符显示文本
   */
  private _getOperatorDisplayText(operator: string, value: number): string {
    switch (operator) {
      case '+':
        return `+${value}`;
      case '-':
        return `-${value}`;
      case '*':
        return `×${value}`;
      case '/':
        return `÷${value}`;
      case '=':
        return `=${value}`;
      default:
        return `${operator}${value}`;
    }
  }

  /**
   * 创建效果标签HTML
   */
  public createEffectTagsHTML(tags: EffectDisplayTag[]): string {
    if (tags.length === 0) return '';

    return (
      `<div class="effect-tags-container">` +
      tags
        .map(
          tag => `
        <span class="effect-tag effect-${tag.category}" style="
          background: ${tag.color}20;
          border: 1px solid ${tag.color};
          color: ${tag.color};
          padding: 2px 6px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 600;
          margin: 2px;
          display: inline-block;
          white-space: nowrap;
          line-height: 1.3;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        ">
          ${tag.icon} ${tag.text}
        </span>
      `,
        )
        .join('') +
      `</div>`
    );
  }

  /**
   * 创建紧凑版效果标签HTML
   */
  public createCompactEffectTagsHTML(tags: EffectDisplayTag[]): string {
    if (tags.length === 0) return '';

    return (
      `<div class="effect-tags-container compact">` +
      tags
        .map(
          tag => `
        <span class="effect-tag compact effect-${tag.category}" style="
          background: ${tag.color}15;
          border: 1px solid ${tag.color}80;
          color: ${tag.color};
          padding: 1px 4px;
          border-radius: 8px;
          font-size: 9px;
          font-weight: 500;
          margin: 1px;
          display: inline-block;
          white-space: nowrap;
          line-height: 1.2;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
        ">
          ${tag.icon} ${tag.text}
        </span>
      `,
        )
        .join('') +
      `</div>`
    );
  }

  /**
   * 创建换行显示的效果标签HTML（用于工具提示，完整显示不省略）
   */
  public createWrappedEffectTagsHTML(tags: EffectDisplayTag[]): string {
    if (tags.length === 0) return '';

    return (
      `<div class="effect-tags-container wrapped">` +
      tags
        .map(
          tag => `
        <span class="effect-tag wrapped effect-${tag.category}" style="
          background: ${tag.color}12;
          border: 1px solid ${tag.color}66;
          color: ${tag.color};
          padding: 4px 6px;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 600;
          margin: 2px 0;
          display: block;
          white-space: normal;
          line-height: 1.4;
          word-break: break-word;
          overflow: visible;
        ">
          ${tag.icon} ${tag.text}
        </span>
      `,
        )
        .join('') +
      `</div>`
    );
  }

  /**
   * 获取伤害修饰符行动文本
   */
  private getDamageModifierActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return `${targetPrefix}造成伤害+${value}`;
      case '-':
        // 对于负值，显示为百分比减少
        if (value > 0 && value < 1) {
          const percentage = Math.round(value * 100);
          return `${targetPrefix}造成伤害-${percentage}%`;
        } else {
          return `${targetPrefix}造成伤害-${value}`;
        }
      case '*':
        // 对于乘法，显示为百分比
        if (value < 1) {
          const percentage = Math.round((1 - value) * 100);
          return `${targetPrefix}造成伤害-${percentage}%`;
        } else {
          return `${targetPrefix}造成伤害×${value}`;
        }
      case '/':
        return `${targetPrefix}造成伤害÷${value}`;
      case '=':
        return `${targetPrefix}造成伤害=${value}`;
      default:
        return `${targetPrefix}造成伤害修饰${operator}${value}`;
    }
  }

  /**
   * 获取欲望伤害修饰符行动文本
   */
  private getLustDamageModifierActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return `${targetPrefix}欲望伤害+${value}`;
      case '-':
        return `${targetPrefix}欲望伤害-${value}`;
      case '*':
        return `${targetPrefix}欲望伤害×${value}`;
      case '/':
        return `${targetPrefix}欲望伤害÷${value}`;
      case '=':
        return `${targetPrefix}欲望伤害=${value}`;
      default:
        return `${targetPrefix}欲望伤害修饰${operator}${value}`;
    }
  }

  /**
   * 获取受到伤害修饰符行动文本
   */
  private getDamageTakenModifierActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return `${targetPrefix}受到伤害+${value}`;
      case '-':
        return `${targetPrefix}受到伤害-${value}`;
      case '*':
        // 乘法表示按比例变化
        if (value > 0 && value < 1) {
          const percentage = Math.round((1 - value) * 100);
          return `${targetPrefix}受到伤害-${percentage}%`;
        } else if (value > 1) {
          const percentage = Math.round((value - 1) * 100);
          return `${targetPrefix}受到伤害+${percentage}%`;
        } else {
          return `${targetPrefix}受到伤害×${value}`;
        }
      case '/':
        return `${targetPrefix}受到伤害÷${value}`;
      case '=':
        return `${targetPrefix}受到伤害=${value}`;
      default:
        return `${targetPrefix}受到伤害修饰${operator}${value}`;
    }
  }

  /**
   * 获取受到欲望伤害修饰符行动文本
   */
  private getLustDamageTakenActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return `${targetPrefix}受到欲望伤害+${value}`;
      case '-':
        return `${targetPrefix}受到欲望伤害-${value}`;
      case '*':
        return `${targetPrefix}受到欲望伤害×${value}`;
      case '/':
        return `${targetPrefix}受到欲望伤害÷${value}`;
      case '=':
        return `${targetPrefix}受到欲望伤害=${value}`;
      default:
        return `${targetPrefix}受到欲望伤害修饰${operator}${value}`;
    }
  }

  /**
   * 获取格挡修饰符行动文本
   */
  private getBlockModifierActionText(operator: string, value: number, targetPrefix: string): string {
    switch (operator) {
      case '+':
        return `${targetPrefix}格挡+${value}`;
      case '-':
        return `${targetPrefix}格挡-${value}`;
      case '*':
        return `${targetPrefix}格挡×${value}`;
      case '/':
        return `${targetPrefix}格挡÷${value}`;
      case '=':
        return `${targetPrefix}格挡=${value}`;
      default:
        return `${targetPrefix}格挡修饰${operator}${value}`;
    }
  }

  /**
   * 获取添加卡牌行动文本
   */
  private getAddCardActionText(expression: EffectExpression, location: string): string {
    const cardData = expression.value;

    if (typeof cardData === 'object' && cardData !== null && 'name' in cardData) {
      return `获得卡牌"${(cardData as any).name}"(加入${location})`;
    } else if (typeof cardData === 'string') {
      return `获得卡牌"${cardData}"(加入${location})`;
    } else {
      return `获得卡牌(加入${location})`;
    }
  }

  /**
   * 获取变量引用的显示名称
   */
  private getVariableDisplayName(variableName: string): string {
    switch (variableName) {
      case 'max_hp':
        return '最大生命值';
      case 'max_lust':
        return '最大欲望值';
      case 'max_energy':
        return '最大能量';
      case 'current_hp':
        return '当前生命值';
      case 'current_lust':
        return '当前欲望值';
      case 'current_energy':
        return '当前能量';
      case 'hand_size':
        return '手牌数';
      case 'deck_size':
        return '抽牌堆数';
      case 'discard_pile_size':
        return '弃牌堆数';
      case 'cards_played_this_turn':
        return '本回合出牌数';
      default:
        return variableName;
    }
  }

  /**
   * 获取属性的显示名称
   */
  private getAttributeDisplayName(attribute: string): string {
    const attrConfig = this.getAttributeConfig(attribute);
    return attrConfig ? attrConfig.name : attribute;
  }

  /**
   * 解析效果描述 - 使用统一效果解析器
   */
  private parseEffectDescription(effectString: string): string {
    try {
      // 使用类中的解析器实例
      const expressions = this.parser.parseEffectString(effectString);
      const descriptions: string[] = [];

      for (const expression of expressions) {
        if (!expression.isValid) {
          descriptions.push(expression.raw || effectString);
          continue;
        }

        // 使用现有的效果转换方法
        const tags = this.convertExpressionToTags(expression, { isStatusDisplay: true });
        if (tags.length > 0) {
          descriptions.push(tags[0].text);
        } else {
          descriptions.push(expression.raw || effectString);
        }
      }

      return descriptions.join(', ');
    } catch (error) {
      // 移除日志减少输出，直接使用简单解析
      return this.parseEffectDescriptionSimple(effectString);
    }
  }

  /**
   * 简单的效果描述解析（备用方案）
   */
  private parseEffectDescriptionSimple(effectString: string): string {
    try {
      // 分割多个效果（安全）：忽略括号内的逗号
      const effects = this.splitEffectsByCommaSafe(effectString);
      const descriptions: string[] = [];

      for (const effect of effects) {
        // 处理 ME.status apply 格式
        if (
          effect.includes('ME.status apply') ||
          effect.includes('OP.status apply') ||
          effect.includes('ALL.status apply')
        ) {
          const match = effect.match(/(ME|OP|ALL)\.status apply (\w+)(?:\s+(.+))?/);
          if (match) {
            const [, target, statusId, stacksExpr = '1'] = match;
            const targetText = target === 'ME' ? '己方' : target === 'OP' ? '对方' : '双方';

            // 获取状态的显示名称
            const statusDef = this.statusManager?.getStatusDefinition(statusId);
            const statusName = statusDef?.name || statusId;

            // 处理层数表达式
            let stacksText;
            if (stacksExpr.trim() === '1') {
              stacksText = ''; // 1层时不显示
            } else if (/^\d+$/.test(stacksExpr.trim())) {
              // 纯数字
              stacksText = `${stacksExpr}层`;
            } else {
              // 表达式，需要翻译
              stacksText = this.translateMathExpressionToChinese(stacksExpr.trim());
            }

            if (stacksText) {
              descriptions.push(`${targetText}获得${statusName}${stacksText}`);
            } else {
              descriptions.push(`${targetText}获得${statusName}`);
            }
            continue;
          }
        }

        // 处理 ME.status remove 格式
        if (
          effect.includes('ME.status remove') ||
          effect.includes('OP.status remove') ||
          effect.includes('ALL.status remove')
        ) {
          const match = effect.match(/(ME|OP|ALL)\.status remove (\w+)/);
          if (match) {
            const [, target, statusId] = match;
            const targetText = target === 'ME' ? '己方' : target === 'OP' ? '对方' : '双方';
            if (statusId === 'all_buffs') {
              descriptions.push(`${targetText}移除所有状态`);
            } else if (statusId === 'buffs') {
              descriptions.push(`${targetText}移除所有正面buff`);
            } else if (statusId === 'debuffs') {
              descriptions.push(`${targetText}移除所有负面buff`);
            } else {
              const statusDef = this.statusManager?.getStatusDefinition(statusId);
              const statusName = statusDef?.name || statusId;
              descriptions.push(`${targetText}移除${statusName}`);
            }
            continue;
          }
        }

        // 处理基础属性效果
        if (effect.includes('ME.') || effect.includes('OP.') || effect.includes('ALL.')) {
          const match = effect.match(/(ME|OP|ALL)\.(\w+)\s*([+\-=])\s*(.+)/);
          if (match) {
            const [, target, attribute, operator, value] = match;
            const targetText = target === 'ME' ? '己方' : target === 'OP' ? '对方' : '双方';
            const attrText = this.getAttributeDisplayName(attribute);
            const opText = operator === '+' ? '增加' : operator === '-' ? '减少' : '设置为';
            const valueText = this.getValueDisplayText(value);
            descriptions.push(`${targetText}${attrText}${opText}${valueText}`);
            continue;
          }
        }

        // 处理没有目标前缀的效果（默认为己方）
        const basicMatch = effect.match(/(\w+)\s*([+\-=])\s*(.+)/);
        if (basicMatch) {
          const [, attribute, operator, value] = basicMatch;
          const attrText = this.getAttributeDisplayName(attribute);
          const opText = operator === '+' ? '增加' : operator === '-' ? '减少' : '设置为';
          const valueText = this.getValueDisplayText(value);
          descriptions.push(`己方${attrText}${opText}${valueText}`);
          continue;
        }

        // 其他效果直接显示
        descriptions.push(effect);
      }

      return descriptions.join(', ');
    } catch (error) {
      // 移除日志减少输出，直接返回原字符串
      return effectString;
    }
  }

  /**
   * 获取值的显示文本
   */
  // 安全逗号分割（忽略括号内的逗号）
  private splitEffectsByCommaSafe(effectString: string): string[] {
    const parts: string[] = [];
    let current = '';
    let paren = 0,
      brace = 0,
      bracket = 0;

    for (let i = 0; i < effectString.length; i++) {
      const ch = effectString[i];
      if (ch === '(') paren++;
      else if (ch === ')') paren = Math.max(0, paren - 1);
      else if (ch === '{') brace++;
      else if (ch === '}') brace = Math.max(0, brace - 1);
      else if (ch === '[') bracket++;
      else if (ch === ']') bracket = Math.max(0, bracket - 1);

      if (ch === ',' && paren === 0 && brace === 0 && bracket === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  private getValueDisplayText(value: string): string {
    // 检查是否是变量引用
    if (value === 'max_hp') return '最大生命值';
    if (value === 'max_lust') return '最大欲望值';
    if (value === 'max_energy') return '最大能量';
    return value;
  }

  /**
   * 为变量引用生成中文游戏文本（不显示实时数值）
   */
  private getGameActionTextForVariableReference(
    expression: EffectExpression,
    context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
  ): string {
    const valueStr = expression.value as string;
    const target = expression.target || 'OP';
    const operator = expression.operator;
    const attribute = expression.attribute;

    // 翻译数学表达式为中文
    const translatedExpression = this.translateMathExpressionToChinese(valueStr);

    // 获取目标描述
    const targetText = target === 'ME' ? '己方的' : target === 'OP' ? '对方的' : '双方的';

    // 获取属性描述
    const attributeText = this.getAttributeDisplayName(attribute);

    // 根据操作符生成完整的中文描述
    let actionText = '';

    if (operator === '+' || operator === 'add') {
      actionText = `${targetText}${attributeText}+${translatedExpression}`;
    } else if (operator === '-' || operator === 'subtract') {
      actionText = `${targetText}${attributeText}-${translatedExpression}`;
    } else if (operator === '*' || operator === 'multiply') {
      actionText = `${targetText}${attributeText}×${translatedExpression}`;
    } else if (operator === '/' || operator === 'divide') {
      actionText = `${targetText}${attributeText}÷${translatedExpression}`;
    } else if (operator === '=') {
      actionText = `${targetText}${attributeText}=${translatedExpression}`;
    } else {
      actionText = `${targetText}${translatedExpression}`;
    }

    return actionText;
  }

  /**
   * 将数学表达式翻译为中文
   */
  private translateMathExpressionToChinese(expression: string): string {
    let result = expression;

    // 先处理 stacks 二次指向
    result = result.replace(/(ME|OP|ALL)\.stacks\.(\w+)/g, (_, target, buffid) => {
      const targetName = target === 'ME' ? '己方' : target === 'OP' ? '对方' : '双方';
      const statusDef = this.statusManager?.getStatusDefinition(buffid);
      const buffName = statusDef?.name || buffid;
      return `${targetName}${buffName}层数`;
    });

    // 替换实体引用
    result = result.replace(/ALL\./g, '双方的');
    result = result.replace(/ME\./g, '己方的');
    result = result.replace(/OP\./g, '对方的');

    // 替换变量名
    result = result.replace(/max_hp/g, '最大生命值');
    result = result.replace(/max_lust/g, '最大欲望值');
    result = result.replace(/max_energy/g, '最大能量');
    result = result.replace(/current_hp|hp/g, '当前生命值');
    result = result.replace(/current_lust|lust/g, '当前欲望值');
    result = result.replace(/current_energy|energy/g, '当前能量');
    result = result.replace(/block/g, '格挡值');

    // 替换运算符
    result = result.replace(/\*/g, ' × ');
    result = result.replace(/\//g, ' ÷ ');
    result = result.replace(/\+/g, ' + ');
    result = result.replace(/-/g, ' - ');

    return result;
  }

  /**
   * 检查是否为变量引用（包括数学表达式）
   */
  private isVariableReference(value: string): boolean {
    // 简单变量名
    const simpleVariablePattern =
      /^(max_hp|max_lust|max_energy|hp|lust|energy|block|current_hp|current_lust|current_energy)$/;

    // 实体变量引用（ME.xxx 或 OP.xxx 或 ALL.xxx）
    const entityVariablePattern =
      /^(ME|OP|ALL)\.(max_hp|max_lust|max_energy|hp|lust|energy|block|current_hp|current_lust|current_energy)$/;

    // stacks 二次指向
    const stacksPattern = /^(ME|OP|ALL)\.stacks\.(all_buffs|buffs|debuffs|\w+)$/;
    if (stacksPattern.test(value)) return true;

    // 数学表达式（包含变量和运算符）
    const mathExpressionPattern = /[+\-*/()]|ME\.|OP\.|ALL\.|max_hp|max_lust|max_energy|hp|lust|energy|block/;

    return simpleVariablePattern.test(value) || entityVariablePattern.test(value) || mathExpressionPattern.test(value);
  }

  /**
   * 获取变量的实际数值 - 支持数学表达式
   */
  private getVariableActualValue(variableName: string, target?: 'ME' | 'OP'): number {
    try {
      // 检查是否是数学表达式
      if (this.isMathExpression(variableName)) {
        return this.evaluateMathExpression(variableName, target);
      }

      // 尝试多种方式获取游戏状态管理器
      let gameStateManager;

      // 方式1：从全局对象获取
      if ((window as any).GameStateManager) {
        gameStateManager = (window as any).GameStateManager.getInstance();
      }

      // 方式2：从模块系统获取
      if (!gameStateManager) {
        try {
          const GameStateManagerModule = require('../core/gameStateManager');
          gameStateManager = GameStateManagerModule.GameStateManager?.getInstance();
        } catch (e) {
          console.warn('无法通过require获取GameStateManager:', e);
        }
      }

      if (!gameStateManager) {
        console.warn('无法获取游戏状态管理器');
        return 0;
      }

      // 实时获取最新的游戏状态，确保获取到动态更新后的值
      const gameState = gameStateManager.getGameState();
      if (!gameState) {
        console.warn('无法获取游戏状态');
        return 0;
      }

      // 确定目标实体，实时获取最新状态
      let entity;
      if (target === 'OP') {
        entity = gameStateManager.getEnemy();
      } else {
        entity = gameStateManager.getPlayer();
      }

      if (!entity) {
        console.warn('无法获取目标实体:', target);
        return 0;
      }

      // 根据变量名获取实际值
      let value = 0;
      switch (variableName) {
        case 'max_hp':
          value = entity.maxHp || 0;
          break;
        case 'max_lust':
          value = entity.maxLust || 0;
          break;
        case 'max_energy':
          value = entity.maxEnergy || 0;
          break;
        case 'hp':
        case 'current_hp':
          value = entity.currentHp || entity.hp || 0;
          break;
        case 'lust':
        case 'current_lust':
          value = entity.currentLust || entity.lust || 0;
          break;
        case 'energy':
        case 'current_energy':
          value = entity.energy || 0;
          break;
        case 'block':
          value = entity.block || 0;
          break;
        default:
          console.warn('未知变量名:', variableName);
          value = 0;
      }

      console.log(`获取变量实际值: ${variableName} (${target || 'ME'}) = ${value}`);
      return value;
    } catch (error) {
      console.error('获取变量实际值失败:', error);
      return 0;
    }
  }

  /**
   * 检查是否是数学表达式
   */
  private isMathExpression(expression: string): boolean {
    // 包含数学运算符的表达式
    return (
      /[+\-*/()]/.test(expression) ||
      expression.includes('ME.') ||
      expression.includes('OP.') ||
      expression.includes('ALL.')
    );
  }

  /**
   * 计算数学表达式的值
   */
  private evaluateMathExpression(expression: string, defaultTarget?: 'ME' | 'OP'): number {
    try {
      // 替换变量引用为实际值
      let processedExpression = expression;

      // 先处理 stacks 二次指向
      const stacksPattern = /(ME|OP|ALL)\.stacks\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
      processedExpression = processedExpression.replace(stacksPattern, (_match, target, buffid) => {
        // 简化处理：在UI中只返回0，实际计算在执行器中进行
        return '0';
      });

      // 处理 ME.属性 或 OP.属性 或 ALL.属性 格式
      const entityVariablePattern = /(ME|OP|ALL)\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
      let match;
      while ((match = entityVariablePattern.exec(expression)) !== null) {
        const [fullMatch, entity, variable] = match;
        if (entity === 'ALL') {
          // ALL 目标在UI中使用玩家值作为预览
          const value = this.getSimpleVariableValue(variable, 'ME');
          processedExpression = processedExpression.replace(fullMatch, value.toString());
        } else {
          const value = this.getSimpleVariableValue(variable, entity as 'ME' | 'OP');
          processedExpression = processedExpression.replace(fullMatch, value.toString());
        }
      }

      // 重置正则表达式的lastIndex
      entityVariablePattern.lastIndex = 0;

      // 再处理独立变量（如 energy, hp 等），但要避免替换已经是数字的部分
      const simpleVariablePattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
      const processedExpression2 = processedExpression.replace(simpleVariablePattern, (match, variable) => {
        // 跳过已经是数字的部分
        if (/^\d+$/.test(match)) {
          return match;
        }

        // 跳过已经处理过的ME/OP变量
        if (expression.includes(`ME.${variable}`) || expression.includes(`OP.${variable}`)) {
          return match;
        }

        // 获取变量值
        const value = this.getSimpleVariableValue(variable, defaultTarget || 'ME');
        return value.toString();
      });

      // 安全地计算数学表达式
      const result = this.safeEvaluate(processedExpression2);
      return result;
    } catch (error) {
      console.error('数学表达式计算失败:', error, expression);
      return 0;
    }
  }

  /**
   * 获取简单变量值（不处理数学表达式）
   */
  private getSimpleVariableValue(variableName: string, target: 'ME' | 'OP'): number {
    try {
      // 获取游戏状态管理器
      let gameStateManager;
      if ((window as any).GameStateManager) {
        gameStateManager = (window as any).GameStateManager.getInstance();
      }

      if (!gameStateManager) {
        return 0;
      }

      // 获取目标实体
      let entity;
      if (target === 'OP') {
        entity = gameStateManager.getEnemy();
      } else {
        entity = gameStateManager.getPlayer();
      }

      if (!entity) {
        return 0;
      }

      // 根据变量名获取值
      switch (variableName) {
        case 'max_hp':
          return entity.maxHp || 0;
        case 'max_lust':
          return entity.maxLust || 0;
        case 'max_energy':
          return entity.maxEnergy || 0;
        case 'hp':
        case 'current_hp':
          return entity.currentHp || entity.hp || 0;
        case 'lust':
        case 'current_lust':
          return entity.currentLust || entity.lust || 0;
        case 'energy':
        case 'current_energy':
          return entity.energy || 0;
        case 'block':
          return entity.block || 0;
        default:
          return 0;
      }
    } catch (error) {
      return 0;
    }
  }

  /**
   * 安全地计算数学表达式
   */
  private safeEvaluate(expression: string): number {
    try {
      // 只允许数字、基本运算符和括号
      if (!/^[\d+\-*/.() ]+$/.test(expression)) {
        console.warn('不安全的数学表达式:', expression);
        return 0;
      }

      // 使用Function构造器安全地计算表达式
      const result = new Function('return ' + expression)();
      return typeof result === 'number' && !isNaN(result) ? Math.round(result) : 0;
    } catch (error) {
      console.error('数学表达式计算错误:', error, expression);
      return 0;
    }
  }

  /**
   * 获取带实际数值的游戏行动文本
   */
  private getGameActionTextWithActualValue(
    expression: EffectExpression,
    actualValue: number,
    context?: { isPlayerCard?: boolean; isStatusDisplay?: boolean },
  ): string {
    const { attribute, operator, target } = expression;
    const isPlayerCard = context?.isPlayerCard ?? false;

    // 确定效果目标
    const effectTarget = target || (isPlayerCard ? 'ME' : 'OP');

    // 获取目标前缀
    const targetPrefix = this.getGameTargetPrefix(effectTarget, isPlayerCard);

    // 构建显示文本，包含变量名和实际数值
    const variableName = this.getVariableDisplayName(expression.value as string);
    const displayText = `${variableName}(${actualValue})`;

    return this.getAttributeActionText(attribute, operator, displayText, targetPrefix, expression);
  }
}
