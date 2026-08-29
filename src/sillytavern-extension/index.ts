import './style.scss';
import { DesignAssistantController } from './controller';
import type { DesignAssistantHost, MvuHost, SillyTavernContext } from './types';

function globals() {
  return globalThis as typeof globalThis & {
    SillyTavern?: { getContext?(): SillyTavernContext };
    Mvu?: MvuHost;
    toastr?: Record<string, (message: string, title?: string) => void>;
    MagicGirlDesignAssistant?: DesignAssistantController;
  };
}

const browserHost: DesignAssistantHost = {
  context: () => globals().SillyTavern?.getContext?.() || null,
  mvu: () => globals().Mvu || null,
  now: () => Date.now(),
  notify: (level, message, title) => {
    const toast = globals().toastr?.[level];
    if (typeof toast === 'function') toast(message, title);
    else if (level === 'error' || level === 'warning') console.warn(`[${title || '设计辅助器'}] ${message}`);
  },
};

let controller: DesignAssistantController | null = null;

export function activate(): void {
  if (controller) return;
  controller = new DesignAssistantController(browserHost);
  globals().MagicGirlDesignAssistant = controller;
  controller.activate();
}

export function disable(): void {
  controller?.deactivate();
  controller = null;
  delete globals().MagicGirlDesignAssistant;
}

export function getController(): DesignAssistantController | null {
  return controller;
}
