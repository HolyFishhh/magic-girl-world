import { BattleLog } from '../modules/battleLog';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';
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
      this.animationManager.showEnemyActionAnimation('眩晕', `${enemyName}无法行动！`, 'skill', '💫');
    } catch (error) {
      console.warn('显示敌人眩晕状态失败:', error);
    }
  }

  showAction(action: EnemyAction): void {
    try {
      const summary = summarizeEffectProgram(action.effectProgram);
      const kind = summary.type === 'attack' || summary.type === 'lust_attack' ? 'enemy' : 'skill';
      const emoji = this.iconFor(summary.type);
      this.logAction(action.name, action.description || '执行行动');
      this.animationManager.showEnemyActionAnimation(
        action.name,
        action.description,
        kind,
        emoji,
        action.effectProgram,
      );
    } catch (error) {
      console.warn('显示敌人行动动画失败:', error);
    }
  }

  logAction(actionName: string, description: string): void {
    BattleLog.logEnemyAction(actionName, description);
  }

  render(enemy: Enemy | null): void {
    if (!enemy) return;
    try {
      const model = this.createDisplayModel(enemy);
      const intentElement = $('.enemy-intent');
      if (intentElement.length > 0) {
        intentElement.html(`
          <div class="intent-icon">${escapeHtml(model.icon)}</div>
          <div class="intent-description" title="${escapeHtmlAttribute(model.details)}">${escapeHtml(model.description)}</div>
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

  private createDisplayModel(enemy: Enemy): {
    icon: string;
    description: string;
    details: string;
    effectTagsHtml: string;
  } {
    const action = enemy.nextAction || this.firstAction(enemy.actions);
    if (action) {
      const parsed = this.parseAction(action);
      return {
        icon: this.iconFor(parsed.type),
        description: action.name || '未知行动',
        details: parsed.description,
        effectTagsHtml: this.effectDisplay.createEffectTagsHTML(
          this.effectDisplay.programToTags(action.effectProgram, { selfLabel: '敌方', opponentLabel: '我方' }),
        ),
      };
    }

    if (enemy.intent) {
      return {
        icon: enemy.intent.emoji || '？',
        description: enemy.intent.description || '准备行动',
        details: enemy.intent.description || '准备行动',
        effectTagsHtml: '',
      };
    }
    return { icon: '？', description: '准备行动', details: '准备行动', effectTagsHtml: '' };
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
