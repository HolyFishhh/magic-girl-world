import { roundBattleValue } from './battleMath';

export interface BattleOutcomeVitals {
  hp: number;
  lust: number;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Round health only at settlement; combat itself retains its calculation precision. */
export function settleBattleOutcomeVitals(
  player: { currentHp: unknown; currentLust: unknown },
  core: { max_hp: unknown; max_lust: unknown },
): BattleOutcomeVitals {
  const maxHp = Math.max(1, finiteOr(core.max_hp, 1));
  const maxLust = Math.max(1, finiteOr(core.max_lust, 1));
  return {
    hp: Math.min(Math.floor(maxHp), Math.round(Math.max(0, finiteOr(player.currentHp, 0)))),
    lust: roundBattleValue(Math.min(maxLust, Math.max(0, finiteOr(player.currentLust, 0)))),
  };
}
