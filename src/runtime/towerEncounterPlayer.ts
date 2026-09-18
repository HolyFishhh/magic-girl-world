/** The next encounter starts from persistent content, never the preceding fight's
 * temporary buffs or a stale MVU copy of live HP. Node-authored entry effects are
 * merged separately by prepareTowerBattleForActivation after this projection.
 */
export function towerEncounterPlayerReference(battle: Record<string, any>): Record<string, any> {
  const result = structuredClone(battle);
  delete result.enemy; delete result.enemies;
  result.player_abilities = [];
  result.player_status_effects = [];
  result.core = { ...result.core, hp: result.core?.max_hp ?? 80, lust: 0 };
  return result;
}
