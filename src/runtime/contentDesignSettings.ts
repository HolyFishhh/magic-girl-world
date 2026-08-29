import { normalizeDifficultyPercent } from '../game-core';

export const CONTENT_DESIGN_SETTINGS_STORAGE_KEY = 'mwg:settings-center:v2';

export interface RuntimeContentDesignSettings {
  difficultyPercent: number;
  autoCalibration: boolean;
}

/** The optional top-window extension owns deep simulation when enabled. */
export function isExternalDesignAssistantActive(scope: typeof globalThis = globalThis): boolean {
  try {
    const parentScope = (scope as any).parent;
    const root = (parentScope && parentScope !== scope ? parentScope : scope) as typeof globalThis & {
      MagicGirlDesignAssistant?: { getSettings?(): { enabled?: boolean } };
    };
    return root.MagicGirlDesignAssistant?.getSettings?.().enabled === true;
  } catch {
    return false;
  }
}

export function readRuntimeContentDesignSettings(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): RuntimeContentDesignSettings {
  try {
    const value = JSON.parse(String(storage?.getItem(CONTENT_DESIGN_SETTINGS_STORAGE_KEY) || '{}'));
    return {
      difficultyPercent: normalizeDifficultyPercent(value?.difficultyPercent),
      autoCalibration: value?.autoCalibration !== false,
    };
  } catch {
    return { difficultyPercent: 80, autoCalibration: true };
  }
}
