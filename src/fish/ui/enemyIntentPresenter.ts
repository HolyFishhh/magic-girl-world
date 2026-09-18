import { showBattleDialogue } from './battleDialogue';
import { isolatedPresenter } from '../core/isolatedBattlePresentation';
import { BattleLog } from '../modules/battleLog';
import { escapeHtml } from '../shared/html';
import { evaluateConditionExpression, roundBattleDisplayValue, type EffectNode, type Enemy, type EnemyAction } from '../../game-core';
import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import { UnifiedEffectExecutor } from '../combat/unifiedEffectExecutor';
import { GameStateManager } from '../core/gameStateManager';
import { AnimationManager } from './animationManager';
import { summarizeEffectProgram, type IntentType } from './effectProgramDisplay';

type IntentBadge = {
  icon: string;
  value: string;
  label: string;
};

/** Owns enemy-intent DOM, battle-log messages, and enemy action animation. */
export class EnemyIntentPresenter {
  private static instance: EnemyIntentPresenter;
  private readonly animationManager = AnimationManager.getInstance();

  static getInstance(): EnemyIntentPresenter {
    const isolated = isolatedPresenter<EnemyIntentPresenter>('intent');
    if (isolated) return isolated;
    if (!EnemyIntentPresenter.instance) EnemyIntentPresenter.instance = new EnemyIntentPresenter();
    return EnemyIntentPresenter.instance;
  }

