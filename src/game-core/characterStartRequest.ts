import { normalizeGameMode } from './towerMode';

const PROFILE_FIELDS = [
  ['name', 'name'], ['customDescription', 'appearance'], ['world', 'world'],
  ['profession', 'identity'], ['opening', 'opening'], ['card', 'card'],
  ['towerRequirements', 'tower_requirements'],
] as const;
type StartProfile = Partial<Record<typeof PROFILE_FIELDS[number][0], string>> & { mode?: unknown; selectedMechanics?: string };

/** Code-owned UI envelope. Kept shared so deduplication never guesses at user prose. */
export function createCharacterStartMessage(config: StartProfile): string {
  const mode = config.mode == null ? 'story' : normalizeGameMode(config.mode);
  if (!mode) throw new Error('不支持的开局模式，请使用剧情或爬塔模式新开局。');
  const profile: Record<string, string> = { mode };
  for (const [source, target] of PROFILE_FIELDS) {
    const value = config[source];
    if (typeof value === 'string' && value.trim()) profile[target] = value.trim();
  }
  if (typeof config.selectedMechanics === 'string' && config.selectedMechanics.trim()) profile.selected_mechanics = config.selectedMechanics.trim();
  const marker = mode === 'tower' ? '[爬塔模式]' : '[剧情模式]';
  return `[角色创建]\n${JSON.stringify(profile)}\n${marker}\n[开始游戏]`;
}

/** Only the exact current tower UI envelope is redundant with the full config. */
export function isCanonicalTowerStartRequest(request: string, config: Record<string, string>): boolean {
  return config.mode === 'tower' && request === createCharacterStartMessage(config);
}
