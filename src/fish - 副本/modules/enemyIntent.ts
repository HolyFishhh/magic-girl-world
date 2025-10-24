/**
 * 敌人意图管理模块（用语统一：我方/对方）
 */

import { GameStateManager } from '../core/gameStateManager';
import { inferIntentFromEffect } from '../shared/effectAnalysis';
import { UnifiedEffectDisplay } from '../ui/unifiedEffectDisplay';

const effectDisplay = UnifiedEffectDisplay.getInstance();

/**
 * 解析敌人行动效果 - 使用统一的效果解析系统
 */
function parseEnemyActionEffect(action: any): {
  type: string;
  description: string;
  tags: any[];
  damage?: number;
  lustDamage?: number;
  block?: number;
} {
  const effect = action.effect || '';
  const tags = effectDisplay.parseEffectToTags(effect, { isPlayerCard: false });

  // 统一由共享分析器推断类型与数值
  const summary = inferIntentFromEffect(effect);

  return {
    type: summary.type,
    description: action.description || action.name || '未知行动',
    tags, // 使用统一解析系统生成的标签
    damage: summary.damage,
    lustDamage: summary.lustDamage,
    block: summary.block,
  };
}

/**
 * 获取效果类型图标
 */
function getEffectTypeIcon(type: string): string {
  switch (type) {
    case 'attack':
      return '⚔️';
    case 'lust_attack':
      return '💗';
    case 'defend':
      return '🛡️';
    case 'heal':
      return '💚';
    case 'debuff':
      return '💀';
    default:
      return '❓';
  }
}

export interface EnemyAction {
  name: string;
  description: string;
  effect: string;
}

export interface ParsedIntent {
  type: string;
  damage?: number;
  block?: number;
  heal?: number;
  description: string;
  name: string;
  effect: string;
}

export class EnemyIntentManager {
  /**
   * 解析行动意图
   */
  static parseActionIntent(action: EnemyAction): ParsedIntent {
    if (!action || !action.effect) {
      return {
        type: 'unknown',
        description: action?.description || '未知行动',
        name: action?.name || '未知',
        effect: action?.effect || '',
      } as ParsedIntent;
    }

    const parsed = parseEnemyActionEffect(action);

    return {
      type: parsed.type,
      damage: parsed.damage,
      block: parsed.block,
      description: action.description || action.name || '未知行动',
      name: action.name,
      effect: action.effect,
    } as ParsedIntent;
  }

  /**
   * 更新敌人意图显示
   */
  static updateEnemyIntentDisplay(enemy: any): void {
    let icon = '❓';
    let description = '准备行动';

    let effectTagsHTML = '';

    // 优先检查nextAction（AI生成的下一个行动）
    if (enemy.nextAction) {
      const action = enemy.nextAction;

      // 使用新的效果解析系统
      const parsedEffect = parseEnemyActionEffect(action);
      icon = getEffectTypeIcon(parsedEffect.type);
      description = parsedEffect.description;
      effectTagsHTML = effectDisplay.createEffectTagsHTML(parsedEffect.tags);

      // 如果有具体的数值，添加到描述中
      if (parsedEffect.damage) {
        description += ` (${parsedEffect.damage}伤害)`;
      }
      if (parsedEffect.lustDamage) {
        description += ` (${parsedEffect.lustDamage}欲望)`;
      }
      if (parsedEffect.block) {
        description += ` (${parsedEffect.block}格挡)`;
      }
    } else if (enemy.intent) {
      // 备用：检查旧的intent格式
      icon = enemy.intent.icon || '❓';
      description = enemy.intent.description || '准备行动';
    } else if (enemy.actions && Array.isArray(enemy.actions) && enemy.actions.length > 0) {
      // 如果没有设置意图，从可用行动中随机预览一个
      const validActions = this.filterMetadata(enemy.actions);
      if (validActions.length > 0) {
        const randomAction = validActions[Math.floor(Math.random() * validActions.length)];
        const parsedIntent = this.parseActionIntent(randomAction);

        switch (parsedIntent.type) {
          case 'attack':
            icon = '⚔️';
            break;
          case 'lust_attack':
            icon = '💋';
            break;
          case 'defend':
            icon = '🛡️';
            break;
          case 'heal':
            icon = '💚';
            break;
          case 'debuff':
            icon = '💀';
            break;
          default:
            icon = '❓';
        }

        description = randomAction.description || randomAction.name || '未知行动';
      }
    }

    // 更新UI显示
    const intentElement = $('.enemy-intent');
    if (intentElement.length > 0) {
      intentElement.html(`
        <div class="intent-icon">${icon}</div>
        <div class="intent-description">${description}</div>
        ${effectTagsHTML ? `<div class="intent-effects">${effectTagsHTML}</div>` : ''}
      `);
    } else {
      // 备用：更新单独的元素
      $('.intent-icon').text(icon);
      $('.intent-text').text(description);
    }

    console.log(`更新敌人意图: ${icon} ${description}`);
  }

