import type { CharacterConfig } from '../types';
import { normalizeGameMode } from '../../game-core/towerMode';

/** Build the one compact handoff from the start UI to the AI. */
export function createCharacterStartMessage(config: CharacterConfig): string {
  const mode = normalizeGameMode(config.mode) ?? 'story';
  const profile: Record<string, string> = { mode };
  const fields: Array<[keyof CharacterConfig, string]> = [
    ['name', 'name'],
    ['customDescription', 'appearance'],
    ['world', 'world'],
    ['profession', 'identity'],
    ['opening', 'opening'],
    ['card', 'card'],
    ['towerRequirements', 'tower_requirements'],
  ];
  for (const [source, target] of fields) {
    const value = config[source];
    if (typeof value === 'string' && value.trim()) profile[target] = value.trim();
  }
  const modeMarker = mode === 'tower' ? '[爬塔模式]' : '[剧情模式]';
  return `[角色创建]\n${JSON.stringify(profile)}\n${modeMarker}\n[开始游戏]`;
}
