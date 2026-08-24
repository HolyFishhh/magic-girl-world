import { BattleLog } from '../modules/battleLog';
import { escapeHtml } from '../shared/html';
import type { Enemy, EnemyAction } from '../../game-core';
import { AnimationManager } from './animationManager';
import { EffectProgramDisplay, summarizeEffectProgram, type IntentType } from './effectProgramDisplay';

type IntentPresentation = {
  type: IntentType;
  description: string;
  damage?: number;
  lustDamage?: number;
  block?: number;
};

/** Owns enemy-intent DOM, battle-log messages, and enemy action animation. */
export class EnemyIntentPresenter {
  private static instance: EnemyIntentPresenter;
  private readonly effectDisplay = EffectProgramDisplay.getInstance();
  private readonly animationManager = AnimationManager.getInstance();

  static getInstance(): EnemyIntentPresenter {
    if (!EnemyIntentPresenter.instance) EnemyIntentPresenter.instance = new EnemyIntentPresenter();
    return EnemyIntentPresenter.instance;
  }

  addLog(message: string, type: 'info' | 'damage' | 'heal' | 'action' | 'system' = 'info'): void {
    BattleLog.addLog(message, type);
  }

  showStunned(enemyName: string): void {
    try {
      this.addLog(`${enemyName}被眩晕，无法行动！`, 'system');
      this.animationManager.showEnemyActionAnimation('眩晕', `${enemyName}无法行动！`);
    } catch (error) {
      console.warn('显示敌人眩晕状态失败:', error);
    }
  }

  showAction(action: Pick<EnemyAction, 'name' | 'description'>): void {
    try {
      this.animationManager.showEnemyActionAnimation(action.name, action.description);
    } catch (error) {
      console.warn('显示敌人行动动画失败:', error);
    }
  }

  render(enemy: Enemy | null): void {
    if (!enemy) return;
    try {
      const model = this.createDisplayModel(enemy);
      const intentElement = $('.enemy-intent');
      if (intentElement.length > 0) {
        intentElement.html(`
          <div class="intent-icon">${escapeHtml(model.icon)}</div>
          <div class="intent-description">${escapeHtml(model.description)}</div>
          ${model.effectTagsHtml ? `<div class="intent-effects">${model.effectTagsHtml}</div>` : ''}
        `);
      } else {
        $('.intent-icon').text(model.icon);
        $('.intent-text').text(model.description);
      }
    } catch (error) {
      console.warn('更新敌人意图显示失败:', error);
    }
  }

  private createDisplayModel(enemy: Enemy): { icon: string; description: string; effectTagsHtml: string } {
    const action = enemy.nextAction || this.firstAction(enemy.actions);
    if (action) {
      const parsed = this.parseAction(action);
      let description = parsed.description;
      if (parsed.damage) description += ` (${parsed.damage}伤害)`;
      if (parsed.lustDamage) description += ` (${parsed.lustDamage}欲望)`;
      if (parsed.block) description += ` (${parsed.block}格挡)`;
      return {
        icon: this.iconFor(parsed.type),
        description,
        effectTagsHtml: this.effectDisplay.createEffectTagsHTML(this.effectDisplay.programToTags(action.effectProgram)),
      };
    }

    if (enemy.intent) {
      return {
        icon: enemy.intent.emoji || '？',
        description: enemy.intent.description || '准备行动',
        effectTagsHtml: '',
      };
    }
    return { icon: '？', description: '准备行动', effectTagsHtml: '' };
  }

  private parseAction(action: EnemyAction): IntentPresentation {
    const summary = summarizeEffectProgram(action.effectProgram);
    return {
      ...summary,
      description: action.description || action.name || '未知行动',
    };
  }

  private firstAction(actions: EnemyAction[]): EnemyAction | null {
    return Array.isArray(actions)
      ? actions.find(action => action && typeof action === 'object' && typeof action.name === 'string') || null
      : null;
  }

  private iconFor(type: IntentType): string {
    switch (type) {
      case 'attack':
        return '⚔️';
      case 'lust_attack':
        return '💖';
      case 'defend':
        return '🛡️';
      case 'heal':
        return '💚';
      case 'debuff':
        return '🌀';
      default:
        return '？';
    }
  }
}