  /**
   * 为敌人设置下一个行动意图
   */
  static setNextAction(enemy: any, actions: EnemyAction[]): void {
    if (!actions || actions.length === 0) return;

    const validActions = this.filterMetadata(actions);
    if (validActions.length === 0) return;

    const mode = (enemy.actionMode || enemy.action_mode || 'random') as string;
    const config = enemy.actionConfig || enemy.action_config || {};

    // 名称映射表，便于通过名字查找动作
    const byName = new Map<string, EnemyAction>();
    for (const a of validActions) byName.set(a.name, a);

    const pickRandom = () => validActions[Math.floor(Math.random() * validActions.length)];

    const pickByProbability = (weights: Record<string, number>) => {
      // 仅保留在 actions 中存在的条目
      const entries = Object.entries(weights || {}).filter(([name, w]) => byName.has(name) && (w || 0) > 0);
      if (entries.length === 0) return null;
      const total = entries.reduce((s, [, w]) => s + (w || 0), 0);
      let r = Math.random() * total;
      for (const [name, w] of entries) {
        r -= w || 0;
        if (r <= 0) return byName.get(name)!;
      }
      return byName.get(entries[entries.length - 1][0])!;
    };

    const pickBySequence = (seq: string[], loop: boolean): EnemyAction | null => {
      if (!Array.isArray(seq) || seq.length === 0) return null;
      const idx = enemy._sequenceIndex || 0;
      const name = seq[idx];
      const act = byName.get(name) || null;
      // 前移索引
      if (loop) {
        enemy._sequenceIndex = (idx + 1) % seq.length;
      } else {
        enemy._sequenceIndex = idx + 1;
      }
      return act;
    };

    let chosen: EnemyAction | null = null;

    switch (mode) {
      case 'probability': {
        chosen = pickByProbability(config);
        if (!chosen) chosen = pickRandom();
        console.log(`🎯 敌人意图选择[概率]`);
        break;
      }
      case 'sequence': {
        const seq = Array.isArray(config?.sequence) ? config.sequence : [];
        chosen = pickBySequence(seq, true) || pickRandom();
        console.log(`🎯 敌人意图选择[顺序] index=${enemy._sequenceIndex || 0}`);
        break;
      }
      case 'sequence_then_probability': {
        const seq = Array.isArray(config?.sequence) ? config.sequence : [];
        if (!enemy._sequenceDoneOnce && (enemy._sequenceIndex || 0) < seq.length) {
          chosen = pickBySequence(seq, false);
          if ((enemy._sequenceIndex || 0) >= seq.length) enemy._sequenceDoneOnce = true;
          console.log(`🎯 敌人意图选择[顺序阶段] index=${enemy._sequenceIndex || 0}`);
        }
        if (!chosen) {
          const weights = config?.probability && typeof config.probability === 'object' ? config.probability : config;
          chosen = pickByProbability(weights) || pickRandom();
          console.log(`🎯 敌人意图选择[概率阶段]`);
        }
        break;
      }
      case 'random':
      default: {
        chosen = pickRandom();
        console.log(`🎯 敌人意图选择[随机]`);
      }
    }

    if (!chosen) chosen = pickRandom();
    if (!chosen) return; // 双保险

    const parsedIntent = this.parseActionIntent(chosen as EnemyAction);

    // 持久化到全局状态（getEnemy 可能返回拷贝，直接赋值会丢失）
    try {
      const gsm = GameStateManager.getInstance();
      const updates: any = { nextAction: parsedIntent };
      if (typeof enemy._sequenceIndex !== 'undefined') updates._sequenceIndex = enemy._sequenceIndex;
      if (typeof enemy._sequenceDoneOnce !== 'undefined') updates._sequenceDoneOnce = enemy._sequenceDoneOnce;
      gsm.updateEnemy(updates);
    } catch {}

    console.log(`设置敌人下回合意图: ${chosen.name} - ${chosen.description}`);

    // 读取最新状态用于展示
    this.updateEnemyIntentDisplay(GameStateManager.getInstance().getEnemy());
  }

  /**
   * 初始化敌人意图（战斗开始时）
   */
  static initializeEnemyIntent(enemy: any): void {
    if (!enemy || !enemy.actions) return;
    // 首次也走统一选择逻辑，尊重 actionMode/actionConfig
    this.setNextAction(enemy, enemy.actions);
  }

  /**
   * 执行敌人当前意图并设置下一个意图
   */
  static executeCurrentIntentAndSetNext(enemy: any): void {
    // 执行当前意图
    if (enemy.nextAction) {
      console.log(`敌人执行行动: ${enemy.nextAction.name}`);

      // 这里会在主模块中调用具体的执行逻辑
      // 执行完成后设置下一个意图
      if (enemy.actions) {
        this.setNextAction(enemy, enemy.actions);
      }
    }
  }

  /**
   * 过滤元数据标记
   */
  private static filterMetadata(array: any[]): any[] {
    if (!Array.isArray(array)) return [];

    return array.filter(item => {
      if (!item || typeof item !== 'object') return false;

      // 过滤掉元数据标记
      const keys = Object.keys(item);
      if (keys.length === 1 && (keys[0] === '_metadata' || keys[0].startsWith('_'))) {
        return false;
      }

      return true;
    });
  }

  /**
   * 获取意图的详细信息用于显示
   */
  static getIntentDisplayInfo(intent: ParsedIntent): { icon: string; text: string; color: string } {
    let icon = '❓';
    let text = '未知行动';
    let color = '#ffffff';

    switch (intent.type) {
      case 'attack':
        icon = '⚔️';
        text = `攻击 ${intent.damage || '?'}`;
        color = '#ff4444';
        break;
      case 'lust_attack':
        icon = '💋';
        text = `欲望攻击 ${intent.damage || '?'}`;
        color = '#ff44ff';
        break;
      case 'defend':
        icon = '🛡️';
        text = `防御 ${intent.block || '?'}`;
        color = '#4444ff';
        break;
      case 'heal':
        icon = '💚';
        text = `治疗 ${intent.heal || '?'}`;
        color = '#44ff44';
        break;
      case 'buff':
        icon = '💪';
        text = '增益';
        color = '#ffaa44';
        break;
      case 'debuff':
        icon = '💀';
        text = '减益';
        color = '#aa44aa';
        break;
      default:
        icon = '❓';
        text = intent.description || '未知行动';
        color = '#ffffff';
    }

    return { icon, text, color };
  }
}
