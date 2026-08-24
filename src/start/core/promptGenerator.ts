import type { CharacterConfig, Faction } from '../types';

const FACTION_NAMES: Record<Faction, string> = {
  magical_girl: '魔法少女',
  ordinary_people: '普通人',
  evil_forces: '邪恶势力',
};

/** Build the one compact handoff from the start UI to the AI. */
export function createCharacterStartMessage(config: CharacterConfig): string {
  const profile: Record<string, string> = {
    mode: config.mode,
    name: config.name || '{{user}}',
    faction: FACTION_NAMES[config.faction],
    ordinary: config.ordinaryIdentity.name,
    city: config.city.name,
    location: config.location.name,
  };
  if (config.supernaturalIdentity) profile.supernatural = config.supernaturalIdentity.name;
  const note = config.customDescription?.trim();
  if (note) profile.note = note;
  const modeMarker = config.mode === 'expedition' ? '[远征模式]' : '[剧情模式]';
  return `[角色创建]\n${JSON.stringify(profile)}\n${modeMarker}\n[开始游戏]`;
}
