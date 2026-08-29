import { DESIGN_ASSISTANT_CARD_SCOPE, type SillyTavernContext } from './types';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function currentCharacter(context: SillyTavernContext | null): Record<string, any> | null {
  if (!context || context.groupId !== null && context.groupId !== undefined) return null;
  const index = Number(context.characterId);
  if (!Number.isInteger(index) || index < 0 || !Array.isArray(context.characters)) return null;
  return isRecord(context.characters[index]) ? context.characters[index] : null;
}

/**
 * Hard scope boundary for the top-window extension. A compatible MVU shape is
 * not enough: only a character card explicitly stamped by our build pipeline
 * may receive design context or programmatic enemy calibration.
 */
export function isMagicGirlWorldCharacter(context: SillyTavernContext | null): boolean {
  const character = currentCharacter(context);
  if (!character) return false;
  const extensions = isRecord(character.data?.extensions)
    ? character.data.extensions
    : isRecord(character.extensions)
      ? character.extensions
      : null;
  const marker = isRecord(extensions?.magic_girl_world) ? extensions.magic_girl_world : null;
  return marker?.design_assistant_scope === DESIGN_ASSISTANT_CARD_SCOPE;
}
