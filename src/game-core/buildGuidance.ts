import type { BuildBudget, ContentDefinition, ContentPack } from './contentPack';
import { analyzeContentScenarios } from './contentAnalysis';

export type BuildNeed = '输出' | '防御' | '恢复' | '抽牌' | '能量' | '牌序';

export interface BuildGuidance {
  need: BuildNeed;
  synergy: string | null;
  roles: [string, string, string];
}

function roleLabel(role: string, detail?: string | null): string {
  return detail ? `${role}(${detail})` : role;
}

function hasDynamicEffect(pack: ContentPack, keys: readonly string[]): boolean {
  return pack.cards.some(card => {
    const analysis = analyzeContentScenarios(card);
    return keys.some(key => {
      const metric = key === 'damage' || key === 'lust' || key === 'lust_damage' ? 'attack' : key;
      return analysis.dynamicMetrics.has(metric as keyof typeof analysis.metrics);
    });
  });
}

function recommendNeed(pack: ContentPack, budget: BuildBudget): BuildNeed {
  const hpRatio = budget.maxHp > 0 ? budget.hp / budget.maxHp : 1;
  if (hpRatio < 0.55 && budget.sustain <= 0 && !hasDynamicEffect(pack, ['heal'])) return '恢复';
  if (budget.attack < 12 && !hasDynamicEffect(pack, ['damage', 'lust', 'lust_damage'])) return '输出';
  if (
    budget.defense < Math.max(6, Math.round(budget.attack * 0.45)) &&
    !hasDynamicEffect(pack, ['block'])
  ) {
    return '防御';
  }
  if (budget.draw < 1 && !hasDynamicEffect(pack, ['draw'])) return '抽牌';
  if (budget.deck >= 14 && budget.energy < 1 && !hasDynamicEffect(pack, ['energy', 'reduce_cost'])) return '能量';
  return '牌序';
}

function scoreDefinition(scores: Map<string, number>, definition: ContentDefinition, quantity = 1): void {
  const add = (key: string, multiplier = 1): void => {
    scores.set(key, (scores.get(key) || 0) + Math.max(1, quantity) * multiplier);
  };
  const analysis = analyzeContentScenarios(definition);
  for (const tag of analysis.tags) {
    const multiplier = ['X费', '弃牌', '生成牌', '欲望'].includes(tag) || tag.startsWith('状态:') ? 2 : 1;
    add(tag, multiplier);
  }
  for (const statusId of analysis.statusIds) add(`状态:${statusId}`, 2);
}

function strongestSynergy(pack: ContentPack): string | null {
  const scores = new Map<string, number>();
  for (const card of pack.cards) {
    const quantity = Number.isInteger(card.quantity) && card.quantity > 0 ? Math.min(20, card.quantity) : 1;
    scoreDefinition(scores, card, quantity);
  }
  pack.relics.forEach(definition => scoreDefinition(scores, definition));
  pack.abilities.forEach(definition => scoreDefinition(scores, definition));
  let best: { name: string; score: number } | null = null;
  for (const [name, score] of scores) {
    if (score < 2) continue;
    if (!best || score > best.score || (score === best.score && name < best.name)) {
      best = { name, score };
    }
  }
  return best?.name ?? null;
}

/** Give the generator one short, program-computed deck direction instead of another analysis task. */
export function recommendBuildGuidance(pack: ContentPack, budget: BuildBudget): BuildGuidance {
  const synergy = strongestSynergy(pack);
  const need = recommendNeed(pack, budget);
  return {
    need,
    synergy,
    roles: [roleLabel('补短板', need), roleLabel(synergy ? '强联动' : '立主轴', synergy), '转方向'],
  };
}

export function formatBuildGuidance(guidance: BuildGuidance): string {
  return [
    `need=${guidance.need}`,
    ...(guidance.synergy ? [`synergy=${guidance.synergy}`] : []),
    `roles=${guidance.roles.join(',')}`,
  ].join(' ');
}
