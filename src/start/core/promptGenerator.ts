import type { CharacterConfig } from '../types';

/** Build the one compact handoff from the start UI to the AI. */
export function createCharacterStartMessage(config: CharacterConfig): string {
  const profile: Record<string, string> = { mode: config.mode };
  const fields: Array<[keyof CharacterConfig, string]> = [
    ['name', 'name'],
    ['customDescription', 'appearance'],
    ['world', 'world'],
    ['profession', 'identity'],
    ['opening', 'opening'],
    ['card', 'card'],
  ];
  for (const [source, target] of fields) {
    const value = config[source];
    if (typeof value === 'string' && value.trim()) profile[target] = value.trim();
  }
  return `[角色创建]\n${JSON.stringify(profile)}\n[剧情模式]\n[开始游戏]`;
}
