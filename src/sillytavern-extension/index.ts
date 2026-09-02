import './style.scss';
import { DesignAssistantController } from './controller';
import { getSillyTavernContext, initializeSillyTavernHost } from './sillyTavernHost';
import { createGlobalTowerGenerationPorts } from './towerGenerationHost';
import { activateRuntimeFrameHeightBridge } from './runtimeFrameHeightBridge';
import { activateRuntimeFullscreenBridge } from './runtimeFullscreenBridge';
import type { DesignAssistantHost, MvuHost } from './types';

function globals() {
  return globalThis as typeof globalThis & {
    Mvu?: MvuHost;
    toastr?: Record<string, (message: string, title?: string) => void>;
    MagicGirlDesignAssistant?: DesignAssistantController;
    MagicGirlDesignAssistantBootstrap?: {
      phase: 'loading' | 'ready' | 'error' | 'disabled';
      message: string;
      updatedAt: number;
    };
  };
}

function setBootstrapStatus(
  phase: 'loading' | 'ready' | 'error' | 'disabled',
  message: string,
): void {
  globals().MagicGirlDesignAssistantBootstrap = { phase, message, updatedAt: Date.now() };
}

setBootstrapStatus('loading', '正在连接 SillyTavern 官方扩展接口');

const browserHost: DesignAssistantHost = {
  context: getSillyTavernContext,
  mvu: () => globals().Mvu || null,
  now: () => Date.now(),
  notify: (level, message, title) => {
    const toast = globals().toastr?.[level];
    if (typeof toast === 'function') toast(message, title);
    else if (level === 'error' || level === 'warning') console.warn(`[${title || '设计辅助器'}] ${message}`);
  },
};

let controller: DesignAssistantController | null = null;
let activationPromise: Promise<void> | null = null;
let activationGeneration = 0;
let deactivateRuntimeFrameHeightBridge: (() => void) | null = null;
let deactivateRuntimeFullscreenBridge: (() => void) | null = null;

export function activate(): Promise<void> {
  if (controller) return Promise.resolve();
  if (activationPromise) return activationPromise;
  const generation = activationGeneration;
  activationPromise = (async () => {
    await initializeSillyTavernHost();
    if (controller || generation !== activationGeneration) return;
    const next = new DesignAssistantController(
      browserHost,
      undefined,
      createGlobalTowerGenerationPorts(),
    );
    controller = next;
    globals().MagicGirlDesignAssistant = next;
    next.activate();
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      deactivateRuntimeFrameHeightBridge ||= activateRuntimeFrameHeightBridge(
        window,
        document,
        getSillyTavernContext()?.eventSource,
        () => (globalThis as Record<string, any>).TavernHelper,
      );
      deactivateRuntimeFullscreenBridge ||= activateRuntimeFullscreenBridge(
        window,
        document,
        getSillyTavernContext,
        getSillyTavernContext()?.eventSource,
      );
    }
    setBootstrapStatus('ready', '设计辅助器已启动');
  })().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    setBootstrapStatus('error', message);
    console.error('[MagicGirlDesignAssistant] 启动失败', error);
    browserHost.notify('error', message, '设计辅助器启动失败');
  }).finally(() => {
    activationPromise = null;
  });
  return activationPromise;
}

export function disable(): void {
  activationGeneration += 1;
  controller?.deactivate();
  controller = null;
  deactivateRuntimeFrameHeightBridge?.();
  deactivateRuntimeFrameHeightBridge = null;
  deactivateRuntimeFullscreenBridge?.();
  deactivateRuntimeFullscreenBridge = null;
  delete globals().MagicGirlDesignAssistant;
  setBootstrapStatus('disabled', '设计辅助器已停用');
}

export function getController(): DesignAssistantController | null {
  return controller;
}

// SillyTavern 1.18 loads third-party extension entry modules directly. The
// optional manifest lifecycle hooks are not invoked by every installation, so
// the browser entry must also activate itself. `activate()` is idempotent and
// remains exported for hosts that do support lifecycle hooks and for tests.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const activateWhenReady = (): void => { void activate(); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateWhenReady, { once: true });
  } else {
    globalThis.queueMicrotask(activateWhenReady);
  }
}
