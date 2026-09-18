/** Initial generation replaces authored player content; omission is not inheritance. */
export function buildInitialPlayerBattle(previous: Record<string, any>, player: Record<string, any>): Record<string, any> {
  const copy = (value: any) => structuredClone(value);
  const list = (key: string) => Array.isArray(player[key]) ? copy(player[key]) : [];
  const result = {
    ...copy(previous), ...copy(player),
    core: player.core && typeof player.core === 'object' && !Array.isArray(player.core) ? copy(player.core) : {},
    cards: list('cards'), artifacts: list('artifacts'), items: list('items'), statuses: list('statuses'),
    player_abilities: list('player_abilities'), player_status_effects: list('player_status_effects'),
    level: Number.isInteger(Number(player.level)) ? Number(player.level) : 1,
    exp: Number.isInteger(Number(player.exp)) && Number(player.exp) >= 0 ? Number(player.exp) : 0,
    enemy: null, enemies: [],
  };
  // Normalization can remove an undefined optional property between attempts.
  // Never resurrect the template's empty shell (or a previous build's effect).
  if (player.player_lust_effect === undefined) delete result.player_lust_effect;
  return result;
}
