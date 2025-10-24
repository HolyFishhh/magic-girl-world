/**
 * 统一效果解析器 - 解析各种格式的效果字符串
 *
 * 支持的语法：
 * [前缀:] [目标.]属性 操作符 值 [持续时间]
 *
 * 示例：
 * - hp + 10
 * - OP.hp - 15
 * - battle_start: ME.status apply strength 2 @3
 * - turn_start: hp + 3
 */

import {
  VALID_OPERATORS,
  VALID_TRIGGERS,
  getAllAttributeDefinitions,
  getAttributeDefinition,
  type AttributeDefinition,
} from './effectDefinitions';

export interface EffectExpression {
  // 原始字符串
  raw: string;

  // 解析结果
  prefix?: string; // 前缀，如 battle_start, turn_start
  target?: 'ME' | 'OP' | 'ALL'; // 目标（新增ALL：同时作用于双方）
  attribute: string; // 属性，如 hp, lust, status
  operator: string; // 操作符，如 +, -, *, apply
  value: number | string | object; // 值
  duration?: number; // 持续时间
  selector?: string; // 选择器，如 random, leftmost, rightmost

  // 条件判断（if-else语法）
  isConditional?: boolean; // 是否是条件表达式
  condition?: string; // 判断条件
  trueEffect?: string; // 条件为真时的效果
  falseEffect?: string; // 条件为假时的效果

  // 元数据
  isValid: boolean; // 是否解析成功
  errorMessage?: string; // 错误信息
  description?: string; // 人类可读的描述
  isVariableReference?: boolean; // 是否是变量引用
}

// AttributeDefinition 已从 effectDefinitions 导入

export class UnifiedEffectParser {
  private static instance: UnifiedEffectParser;
  private dynamicStatusManager: any; // DynamicStatusManager

  private constructor() {
    // 不再需要初始化，使用集中配置
    // 延迟加载 DynamicStatusManager，避免循环依赖
    try {
      const { DynamicStatusManager } = require('./dynamicStatusManager');
      this.dynamicStatusManager = DynamicStatusManager.getInstance();
    } catch (e) {
      console.warn('无法加载 DynamicStatusManager:', e);
    }
  }

  public static getInstance(): UnifiedEffectParser {
    if (!UnifiedEffectParser.instance) {
      UnifiedEffectParser.instance = new UnifiedEffectParser();
    }
    return UnifiedEffectParser.instance;
  }

  /**
   * 解析效果字符串
   */
  public parseEffectString(effectString: string): EffectExpression[] {
    if (!effectString || effectString.trim() === '') {
      return [];
    }

    // 使用逗号分割效果条目
    const effectParts = this.splitEffectsByComma(effectString);
    const expressions: EffectExpression[] = [];

    for (const part of effectParts) {
      const trimmedPart = part.trim();
      if (trimmedPart) {
        try {
          const expression = this.parseEffectPart(trimmedPart);
          if (expression.isValid) {
            expressions.push(expression);
          } else {
            console.warn('⚠️ 无效的效果表达式:', trimmedPart);
          }
        } catch (error) {
          console.error('❌ 解析效果部分失败:', trimmedPart, error);
        }
      }
    }

    return expressions;
  }

