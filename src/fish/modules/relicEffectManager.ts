/**
 * 遗物效果管理器
 * 负责处理遗物的各种触发时机和效果
 */

import { UnifiedEffectExecutor } from '../combat/unifiedEffectExecutor';
import { GameStateManager } from '../core/gameStateManager';
import {
  convertLegacyIfSyntax as convertLegacy,
  extractTriggeredSegments as extractSegs,
} from '../shared/effectStringUtils';

export class RelicEffectManager {
  private static instance: RelicEffectManager;
  private gameStateManager: GameStateManager;
  private effectExecutor: UnifiedEffectExecutor;

  private constructor() {
    this.gameStateManager = GameStateManager.getInstance();
    this.effectExecutor = UnifiedEffectExecutor.getInstance();
  }

  public static getInstance(): RelicEffectManager {
    if (!RelicEffectManager.instance) {
      RelicEffectManager.instance = new RelicEffectManager();
    }
    return RelicEffectManager.instance;
  }

  /**
   * 触发回合开始时的遗物效果
   */
  public async triggerOnTurnStart(): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    const relics = player.relics || [];

    console.log('🔮 检查回合开始时的遗物效果...');
    console.log(
      `🔮 玩家共有 ${relics.length} 个遗物:`,
      relics.map(r => `${r.name}: ${r.effect}`),
    );

