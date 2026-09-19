import { readGameModeLock, type GameMode } from '../../game-core/towerMode';

/** Only the explicit new-character start may project the shared MVU template. */
export function prepareModeInitialVariables(stat: Record<string, any>, mode: GameMode): void {
  if (readGameModeLock(stat) || stat.run || (Array.isArray(stat.battle?.cards) && stat.battle.cards.some((v: unknown) => v && typeof v === 'object' && !Array.isArray(v)))) return;
  const status = stat.status ||= {};
  if (mode === 'tower') {
    stat.status = { ...(status.$meta ? { $meta: status.$meta } : {}), time: status.time || '', location: status.location || '', profession: status.profession || { name: '', ability: '' } };
    delete stat.npcs;
    delete stat.factions;
  } else {
    status.clothing ??= { $meta: { extensible: false }, head: '', neck: '', hands: '', upper_body: '', lower_body: '', underwear: '', legs: '', feet: '' };
    status.inventory ??= ['$__META_EXTENSIBLE__$'];
    status.permanent_status ??= ['$__META_EXTENSIBLE__$'];
    status.temporary_status ??= ['$__META_EXTENSIBLE__$'];
    stat.npcs ??= { $meta: { extensible: true } };
    stat.factions ??= { $meta: { extensible: false }, player_alignment: '绝对中立', invasion: 0, relations: ['$__META_EXTENSIBLE__$'] };
  }
}
