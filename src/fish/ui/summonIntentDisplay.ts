import { resolvePlannedSummonAction, roundBattleDisplayValue, type EffectNode, type GameState, type SummonUnit } from '../../game-core';
import { UnifiedEffectExecutor } from '../combat/unifiedEffectExecutor';

export interface SummonIntentBadge {
  icon: string;
  value: string;
  label: string;
}

/**
 * Pure compact projection for a summon action. It reads the already-modified
 * runtime action program and deliberately refuses to predict conditional or
 * random branches as a definite next action.
 */
export function summonIntentBadges(unit: Pick<SummonUnit, 'actions' | 'actionProgram' | 'actionsPerActivation' | 'capabilities' | 'modifiers' | 'statusEffects' | 'plannedActionIds' | 'templateId' | 'name' | 'emoji' | 'description'>,
  _state: Pick<GameState, 'player' | 'enemies'>): SummonIntentBadge[] {
  if (unit.capabilities?.acts === false) return [{ icon: '⏸️', value: '', label: '该召唤物不能行动' }];
  const actions = unit.actions?.length
    ? unit.actions.map(action => action.effectProgram)
    : unit.actionProgram ? [unit.actionProgram] : [];
  const count = Math.max(0, Math.trunc(unit.actionsPerActivation ?? 1));
  if (!actions.length || count === 0) return [{ icon: '？', value: '', label: '本次激活没有可执行行动' }];
  const planned = resolvePlannedSummonAction(unit as SummonUnit, 0);
  if (!planned) return [{ icon: '？', value: '?', label: '下次行动尚未计划；具体效果见详情' }];
  const badges: SummonIntentBadge[] = [];
  const add = (icon: string, value: number | '?', label: string) => badges.push({
    icon, value: value === '?' ? '?' : String(roundBattleDisplayValue(value)), label,
  });
  const amount = (value: unknown): number | null => {
    if (typeof value === 'number') return value;
    try { return UnifiedEffectExecutor.getInstance().previewSummonActionAmount(unit as SummonUnit, value as never); }
    catch { return null; }
  };
  const visit = (nodes: readonly EffectNode[]): boolean => {
    for (const node of nodes) {
      if (node.op === 'if' || node.op === 'choose_one' || 'targetSelector' in node && node.targetSelector) return false;
      if (node.op === 'damage') {
        const value = amount(node.amount); if (value === null) return false;
        add('⚔️', value, `按当前状态造成${roundBattleDisplayValue(value)}点伤害（单次行动）`);
      } else if (node.op === 'gain_block') {
        const value = amount(node.amount); if (value === null) return false;
        add('🛡️', value, `按当前状态获得${roundBattleDisplayValue(value)}点格挡（单次行动）`);
      } else if (node.op === 'heal') {
        const value = amount(node.amount); if (value === null) return false;
        add('💚', value, `按当前状态回复${roundBattleDisplayValue(value)}点生命（单次行动）`);
      } else return false;
    }
    return true;
  };
  if (!visit(planned.effectProgram.steps)) return [{ icon: '？', value: '?', label: `下次行动「${planned.name}」含条件、随机或公式；当前数值会在执行时按状态计算${count > 1 ? `（每次激活行动${count}次）` : ''}` }];
  if (count > 1) badges.unshift({ icon: '🔁', value: String(count), label: `每次激活行动${count}次；下列数值为单次行动` });
  return badges.length ? badges : [{ icon: '？', value: '', label: '行动效果见详情' }];
}
