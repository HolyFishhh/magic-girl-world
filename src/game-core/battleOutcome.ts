export interface BattleOutcomeVitals {
  hp: number;
  lust: number;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Return the exact post-battle persistent vitals, clamped to canonical MUV limits. */
export function settleBattleOutcomeVitals(
  player: { currentHp: unknown; currentLust: unknown },
  core: { max_hp: unknown; max_lust: unknown },
): BattleOutcomeVitals {
  const maxHp = Math.max(1, finiteOr(core.max_hp, 1));
  const maxLust = Math.max(1, finiteOr(core.max_lust, 1));
  return {
    hp: Math.min(maxHp, Math.max(0, finiteOr(player.currentHp, 0))),
    lust: Math.min(maxLust, Math.max(0, finiteOr(player.currentLust, 0))),
  };
}