  /**
   * 使用逗号分割效果字符串，正确处理括号内的逗号和引号
   */
  private splitEffectsByComma(effectString: string): string[] {
    // 先清理字符串，移除emoji和多余空格
    const cleanString = effectString
      .replace(/[⭐⚡🔥💖💔🛡️⚔️✨🎯]/g, '') // 移除常见emoji
      .replace(/，/g, ',') // 兼容全角逗号
      .replace(/\s+/g, ' ') // 合并多个空格
      .trim();

    const parts: string[] = [];
    let current = '';
    let parenthesesDepth = 0; // () 深度
    let braceDepth = 0; // {} 深度
    let bracketDepth = 0; // [] 深度（用于if语法）
    let inDoubleQuotes = false; // 是否在双引号内
    let inSingleQuotes = false; // 是否在单引号内
    let prevChar = '';

    for (let i = 0; i < cleanString.length; i++) {
      const char = cleanString[i];

      // 引号处理（支持双引号和单引号）。不在转义状态下切换引号状态
      if (char === '"' && prevChar !== '\\') {
        inDoubleQuotes = !inDoubleQuotes;
      }
      if (char === "'" && prevChar !== '\\') {
        inSingleQuotes = !inSingleQuotes;
      }

      const inQuotes = inDoubleQuotes || inSingleQuotes;

      if (char === '(') {
        parenthesesDepth++;
      } else if (char === ')') {
        parenthesesDepth = Math.max(0, parenthesesDepth - 1);
      } else if (char === '{') {
        braceDepth++;
      } else if (char === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (char === '[') {
        bracketDepth++;
      } else if (char === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }

      if (char === ',' && !inQuotes && parenthesesDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        // 在完全顶级遇到逗号，分割
        if (current.trim()) {
          parts.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }

      prevChar = char;
    }

    // 添加最后一部分
    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }

  /**
   * 检查是否为变量引用
   */
  private isVariableReference(value: string): boolean {
    // 支持裸变量与带前缀变量（ME.block / OP.block / ALL.block）
    const basePattern =
      /^(max_hp|max_lust|max_energy|current_hp|current_lust|current_energy|hp|lust|energy|block|hand_size|deck_size|discard_pile_size|cards_played_this_turn)$/;
    if (basePattern.test(value)) return true;
    // 前缀变量（仅变量，无数学运算）
    if (/^(ME|OP|ALL)\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) return true;
    // stacks 二次指向语法（支持 all_buffs, buffs, debuffs）
    if (/^(ME|OP|ALL)\.stacks\.(all_buffs|buffs|debuffs|[a-zA-Z_][a-zA-Z0-9_]*)$/.test(value)) return true;
    return false;
  }

  /**
   * 检查字符串是否是包含变量的数学表达式
   */
  private isMathExpression(value: string): boolean {
    // 检查是否包含数学运算符和变量
    return /[+\-*/()]/.test(value) && this.containsVariableReference(value);
  }

  /**
   * 检查字符串是否包含变量引用
   */
  private containsVariableReference(value: string): boolean {
    const variablePattern =
      /(max_hp|max_lust|max_energy|current_hp|current_lust|current_energy|hp|lust|energy|block|hand_size|deck_size|discard_pile_size|cards_played_this_turn|ME\.\w+|OP\.\w+|ALL\.\w+|stacks|(ME|OP|ALL)\.stacks\.(all_buffs|buffs|debuffs|\w+))/;
    return variablePattern.test(value);
  }

  /**
   * 解析条件表达式（if-else语法）- 使用递归下降解析器
   */
  private parseConditionalExpression(effectPart: string): EffectExpression | null {
    if (!effectPart.startsWith('if[')) {
      return null;
    }

    // 检查if语句的基本完整性
    if (!this.isIfStatementComplete(effectPart)) {
      console.warn('if语句不完整，跳过解析:', effectPart);
      return {
        raw: effectPart,
        attribute: 'conditional',
        operator: 'if',
        value: '',
        isConditional: true,
        condition: '',
        trueEffect: '',
        falseEffect: '',
        isValid: false,
        errorMessage: 'if语句不完整',
        description: `不完整的if语句: ${effectPart}`,
      };
    }

    try {
      const result = this.parseIfStatement(effectPart, 0);
      if (!result) {
        return null;
      }

      const { condition, trueEffect, falseEffect, endPos } = result;
      // 放宽尾随空白或多余右括号的健壮性校验
      const tail = effectPart.slice(endPos).trim();
      if (tail && tail !== ')' && tail !== '))') {
        console.warn('if语句解析不完整:', effectPart);
        return null;
      }

      return {
        raw: effectPart,
        attribute: 'conditional',
        operator: falseEffect ? 'if-else' : 'if',
        value: '',
        isConditional: true,
        condition: condition.trim(),
        trueEffect: trueEffect.trim(),
        falseEffect: falseEffect ? falseEffect.trim() : '',
        isValid: true,
        description: this.generateConditionalDescription(condition, trueEffect, falseEffect || ''),
      };
    } catch (error) {
      console.error('if语句解析失败:', error, effectPart);
      return {
        raw: effectPart,
        attribute: 'conditional',
        operator: 'if',
        value: '',
        isConditional: true,
        condition: '',
        trueEffect: '',
        falseEffect: '',
        isValid: false,
        errorMessage: `if语句解析失败: ${error}`,
      };
    }
  }

  /**
   * 检查if语句是否完整
   */
  private isIfStatementComplete(text: string): boolean {
    // 基本格式检查：if[...][...] 或 if[...][...]else[...]
    let bracketCount = 0;
    let hasCondition = false;
    let hasTrueEffect = false;
    let inCondition = false;
    let inTrueEffect = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (char === '[') {
        bracketCount++;
        if (bracketCount === 1 && text.substring(0, i).endsWith('if')) {
          inCondition = true;
        } else if (bracketCount === 1 && hasCondition && !hasTrueEffect) {
          inTrueEffect = true;
        }
      } else if (char === ']') {
        bracketCount--;
        if (bracketCount === 0) {
          if (inCondition) {
            hasCondition = true;
            inCondition = false;
          } else if (inTrueEffect) {
            hasTrueEffect = true;
            inTrueEffect = false;
          }
        }
      }
    }

    // 至少需要有条件和true效果
    return bracketCount === 0 && hasCondition && hasTrueEffect;
  }

  /**
   * 递归下降解析器 - 解析if语句 - 重写版本
   */
  private parseIfStatement(
    text: string,
    startPos: number,
  ): {
    condition: string;
    trueEffect: string;
    falseEffect?: string;
    endPos: number;
  } | null {
    // 检查是否以 'if[' 开头
    if (!text.substring(startPos).startsWith('if[')) {
      return null;
    }

    // 使用简单的字符串解析方法
    let pos = startPos + 3; // 跳过 'if['
    let bracketCount = 1;
    let condition = '';

    // 解析条件部分
    while (pos < text.length && bracketCount > 0) {
      const char = text[pos];
      if (char === '[') {
        bracketCount++;
      } else if (char === ']') {
        bracketCount--;
      }

      if (bracketCount > 0) {
        condition += char;
      }
      pos++;
    }

    if (bracketCount !== 0) {
      throw new Error('条件部分括号不平衡');
    }

    // 解析true效果部分
    if (pos >= text.length || text[pos] !== '[') {
      throw new Error('缺少true效果的开始括号');
    }

    pos++; // 跳过 '['
    bracketCount = 1;
    let trueEffect = '';

    while (pos < text.length && bracketCount > 0) {
      const char = text[pos];
      if (char === '[') {
        bracketCount++;
      } else if (char === ']') {
        bracketCount--;
      }

      if (bracketCount > 0) {
        trueEffect += char;
      }
      pos++;
    }

    if (bracketCount !== 0) {
      throw new Error('true效果部分括号不平衡');
    }

    // 检查是否有else部分
    if (pos < text.length && text.substring(pos).startsWith('else[')) {
      pos += 5; // 跳过 'else['
      bracketCount = 1;
      let falseEffect = '';

      while (pos < text.length && bracketCount > 0) {
        const char = text[pos];
        if (char === '[') {
          bracketCount++;
        } else if (char === ']') {
          bracketCount--;
        }

        if (bracketCount > 0) {
          falseEffect += char;
        }
        pos++;
      }

      if (bracketCount !== 0) {
        throw new Error('false效果部分括号不平衡');
      }

      return {
        condition: condition.trim(),
        trueEffect: trueEffect.trim(),
        falseEffect: falseEffect.trim(),
        endPos: pos,
      };
    }

    return {
      condition: condition.trim(),
      trueEffect: trueEffect.trim(),
      endPos: pos,
    };
  }

  /**
   * 解析平衡的中括号内容 - 改进版本，更好地处理复杂内容
   */
  private parseBalancedBrackets(
    text: string,
    startPos: number,
  ): {
    content: string;
    endPos: number;
  } | null {
    // 检查起始位置是否是'['
    if (text[startPos] !== '[') {
      console.warn('parseBalancedBrackets: 起始位置不是[，位置:', startPos, '字符:', text[startPos]);
      return null;
    }

    let pos = startPos + 1; // 跳过开始的'['
    let bracketCount = 1; // 已经遇到了一个开始括号
    let content = '';

    while (pos < text.length && bracketCount > 0) {
      const char = text[pos];

      if (char === '[') {
        bracketCount++;
      } else if (char === ']') {
        bracketCount--;
      }

      // 只有当不是最后一个闭合括号时才添加到内容中
      if (bracketCount > 0) {
        content += char;
      }

      pos++;
    }

    if (bracketCount !== 0) {
      console.warn('括号不平衡，剩余括号数:', bracketCount, '位置:', pos, '内容:', content);
      return null; // 括号不平衡
    }

    return {
      content: content.trim(),
      endPos: pos,
    };
  }

  /**
   * 生成条件表达式的描述
   */
  private generateConditionalDescription(condition: string, trueEffect: string, falseEffect: string): string {
    const conditionDesc = this.translateCondition(condition);
    const trueEffectDesc = this.generateEffectDescriptionFromString(trueEffect);

    if (falseEffect) {
      const falseEffectDesc = this.generateEffectDescriptionFromString(falseEffect);
      return `如果${conditionDesc}，则${trueEffectDesc}；否则${falseEffectDesc}`;
    } else {
      return `如果${conditionDesc}，则${trueEffectDesc}`;
    }
  }

  /**
   * 翻译条件表达式为中文
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
   * 从效果字符串生成描述
   */
  private generateEffectDescriptionFromString(effectString: string): string {
    // 处理状态效果
    if (effectString.includes('.status apply')) {
      const statusMatch = effectString.match(/(ME|OP|ALL)\.status apply (\w+)(?:\s+(.+))?/);
      if (statusMatch) {
        const [, target, statusId, stacksExpr = '1'] = statusMatch;
        const targetText = target === 'ME' ? '己方' : target === 'OP' ? '对方' : '双方';

        // 获取状态显示名称
        const statusDef = this.dynamicStatusManager?.getStatusDefinition(statusId);
        const statusName = statusDef?.name || statusId;

        // 翻译层数表达式
        let stacksText;
        if (stacksExpr.trim() === '1') {
          stacksText = '';
        } else if (/^\d+$/.test(stacksExpr.trim())) {
          stacksText = stacksExpr.trim() + '层';
        } else {
          stacksText = this.replaceVariablesInExpression(stacksExpr.trim());
        }

        if (stacksText) {
          return `${targetText}获得${stacksText}${statusName}`;
        } else {
          return `${targetText}获得${statusName}`;
        }
      }
    }

    // 处理基础属性效果
    const basicMatch = effectString.match(/(ME|OP|ALL)\.(\w+)\s*([+\-*/=])\s*(.+)/);
    if (basicMatch) {
      const [, target, attribute, operator, value] = basicMatch;
      const targetText = target === 'ME' ? '己方' : target === 'OP' ? '对方' : '双方';
      const attributeText = this.getAttributeChineseName(attribute);
      const operatorText = this.getOperatorChineseName(operator);
      const valueText = this.replaceVariablesInExpression(value);
      return `${targetText}的${attributeText}${operatorText}${valueText}`;
    }

    // 默认处理：替换变量名
    return this.replaceVariablesInExpression(effectString);
  }

  /**
   * 获取属性的中文名称
   */
  private getAttributeChineseName(attribute: string): string {
    const attributeMap: { [key: string]: string } = {
      hp: '生命值',
      lust: '欲望值',
      energy: '能量',
      block: '格挡值',
      max_hp: '最大生命值',
      max_lust: '最大欲望值',
      max_energy: '最大能量',
    };
    return attributeMap[attribute] || attribute;
  }

  /**
   * 获取操作符的中文名称
   */
  private getOperatorChineseName(operator: string): string {
    const operatorMap: { [key: string]: string } = {
      '+': '增加',
      '-': '减少',
      '*': '乘以',
      '/': '除以',
      '=': '设置为',
    };
    return operatorMap[operator] || operator;
  }

  /**
   * 替换表达式中的变量引用为中文显示名称
   */
  private replaceVariablesInExpression(expression: string): string {
    // 复用共享映射，避免重复
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { variableDisplayMap } = require('../shared/variableNames');

    let result = expression;

    // 先处理 stacks 二次指向（优先级最高）
    result = result.replace(/(ME|OP|ALL)\.stacks\.(\w+)/g, (match, target, buffid) => {
      const targetName = target === 'ME' ? '己方' : target === 'OP' ? '对方' : '双方';
      // 尝试获取状态的显示名称
      const statusDef = this.dynamicStatusManager?.getStatusDefinition(buffid);
      const buffName = statusDef?.name || buffid;
      // 更简洁的显示：不显示"层数"二字
      return `${targetName}${buffName}`;
    });

    // 替换ME.属性、OP.属性和ALL.属性
    result = result.replace(/(ME|OP|ALL)\.(\w+)/g, (match, target, attribute) => {
      // 跳过已经被处理过的 stacks 引用
      if (attribute === 'stacks') {
        return match;
      }
      const displayName = variableDisplayMap[attribute] || getAttributeDefinition(attribute)?.displayName || attribute;
      const targetName = target === 'ME' ? '己方' : target === 'OP' ? '对方' : '双方';
      return `${targetName}的${displayName}`;
    });

    // 替换独立变量（默认为己方的属性）
    Object.entries(variableDisplayMap).forEach(([variable, displayName]) => {
      const regex = new RegExp(`\\b${variable}\\b`, 'g');
      // 对于独立变量，添加"己方的"前缀
      result = result.replace(regex, `己方的${displayName}`);
    });

    return result;
  }

  /**
   * 解析单个效果部分（新语法）
   */
  private parseEffectPart(effectPart: string): EffectExpression {
    const expression: EffectExpression = {
      raw: effectPart,
      attribute: '',
      operator: '',
      value: '',
      isValid: false,
    };

    try {
      // 首先检查是否是if-else条件表达式
      const ifElseMatch = this.parseConditionalExpression(effectPart);
      if (ifElseMatch) {
        return ifElseMatch;
      }
      // 检查是否是能力格式：目标.触发条件(效果1, 效果2, ...) 或 触发条件(效果1, 效果2, ...)
      const abilityWithTargetMatch = effectPart.match(/^(ME|OP|ALL)\.([\w_]+)\((.+)\)$/);
      const abilityWithoutTargetMatch = effectPart.match(/^([\w_]+)\((.+)\)$/);

      if (abilityWithTargetMatch) {
        const [, target, trigger, effectsString] = abilityWithTargetMatch;

        if (VALID_TRIGGERS.includes(trigger as any)) {
          // 这是一个带目标的能力
          expression.target = target as 'ME' | 'OP' | 'ALL';
          expression.attribute = 'ability';
          expression.operator = 'add';
          expression.value = `${trigger}(${effectsString})`; // 保存完整的能力定义
          expression.isValid = true;
          expression.description = this.generateAbilityDescription(`${trigger}(${effectsString})`);

          return expression;
        } else {
          throw new Error(`未知的触发条件: ${trigger}`);
        }
      } else if (abilityWithoutTargetMatch) {
        const [, trigger, effectsString] = abilityWithoutTargetMatch;

        if (VALID_TRIGGERS.includes(trigger as any)) {
          // 这是一个无目标的能力，默认作用于玩家
          expression.target = 'ME';
          expression.attribute = 'ability';
          expression.operator = 'add';
          expression.value = `${trigger}(${effectsString})`; // 保存完整的能力定义
          expression.isValid = true;
          expression.description = this.generateAbilityDescription(`${trigger}(${effectsString})`);

          return expression;
        } else {
          throw new Error(`未知的触发条件: ${trigger}`);
        }
      } else {
        // 宽松处理：支持遗漏右括号或复杂内部表达式的能力格式，如 take_damage(energy + 1
        const looseAbilityMatch = effectPart.match(/^([\w_]+)\((.*)$/);
        if (looseAbilityMatch) {
          const [, trigger, rest] = looseAbilityMatch;
          if (VALID_TRIGGERS.includes(trigger as any)) {
            const effectsString = rest.endsWith(')') ? rest.slice(0, -1) : rest; // 宽容去除可能缺失的右括号
            expression.target = 'ME';
            expression.attribute = 'ability';
            expression.operator = 'add';
            expression.value = `${trigger}(${effectsString})`;
            expression.isValid = true;
            expression.description = this.generateAbilityDescription(`${trigger}(${effectsString})`);
            return expression;
          }
        }
      }

      // 检查是否是直接效果格式：目标.属性 操作符 值
      const directEffectMatch = effectPart.match(/^(ME|OP|ALL)\.([\w_]+)\s*([+\-*/=]|apply|remove)\s*(.+)$/);
      if (directEffectMatch) {
        const [, target, attribute, operator, value] = directEffectMatch;

        expression.target = target as 'ME' | 'OP' | 'ALL';
        expression.attribute = attribute;
        expression.operator = operator;

        // 特殊处理状态效果
        if (attribute === 'status' && (operator === 'apply' || operator === 'remove')) {
          // 对于状态效果，需要解析状态ID和层数（不再支持持续回合）
          if (operator === 'apply') {
            // 解析 "statusId layers" 格式
            const valueStr = value.trim();
            let statusId: string;
            let layersStr: string = '1';

            // 找到第一个空格，之前是statusId，之后是layers（可能是表达式）
            const firstSpaceIndex = valueStr.indexOf(' ');
            if (firstSpaceIndex > 0) {
              statusId = valueStr.substring(0, firstSpaceIndex);
              layersStr = valueStr.substring(firstSpaceIndex + 1).trim();
            } else {
              statusId = valueStr;
              layersStr = '1';
            }

            // 保持原始格式，不要转换为 statusId:layers，而是保持 "statusId layersStr"
            // 这样在 executeStatusEffect 中可以正确处理表达式
            expression.value = `${statusId} ${layersStr}`;
          } else {
            // remove操作只需要状态ID
            expression.value = value.trim();
          }
        } else {
          this.parseValueStringWithFlag(value, expression);
        }

        expression.isValid = true;
        expression.description = this.generateDescription(expression);

        // 解析为直接效果 - 移除日志减少输出
        return expression;
      }

      // 检查是否是卡牌操作格式：add_to_hand {cardData} 或 add_to_deck {cardData}
      if (effectPart.includes('add_to_hand ') || effectPart.includes('add_to_deck ')) {
        try {
          this.parseCardInsertion(effectPart, expression);
          expression.isValid = true;
          expression.description = this.generateDescription(expression);

          // 解析为卡牌操作 - 移除日志减少输出
          return expression;
        } catch (error) {
          throw new Error(`卡牌操作解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }

      // 统一走基础效果解析，确保选择器语法（hand.|draw.|discard. + 关键字）得到一致处理
      const basic = this.parseBasicEffect(effectPart);
      if (basic && basic.isValid) {
        return basic;
      }

      throw new Error(`无法解析的效果格式: ${effectPart}`);
    } catch (error) {
      console.error('❌ 解析效果部分失败:', effectPart, error);
      expression.isValid = false;
      expression.errorMessage = error instanceof Error ? error.message : '未知错误';
      return expression;
    }
  }

  /**
   * 解析卡牌插入表达式
   * 格式：add_to_hand {cardData} 或 add_to_deck {cardData}
   */
  private parseCardInsertion(remaining: string, expression: EffectExpression): void {
    let locationPart: string;
    let cardDataStr: string;

    if (remaining.startsWith('add_to_hand ')) {
      locationPart = 'add_to_hand';
      cardDataStr = remaining.substring('add_to_hand '.length).trim();
    } else if (remaining.startsWith('add_to_deck ')) {
      locationPart = 'add_to_deck';
      cardDataStr = remaining.substring('add_to_deck '.length).trim();
    } else {
      throw new Error(`卡牌插入格式错误: ${remaining}`);
    }

    // 设置属性
    expression.attribute = locationPart;
    expression.operator = 'add';

    // 解析卡牌数据（支持可选的数量后缀：add_to_deck {json} 2）
    try {
      // 提取前导JSON对象与其后的数量（若有）
      const extractJsonAndCount = (input: string): { objText: string; count: number } => {
        const s = input.trim();
        if (!s.startsWith('{')) {
          return { objText: s, count: 1 };
        }
        let brace = 0;
        let end = -1;
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          if (ch === '{') brace++;
          else if (ch === '}') {
            brace--;
            if (brace === 0) {
              end = i;
              break;
            }
          }
        }
        const objText = end >= 0 ? s.substring(0, end + 1) : s;
        const tail = s.substring(end + 1).trim();
        const m = tail.match(/^(\d+)$/);
        const count = m ? Math.max(1, parseInt(m[1], 10)) : 1;
        return { objText, count };
      };

      if (cardDataStr.startsWith('{') || cardDataStr.startsWith('{"')) {
        // 1) JSON + 可选数量
        // 处理转义引号
        const normalized = cardDataStr.replace(/\\"/g, '"');
        const { objText, count } = extractJsonAndCount(normalized);
        const obj = JSON.parse(objText);
        // 将数量附加到表达式以便执行阶段处理（避免破坏现有类型）
        (expression as any)._cardCount = count;
        expression.value = obj;
      } else {
        // 2) 简单ID + 可选数量
        const parts = cardDataStr.split(/\s+/);
        const id = parts[0];
        const maybeCount = parts[1] && /^\d+$/.test(parts[1]) ? parseInt(parts[1], 10) : 1;
        (expression as any)._cardCount = Math.max(1, maybeCount);
        expression.value = { id };
      }
    } catch (error) {
      console.error('卡牌数据解析失败:', cardDataStr, error);
      throw new Error(`卡牌数据解析失败: ${cardDataStr} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 解析基础表达式
   * 格式：[target.]attribute operator value
   */
  private parseBasicExpression(remaining: string, expression: EffectExpression): void {
    // 首先检查是否是选择器语法：attribute.selector [operator value]
    const selectorMatch = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z0-9_.+|]+)(?:\s*([+\-=*/])\s*(.+))?$/);
    if (selectorMatch) {
      const [, attribute, selector, operator, valuePart] = selectorMatch;
      expression.attribute = attribute;
      expression.selector = selector; // 保存选择器
      expression.operator = operator || '='; // 默认操作符
      expression.value = valuePart ? this.parseValueString(valuePart) : 1; // 默认值为1
      return;
    }
    // 增强：支持 attribute.selector 后直接跟数值（无操作符）的写法，如 reduce_cost.hand.all 1 / discard.hand.choose 2
    const selectorWithValue = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z0-9_.+|]+)\s+(.+)$/);
    if (selectorWithValue) {
      const [, attribute, selector, valuePart] = selectorWithValue;
      expression.attribute = attribute;
      expression.selector = selector;
      expression.operator = '=';
      expression.value = this.parseValueString(valuePart);
      expression.isValid = true;
      expression.description = this.generateDescription(expression);
      return;
    }

    // 匹配格式：[target.]attribute operator value
    // 修复正则表达式以正确匹配 ME.attribute 或 OP.attribute 或 ALL.attribute 格式
    const match = remaining.match(/^((?:ME|OP|ALL)\.[\w_]+|[\w_]+)\s*([+\-*/=])\s*(.+)$/);

    if (!match) {
      // 尝试匹配无操作符的情况（如修饰符）
      const simpleMatch = remaining.match(/^((?:ME|OP|ALL)\.[\w_]+|[\w_]+)$/);
      if (simpleMatch) {
        const [, attributePart] = simpleMatch;
        // 解析目标和属性
        if (attributePart.includes('.')) {
          const [target, attr] = attributePart.split('.');
          expression.target = target as 'ME' | 'OP' | 'ALL';
          expression.attribute = attr;
        } else {
          expression.attribute = attributePart;
        }
        expression.operator = '=';
        expression.value = 1; // 默认值
        return;
      }
      // 兼容 narrate "..." 作为独立效果
      const narrateAlone = remaining.match(/^narrate\s+["']([\s\S]*?)["']$/);
      if (narrateAlone) {
        expression.attribute = 'narrate';
        expression.operator = '=';
        expression.value = narrateAlone[1];
        expression.isValid = true;
        expression.description = `叙事：${expression.value}`;
        return;
      }
      throw new Error(`表达式格式错误: ${remaining}`);
    }

    const [, attributePart, operator, valuePart] = match;

    // 验证操作符
    if (!VALID_OPERATORS.includes(operator as any)) {
      throw new Error(`不支持的操作符: ${operator}`);
    }

    // 解析目标和属性
    if (attributePart.includes('.')) {
      const [target, attr] = attributePart.split('.');
      expression.target = target as 'ME' | 'OP' | 'ALL';
      expression.attribute = attr;
    } else {
      expression.attribute = attributePart;
    }

    expression.operator = operator;

    // 解析值
    if (expression.attribute === 'narrate') {
      // 叙事内容保持为字符串
      expression.value = valuePart.replace(/^["']|["']$/g, ''); // 移除引号
    } else {
      // 尝试解析为数字
      const numValue = parseFloat(valuePart);
      if (!isNaN(numValue)) {
        expression.value = numValue;
      } else {
        // 检查是否是变量引用（如max_hp, max_lust等）
        if (this.isVariableReference(valuePart)) {
          expression.value = valuePart; // 保持为字符串，在执行时解析
          expression.isVariableReference = true;
        } else if (this.isMathExpression(valuePart)) {
          // 包含变量的数学表达式
          expression.value = valuePart; // 保持为字符串，在执行时解析
          expression.isVariableReference = true;
        } else {
          expression.value = valuePart;
        }
      }
    }
  }

  /**
   * 解析值字符串
   */
  private parseValueString(valuePart: string): number | string {
    // 尝试解析为数字
    const numValue = parseFloat(valuePart);
    if (!isNaN(numValue)) {
      return numValue;
    } else {
      // 检查是否是变量引用（如max_hp, max_lust等）
      if (this.isVariableReference(valuePart)) {
        return valuePart; // 保持为字符串，在执行时解析
      } else {
        return valuePart;
      }
    }
  }

  /**
   * 解析值字符串并设置变量引用标志
   */
  private parseValueStringWithFlag(valuePart: string, expression: EffectExpression): void {
    // 尝试解析为数字
    const numValue = parseFloat(valuePart);
    if (!isNaN(numValue)) {
      expression.value = numValue;
    } else {
      // 检查是否是变量引用（如max_hp, max_lust等）
      if (this.isVariableReference(valuePart)) {
        expression.value = valuePart; // 保持为字符串，在执行时解析
        expression.isVariableReference = true;
      } else if (this.isMathExpression(valuePart)) {
        // 包含变量的数学表达式
        expression.value = valuePart; // 保持为字符串，在执行时解析
        expression.isVariableReference = true;
      } else {
        expression.value = valuePart;
      }
    }
  }

  /**
   * 生成人类可读的描述
   */
  private generateDescription(expression: EffectExpression): string {
    const attrDef = getAttributeDefinition(expression.attribute);
    const attrName = attrDef ? attrDef.displayName : expression.attribute;
    const targetName =
      expression.target === 'ME'
        ? '己方'
        : expression.target === 'OP'
          ? '对方'
          : expression.target === 'ALL'
            ? '双方'
            : '';

    let desc = '';

    // 添加前缀描述
    if (expression.prefix) {
      const prefixDesc = this.getPrefixDescription(expression.prefix);
      desc += `${prefixDesc}: `;
    }

    // 添加目标描述
    if (targetName) {
      desc += `${targetName}的`;
    }

    // 添加效果描述
    if (expression.attribute === 'ability' && expression.operator === 'add') {
      // 对于能力，解析触发条件和效果部分（仅支持 trigger(effects)）
      const abilityString = expression.value.toString();
      const m = abilityString.match(/^(?:(ME|OP)\.)?([\w_]+)\((.+)\)$/);
      if (m) {
        const trigger = m[2];
        const effectPart = m[3];
        const triggerDesc = this.getPrefixDescription(trigger);
        try {
          const effectExpression = this.parseBasicEffect(effectPart);
          const effectDesc = this.generateEffectDescription(effectExpression);
          desc = `${triggerDesc}时，${effectDesc}`;
        } catch {
          desc = `${triggerDesc}时，${effectPart}`;
        }
      } else {
        // 回退：未知格式，直接显示
        desc += abilityString;
      }
    } else if (expression.operator === 'apply') {
      const valueStr = expression.value.toString();
      let statusId: string;
      let stacksExpr: string;

      // 支持新格式 "statusId stacksExpr" 和旧格式 "statusId:stacks"
      const firstSpaceIndex = valueStr.indexOf(' ');
      if (firstSpaceIndex > 0) {
        statusId = valueStr.substring(0, firstSpaceIndex);
        stacksExpr = valueStr.substring(firstSpaceIndex + 1).trim();
      } else if (valueStr.includes(':')) {
        const parts = valueStr.split(':');
        statusId = parts[0];
        stacksExpr = parts[1] || '1';
      } else {
        statusId = valueStr;
        stacksExpr = '1';
      }

      // 翻译表达式中的变量
      let stacksDisplay;
      if (stacksExpr === '1') {
        stacksDisplay = '';
      } else if (/^\d+$/.test(stacksExpr)) {
        stacksDisplay = stacksExpr + '层';
      } else {
        stacksDisplay = this.replaceVariablesInExpression(stacksExpr);
      }

      desc += `施加${stacksDisplay ? stacksDisplay : ''}${statusId}状态`;
    } else if (expression.selector) {
      // 处理选择器语法
      const selectorDesc = this.getSelectorDescription(expression.selector);
      if (expression.attribute === 'discard') {
        desc += `弃掉${selectorDesc}的卡牌`;
      } else if (expression.attribute === 'reduce_cost') {
        // 文案优化：去掉“的卡牌”以符合直观中文
        desc += `${selectorDesc}费用减少${expression.value}`;
      } else if (expression.attribute === 'copy_card') {
        desc += `复制${selectorDesc}的卡牌`;
      } else if (expression.attribute === 'trigger_effect') {
        desc += `${selectorDesc}的卡牌下次使用效果触发两次`;
      } else {
        desc += `${attrName}${selectorDesc}`;
      }
    } else {
      const operatorDesc = this.getOperatorDescription(expression.operator);
      desc += `${attrName}${operatorDesc}${expression.value}`;
    }

    // 添加持续时间描述
    if (expression.duration) {
      desc += `，持续${expression.duration}回合`;
    }

    return desc;
  }

  /**
   * 获取前缀描述
   */
  private getPrefixDescription(prefix: string): string {
    const prefixMap: { [key: string]: string } = {
      battle_start: '战斗开始时',
      turn_start: '回合开始时',
      turn_end: '回合结束时',
      card_played: '打出卡牌时',
      take_damage: '受到伤害时',
      apply_status: '施加状态时',
      tick: '状态触发时',
    };

    return prefixMap[prefix] || prefix;
  }

  /**
   * 生成效果描述（不包含前缀）
   */
  private generateEffectDescription(expression: EffectExpression): string {
    let desc = '';

    // 获取属性显示名称
    const attrDef = getAttributeDefinition(expression.attribute);
    const attrName = attrDef ? attrDef.displayName : expression.attribute;

    // 添加效果描述
    if (expression.operator === 'apply') {
      const valueStr = expression.value.toString();
      let statusId: string;
      let stacksExpr: string;

      // 支持新格式 "statusId stacksExpr" 和旧格式 "statusId:stacks"
      const firstSpaceIndex = valueStr.indexOf(' ');
      if (firstSpaceIndex > 0) {
        statusId = valueStr.substring(0, firstSpaceIndex);
        stacksExpr = valueStr.substring(firstSpaceIndex + 1).trim();
      } else if (valueStr.includes(':')) {
        const parts = valueStr.split(':');
        statusId = parts[0];
        stacksExpr = parts[1] || '1';
      } else {
        statusId = valueStr;
        stacksExpr = '1';
      }

      // 翻译表达式中的变量
      let stacksDisplay;
      if (stacksExpr === '1') {
        stacksDisplay = '';
      } else if (/^\d+$/.test(stacksExpr)) {
        stacksDisplay = stacksExpr + '层';
      } else {
        stacksDisplay = this.replaceVariablesInExpression(stacksExpr);
      }

      desc += `施加${stacksDisplay ? stacksDisplay : ''}${statusId}状态`;
    } else {
      const operatorDesc = this.getOperatorDescription(expression.operator);

      // 处理变量引用的显示
      let valueDisplay = expression.value;
      if (typeof expression.value === 'string') {
        if (expression.isVariableReference) {
          // 简单变量引用
          const valueDef = getAttributeDefinition(expression.value);
          if (valueDef) {
            valueDisplay = valueDef.displayName;
          } else {
            // 如果没有定义，使用默认映射
            // 统一从 shared/variableNames 获取映射，避免重复维护
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { variableDisplayMap } = require('../shared/variableNames');
            valueDisplay = variableDisplayMap[expression.value] || expression.value;
          }
        } else if (this.containsVariableReference(expression.value)) {
          // 包含变量引用的数学表达式，进行替换
          valueDisplay = this.replaceVariablesInExpression(expression.value);
        }
      }

      desc += `${attrName}${operatorDesc}${valueDisplay}`;
    }

    return desc;
  }

  /**
   * 解析基础效果（不处理能力）
   */
  private parseBasicEffect(effectString: string): EffectExpression {
    const expression: EffectExpression = {
      raw: effectString,
      attribute: '',
      operator: '',
      value: '',
      isValid: false,
    };

    // 跳过能力处理，直接解析基础效果
    let remaining = effectString;

    // 处理持续时间
    const durationMatch = remaining.match(/^(.+?)\s*@(\d+)$/);
    if (durationMatch) {
      const [, rest, duration] = durationMatch;
      expression.duration = parseInt(duration);
      remaining = rest.trim();
    }

    // 处理卡牌插入
    if (remaining.includes('add_to_hand ') || remaining.includes('add_to_deck ')) {
      this.parseCardInsertion(remaining, expression);
    } else {
      // 解析基础表达式
      this.parseBasicExpression(remaining, expression);
      // 基础表达式成功解析后，标记为有效
      if (expression.attribute) {
        expression.isValid = true;
        if (!expression.description) {
          expression.description = this.generateDescription(expression);
        }
      }
    }

    return expression;
  }

  /**
   * 生成能力描述
   */
  private generateAbilityDescription(abilityString: string): string {
    // 仅支持新的括号语法：trigger(effect)
    const bracketMatch = abilityString.match(/^(?:(ME|OP)\.)?([\w_]+)\((.+)\)$/);
    if (bracketMatch) {
      const trigger = bracketMatch[2] as string;
      const effectPart = bracketMatch[3] as string;

      const triggerDesc = this.getPrefixDescription(trigger);

      try {
        const effectExpression = this.parseBasicEffect(effectPart);
        const effectDesc = this.generateEffectDescription(effectExpression);
        return `${triggerDesc}: ${effectDesc}`;
      } catch (error) {
        return `${triggerDesc}: ${effectPart}`;
      }
    }

    // 回退：无法识别则原样返回
    return abilityString;
  }

  /**
   * 获取操作符描述
   */
  private getOperatorDescription(operator: string): string {
    const operatorMap: { [key: string]: string } = {
      '+': '增加',
      '-': '减少',
      '*': '乘以',
      '/': '除以',
      '=': '设置为',
    };

    return operatorMap[operator] || operator;
  }

  /**
   * 获取属性定义
   */
  public getAttributeDefinition(attributeId: string): AttributeDefinition | undefined {
    return getAttributeDefinition(attributeId);
  }

  /**
   * 获取所有属性定义
   */
  public getAllAttributeDefinitions(): Map<string, AttributeDefinition> {
    return getAllAttributeDefinitions();
  }

  /**
   * 获取选择器描述
   */
  private getSelectorDescription(selector: string): string {
    // 统一复用 shared 工具，避免重复实现
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { describeSelector } = require('../shared/selectorUtils');
    return describeSelector(selector);
  }

  /**
   * 解析弃牌效果字符串（单个效果）
   */
  public parseDiscardEffect(discardEffectString: string): EffectExpression | null {
    console.log('🗑️ 解析弃牌效果:', discardEffectString);

    if (!discardEffectString || discardEffectString.trim() === '') {
      return null;
    }

    try {
      // 弃牌效果应该是单个效果，不使用逗号分割
      const trimmedEffect = discardEffectString.trim();
      const expression = this.parseEffectPart(trimmedEffect);

      if (expression.isValid) {
        // 弃牌效果解析成功 - 移除日志减少输出
        return expression;
      } else {
        console.warn('⚠️ 弃牌效果解析失败:', expression.errorMessage);
        return null;
      }
    } catch (error) {
      console.error('❌ 弃牌效果解析异常:', discardEffectString, error);
      return null;
    }
  }
}