  async showEscape(enemyId: string): Promise<void> {
    await this.animationManager.animateEnemyEscape(enemyId);
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

  showAction(action: EnemyAction, enemy?: Pick<Enemy, 'id' | 'name'>): Promise<void> {
    try {
      const summary = summarizeEffectProgram(action.effectProgram);
      const kind = summary.type === 'attack' || summary.type === 'lust_attack' ? 'enemy' : 'skill';
      const emoji = action.emoji || this.iconFor(summary.type);
      this.logAction(action.name, action.description || '执行行动', enemy);
      if (action.dialogue) {
        this.addLog(`${enemy?.name || '敌人'}：${action.dialogue}`, 'action');
        showBattleDialogue(action.dialogue, enemy?.id ? { actor: 'enemy', id: String(enemy.id), name: enemy.name || '敌人' } : { actor: 'player', name: enemy?.name || '敌人' });
      }
      return this.animationManager.showEnemyActionAnimation(
        action.name,
        action.description,
        kind,
        emoji,
        action.effectProgram,
      );
    } catch (error) {
      console.warn('显示敌人行动动画失败:', error);
      return Promise.resolve();
    }
  }

  logAction(actionName: string, description: string, enemy?: Pick<Enemy, 'id' | 'name'>): void {
    BattleLog.logEnemyAction(actionName, description, enemy);
  }

  render(enemy: Enemy | null): void {
    if (!enemy) return;
    try {
      const model = this.createDisplayModel(enemy);
      const intentElement = $('.enemy-intent');
      if (intentElement.length > 0) {
        intentElement.html(`
          <div class="intent-description" title="点击查看完整行动">${escapeHtml(model.description)}</div>
        `);
      } else {
        $('.intent-text').text(model.description);
      }
    } catch (error) {
      console.warn('更新敌人意图显示失败:', error);
    }
  }

  public createDisplayModel(enemy: Enemy): {
    description: string;
    badges: IntentBadge[];
  } {
    if (enemy.escapePending) {
      const count = Math.max(0, (enemy.escapeReadyTurn ?? 0) - GameStateManager.getInstance().getGameState().currentTurn - 1);
      const label = count === 0 ? '本回合结束时逃跑' : `还有${count}回合准备逃跑`;
      return { description: label, badges: [{ icon: '🏃', value: String(count), label: `${label}；逃离动画结束后离场，不计为击杀。` }] };
    }
    const action = enemy.nextAction || this.firstAction(enemy.actions);
    if (action) {
      return {
        description: action.name || '未知行动',
        badges: this.createIntentBadges(action, enemy),
      };
    }

    if (enemy.intent) {
      return {
        description: enemy.intent.description || '准备行动',
        badges: [{ icon: enemy.intent.emoji || '？', value: '', label: enemy.intent.description || '准备行动' }],
      };
    }
    return {
      description: '准备行动',
      badges: [{ icon: '？', value: '', label: '准备行动' }],
    };
  }

  private createIntentBadges(action: EnemyAction, enemy: Enemy): IntentBadge[] {
    const summary = summarizeEffectProgram(action.effectProgram);
    const badges: IntentBadge[] = [];
    const add = (icon: string, value: number | string | undefined, label: string): void => {
      const displayed = typeof value === 'number' ? String(roundBattleDisplayValue(value)) : value || '';
      badges.push({ icon, value: displayed, label });
    };
    const executor = UnifiedEffectExecutor.getInstance();
    const hits: Array<{ value: string; count: number; target: string; group: string }> = [];
    const visitDamage = (nodes: EffectNode[]): void => {
      for (const node of nodes) {
        if (node.op === 'damage') {
          let value = '?';
          try { value = String(roundBattleDisplayValue(executor.previewEnemyIntentDamage(enemy, node.amount, node.target, node.damageKind))); } catch { /* Unknown context is not a zero-damage promise. */ }
          const group = node.hitGroup || JSON.stringify(node);
          const previous = hits.at(-1);
          if (previous && previous.group === group && previous.value === value && previous.target === node.target) previous.count += 1;
          else hits.push({ value, count: 1, target: node.target, group });
        } else if (node.op === 'if') {
          try { visitDamage(evaluateConditionExpression(node.condition, executor.getCoreEffectState(false, enemy), { spentEnergy: 0 }) ? node.then : node.else || []); }
          catch { hits.push({ value: '?', count: 1, target: 'opponent', group: 'conditional' }); }
        }
      }
    };
    visitDamage(action.effectProgram.steps);
    for (const hit of hits) {
      const amount = hit.count > 1 ? `${hit.value}×${hit.count}` : hit.value;
      add('⚔️', amount, `按当前状态预计${hit.target === 'self' ? '对自身' : '对我方'}造成${hit.value}点伤害${hit.count > 1 ? `，共${hit.count}次` : ''}（格挡吸收前）`);
    }
    if (summary.lustDamage)
      add('💖', summary.lustDamage, `增加${roundBattleDisplayValue(summary.lustDamage)}点欲望`);
    if (summary.block) add('🛡️', summary.block, `获得${roundBattleDisplayValue(summary.block)}点格挡`);

    const statusTotals = new Map<string, { icon: string; value: number | null; label: string }>();
    const directTotals = new Map<string, number | null>();
    const recordDirect = (key: string, amount: unknown): void => {
      const value = typeof amount === 'number' ? amount : null;
      const previous = directTotals.get(key);
      directTotals.set(key, previous !== undefined && previous !== null && value !== null ? previous + value : value);
    };
    const visit = (nodes: EffectNode[]): void => {
      for (const node of nodes) {
        if (node.op === 'apply_status') {
          const definition = DynamicStatusManager.getInstance().getStatusDefinition(node.status);
          const key = `${node.target}:${node.status}`;
          const stacks = typeof node.stacks === 'number' ? node.stacks : null;
          const existing = statusTotals.get(key);
          statusTotals.set(key, {
            icon: definition?.emoji || (node.target === 'opponent' ? '🌀' : '✨'),
            value: existing?.value !== null && stacks !== null ? (existing?.value || 0) + stacks : null,
            label: `赋予${node.target === 'opponent' ? '我方' : '自身'}${definition?.name || node.status}`,
          });
        } else if (node.op === 'heal') {
          recordDirect('heal', node.amount);
        } else if (node.op === 'gain_energy') {
          recordDirect('energy', node.amount);
        } else if (node.op === 'draw_cards') {
          recordDirect('draw', node.amount);
        } else if (node.op === 'discard_cards') {
          recordDirect('discard', node.amount);
        } else if (node.op === 'exhaust_cards') {
          recordDirect('exhaust', node.amount);
        } else if (node.op === 'if') {
          try { visit(evaluateConditionExpression(node.condition, executor.getCoreEffectState(false, enemy), { spentEnergy: 0 }) ? node.then : node.else || []); }
          catch { /* Context-dependent effects remain available in full details. */ }
        }
      }
    };
    visit(action.effectProgram.steps);
    for (const status of statusTotals.values()) {
      const value = status.value === null ? '?' : roundBattleDisplayValue(status.value);
      add(status.icon, value, `${status.label}${value === '?' ? '' : `${value}层`}`);
    }

    const directBadgeDefinitions: Record<string, { icon: string; label: string }> = {
      heal: { icon: '💚', label: '回复生命' },
      energy: { icon: '⚡', label: '获得能量' },
      draw: { icon: '🃏', label: '抽牌' },
      discard: { icon: '🗑️', label: '弃牌' },
      exhaust: { icon: '🔥', label: '消耗卡牌' },
    };
    for (const [key, amount] of directTotals) {
      const definition = directBadgeDefinitions[key];
      const value = amount === null ? '?' : roundBattleDisplayValue(amount);
      add(definition.icon, value, `${definition.label}${value === '?' ? '' : value}`);
    }

    if (badges.length === 0) add(this.iconFor(summary.type), '', action.description || action.name || '特殊行动');
    if (badges.length <= 5) return badges;
    return [
      ...badges.slice(0, 5),
      { icon: '＋', value: String(badges.length - 5), label: `另有${badges.length - 5}项效果` },
    ];
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
