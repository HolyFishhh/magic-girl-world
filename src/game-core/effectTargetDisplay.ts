import type { EnemyTargetSelector } from './combatantCollection';

export const describeEffectTarget = (
  target: 'self' | 'opponent',
  context: { selfLabel?: string; opponentLabel?: string },
  selector?: EnemyTargetSelector,
): string => {
  const team = selector?.team;
  const side = team === 'self' ? (context.selfLabel || '我方') : team === 'opponent' ? (context.opponentLabel || '敌方') : '敌方';
  if (target === 'self' && !selector) return context.selfLabel || '自身';
  if (!selector || selector.mode === 'active') return side;
  const mixed = team === 'self' || team === 'opponent';
  if (selector.mode === 'all') return mixed ? `所有${side}实体` : '所有敌方';
  if (selector.mode === 'random') return mixed ? `随机${side}实体（含本体与召唤物）` : '随机敌方';
  if (selector.mode === 'random_n') return mixed
    ? `随机${side}实体（${selector.count}次${selector.allowRepeat ? '，可重复' : ''}；含本体与召唤物）`
    : `随机敌方（${selector.count}次${selector.allowRepeat ? '，可重复' : ''}）`;
  if (selector.mode === 'lowest_hp') return mixed ? `生命最低的${side}实体` : '生命最低的敌方';
  if (selector.mode === 'highest_hp') return mixed ? `生命最高的${side}实体` : '生命最高的敌方';
  return mixed ? `指定${side}实体` : '指定敌方';
};
