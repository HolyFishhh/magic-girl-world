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
  };
  const name = config.name?.trim();
  if (name) profile.name = name;
  if (config.faction) profile.faction = FACTION_NAMES[config.faction];
  const profession = config.profession?.trim();
  if (profession) profile.profession = profession;
  const startingLocation = config.startingLocation?.trim();
  if (startingLocation) profile.location = startingLocation;
  const character = config.customDescription?.trim();
  if (character) profile.note = character;
  const optionalFields: Array<[keyof CharacterConfig, string]> = [
    ['world', 'world'],
    ['theme', 'theme'],
    ['plot', 'plot'],
    ['tone', 'tone'],
    ['style', 'style'],
    ['pace', 'pace'],
    ['card', 'card'],
    ['mechanics', 'mechanics'],
    ['limits', 'limits'],
    ['note', 'note'],
    ['extra', 'extra'],
  ];
  for (const [source, target] of optionalFields) {
    const value = config[source];
    if (typeof value === 'string' && value.trim()) profile[target] = value.trim();
  }
  const modeMarker = config.mode === 'expedition' ? '[爬塔模式]' : '[剧情模式]';
  return `[角色创建]\n${JSON.stringify(profile)}\n${modeMarker}\n[开始游戏]`;
}