    for (const relic of relics) {
      if (relic.effect && relic.effect.includes('turn_start(')) {
        console.log(`🔮 触发回合开始遗物: ${relic.name}`);
        await this.triggerRelicEffect(relic, 'turn_start');
      } else if (relic.effect) {
        console.log(`🔮 跳过遗物 ${relic.name}: 不包含turn_start触发`);
      }
    }
  }

  /**
   * 触发回合结束时的遗物效果
   */
  public async triggerOnTurnEnd(): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    const relics = player.relics || [];

    console.log('🔮 检查回合结束时的遗物效果...');

    for (const relic of relics) {
      if (relic.effect && relic.effect.includes('turn_end(')) {
        await this.triggerRelicEffect(relic, 'turn_end');
      }
    }
  }

  /**
   * 触发战斗开始时的遗物效果
   */
  public async triggerOnBattleStart(): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    const relics = player.relics || [];

    console.log('🔮 检查战斗开始时的遗物效果...');

    for (const relic of relics) {
      if (relic.effect && relic.effect.includes('battle_start(')) {
        await this.triggerRelicEffect(relic, 'battle_start');
      }
    }
  }

  /**
   * 触发被动遗物效果
   */
  public async triggerPassiveEffects(): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    const relics = player.relics || [];

    console.log('🔮 检查被动遗物效果...');

    for (const relic of relics) {
      if (relic.effect && relic.effect.includes('passive(')) {
        await this.triggerRelicEffect(relic, 'passive');
      }
    }
  }

  /**
   * 触发欲望增加时的遗物效果
   */
  public async triggerOnLustIncrease(): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    const relics = player.relics || [];

    console.log('🔮 检查欲望增加时的遗物效果...');

    for (const relic of relics) {
      if (relic.effect && relic.effect.includes('lust_increase(')) {
        console.log(`🔮 触发欲望增加遗物: ${relic.name}`);
        await this.triggerRelicEffect(relic, 'lust_increase');
      }
    }
  }

  /**
   * 触发受到伤害时的遗物效果
   */
  public triggerOnTakeDamage(damage: number): void {
    const player = this.gameStateManager.getPlayer();
    const relics = player.relics || [];

    relics.forEach(relic => {
      const hasSegment = this.extractTriggeredSegments(relic.effect || '', 'on_take_damage').length > 0;
      if (hasSegment) {
        this.triggerRelicEffect(relic, 'on_take_damage', { damage });
      }
    });
  }

  /**
   * 触发造成伤害时的遗物效果
   */
  public triggerOnDealDamage(damage: number): void {
    const player = this.gameStateManager.getPlayer();
    const relics = player.relics || [];

    relics.forEach(relic => {
      const hasSegment = this.extractTriggeredSegments(relic.effect || '', 'on_deal_damage').length > 0;
      if (hasSegment) {
        this.triggerRelicEffect(relic, 'on_deal_damage', { damage });
      }
    });
  }

  /**
   * 触发打出卡牌时的遗物效果
   */
  public async triggerOnCardPlayed(): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    const relics = player.relics || [];

    console.log('🔮 检查打出卡牌时的遗物效果...');

    for (const relic of relics) {
      if (relic.effect && relic.effect.includes('card_played(')) {
        await this.triggerRelicEffect(relic, 'card_played');
      }
    }
  }

  /**
   * 执行遗物效果
   */
  private async triggerRelicEffect(relic: any, trigger: string, context?: any): Promise<void> {
    try {
      console.log(`🔮 触发遗物效果: ${relic.name} (${trigger})`);
      console.log(`🔍 遗物效果字符串: ${relic.effect}`);

      // 显示视觉反馈
      this.showRelicTriggerFeedback(relic);

      // 支持同一遗物字符串中包含多个触发片段：trigger(...), other_trigger(...), ...
      const segments = this.extractTriggeredSegments(relic.effect, trigger);
      if (segments.length > 0) {
        for (const seg of segments) {
          let effectContent = this.convertLegacyIfSyntax(seg);
          console.log(`🎯 执行遗物新格式效果: ${effectContent}`);
          await this.effectExecutor.executeEffectString(effectContent, true, {
            isRelicEffect: true,
            relicContext: relic,
            triggerType: trigger,
          });
          console.log(`✅ 遗物 ${relic.name} 成功触发效果: ${effectContent}`);
        }
        return;
      }

      // 如果没有找到匹配的触发片段，则跳过
      console.log(`⚠️ 遗物 ${relic.name} 不包含 ${trigger}(...) 触发片段，跳过`);
    } catch (error) {
      console.error(`❌ 遗物效果执行失败: ${relic.name}`, error);
    }
  }

  /**
   * 检查遗物是否有指定触发条件
   */
  public hasRelicWithTrigger(trigger: string): boolean {
    const player = this.gameStateManager.getPlayer();
    const relics = player.relics || [];

    return relics.some(relic => relic.effect && relic.effect.includes(`${trigger}(`));
  }

  /**
   * 获取所有具有指定触发条件的遗物
   */
  public getRelicsWithTrigger(trigger: string): any[] {
    const player = this.gameStateManager.getPlayer();
    const relics = player.relics || [];

    return relics.filter(relic => relic.effect && relic.effect.includes(`${trigger}(`));
  }

  /**
   * 触发卡牌被弃掉时的遗物效果
   */
  public async triggerOnCardDiscarded(card: any): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    const relics = player.relics || [];

    console.log('🔮 检查卡牌弃掉时的遗物效果...');

    for (const relic of relics) {
      if (relic.effect.includes('card_discarded(')) {
        console.log(`🔮 遗物 ${relic.name} 有卡牌弃掉触发效果`);
        await this.triggerRelicEffect(relic, 'card_discarded');
      }
    }
  }

  /**
   * 转换旧格式的if语法为新格式
   */
  private convertLegacyIfSyntax(effectContent: string): string {
    return convertLegacy(effectContent);
  }

  /**
   * 提取指定触发器的所有效果片段，支持同一字符串中多个片段
   * 例如："battle_start(draw+1), turn_start(if[...][...]), turn_start(draw+1)"
   */
  private extractTriggeredSegments(text: string, trigger: string): string[] {
    return extractSegs(text, trigger);
  }

  /**
   * 显示遗物触发的视觉反馈
   */
  private showRelicTriggerFeedback(relic: any): void {
    // 可以添加遗物触发的动画效果
    console.log(`💫 遗物 ${relic.name} 发动！`);

    // 这里可以添加UI动画，比如让遗物图标闪烁
    const relicElement = $(`.relic-item[data-relic-id="${relic.id}"]`);
    if (relicElement.length > 0) {
      relicElement.addClass('relic-triggered');
      setTimeout(() => {
        relicElement.removeClass('relic-triggered');
      }, 1000);
    }
  }
}
