import type { SillyTavernContext } from './types';

type SillyTavernExtensionModule = {
  getContext?: () => SillyTavernContext;
};

type ExtensionModuleImporter = () => Promise<SillyTavernExtensionModule>;

const SILLY_TAVERN_EXTENSION_API = '../../../extensions.js';

let officialGetContext: (() => SillyTavernContext) | null = null;
let officialApiPromise: Promise<void> | null = null;

function legacyGlobalContext(): SillyTavernContext | null {
  const root = globalThis as typeof globalThis & {
    SillyTavern?: { getContext?: () => SillyTavernContext };
  };
  return root.SillyTavern?.getContext?.() || null;
}

/**
 * SillyTavern 1.18 exposes extension APIs as ES-module exports rather than a
 * `window.SillyTavern` global. Keep the old global as a compatibility and test
 * seam, but use the official module for normal browser installations.
 */
export function getSillyTavernContext(): SillyTavernContext | null {
  return legacyGlobalContext() || officialGetContext?.() || null;
}

export async function initializeSillyTavernHost(
  importer: ExtensionModuleImporter = () => import(
    /* webpackIgnore: true */ SILLY_TAVERN_EXTENSION_API
  ) as Promise<SillyTavernExtensionModule>,
): Promise<void> {
  if (getSillyTavernContext()) return;
  if (officialApiPromise) return officialApiPromise;
  officialApiPromise = (async () => {
    const module = await importer();
    if (typeof module?.getContext !== 'function') {
      throw new Error('SillyTavern 官方扩展接口缺少 getContext');
    }
    officialGetContext = module.getContext;
    if (!getSillyTavernContext()) {
      throw new Error('SillyTavern 扩展上下文尚未就绪');
    }
  })().catch(error => {
    officialApiPromise = null;
    throw error;
  });
  return officialApiPromise;
}

export function resetSillyTavernHostForTests(): void {
  officialGetContext = null;
  officialApiPromise = null;
}
