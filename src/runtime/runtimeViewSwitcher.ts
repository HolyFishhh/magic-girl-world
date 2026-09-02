export type MagicGirlRuntimeView = 'start' | 'common' | 'fish' | 'update';

import { ensureRuntimeFrameHeightSync } from './runtimeFrameHeight';

type RuntimeViewAsset = Readonly<{
  title: string;
  bodyHtml: string;
  styles: string;
  script: string;
}>;

type SharedRuntime = Readonly<{
  spec: 'mwg.tavern-runtime/v1';
  version: string;
  getViewAsset(view: MagicGirlRuntimeView): RuntimeViewAsset;
}>;

type ViewLifecycle = {
  view: MagicGirlRuntimeView;
  destroy: () => void;
  switching: boolean;
};

const LIFECYCLE_KEY = '__MWG_ACTIVE_VIEW_LIFECYCLE__';

function isolatedRuntimeScript(source: string): string {
  // Removing a script element does not remove its top-level lexical bindings
  // from the iframe. Common and fish are independent webpack bundles and may
  // reuse minified `let`/`const` names, so every dynamically mounted bundle
  // needs its own function scope.
  return `(() => {\n${source}\n})();`;
}

function lifecycleHost(): typeof globalThis & Record<string, any> {
  return globalThis as typeof globalThis & Record<string, any>;
}

function sharedRuntime(): SharedRuntime {
  const runtime = lifecycleHost().MagicGirlWorld as SharedRuntime | undefined;
  if (!runtime || runtime.spec !== 'mwg.tavern-runtime/v1' || typeof runtime.getViewAsset !== 'function') {
    throw new Error('角色运行时尚未准备好，无法切换游戏页面');
  }
  return runtime;
}

/**
 * Register the teardown owned by the currently mounted self-contained view.
 * The registry lives on globalThis because common and fish are separate
 * webpack bundles even when tower mode mounts both in one message iframe.
 */
export function registerRuntimeViewLifecycle(view: MagicGirlRuntimeView, destroy: () => void): () => void {
  const host = lifecycleHost();
  const existing = host[LIFECYCLE_KEY] as ViewLifecycle | undefined;
  if (existing && existing.destroy !== destroy && !existing.switching) existing.destroy();

  const eventHost = typeof window === 'undefined' ? null : window;
  let lifecycle: ViewLifecycle;
  let destroyed = false;
  const unregister = () => {
    eventHost?.removeEventListener('pagehide', handlePageHide);
    if (host[LIFECYCLE_KEY] === lifecycle) delete host[LIFECYCLE_KEY];
  };
  const managedDestroy = () => {
    if (destroyed) return;
    destroyed = true;
    // Detach the global ownership before running view cleanup. This prevents a
    // late pagehide or a re-entrant registration from retaining the old bundle.
    unregister();
    destroy();
  };
  const handlePageHide = () => managedDestroy();
  lifecycle = { view, destroy: managedDestroy, switching: false };
  host[LIFECYCLE_KEY] = lifecycle;
  eventHost?.addEventListener('pagehide', handlePageHide, { once: true });
  return unregister;
}

/**
 * Swap between the already exported common/fish assets inside the same latest
 * Tavern message iframe. No chat floor is created and both views keep using
 * the existing MVU/message-variable adapters and one battle implementation.
 */
export function switchRuntimeView(view: MagicGirlRuntimeView): void {
  if (typeof document === 'undefined') throw new Error('当前环境不能切换游戏页面');
  const host = lifecycleHost();
  const current = host[LIFECYCLE_KEY] as ViewLifecycle | undefined;
  if (current?.switching) return;
  if (current?.view === view && document.documentElement.dataset.mwgView === view) return;

  const runtime = sharedRuntime();
  const asset = runtime.getViewAsset(view);
  // Keep the script that owns the current event callback attached until the
  // replacement bundle has executed. Tavern Helper's sandboxed message iframe
  // can otherwise suppress the next large inline bundle, leaving only the new
  // DOM mounted and the battle page stuck on its restoring placeholder.
  const previousScripts = [...document.querySelectorAll('[data-mwg-runtime-script]')];
  if (!asset?.bodyHtml || !asset?.styles || !asset?.script) throw new Error(`视图资源不完整: ${view}`);

  if (current) {
    current.switching = true;
    try {
      current.destroy();
    } finally {
      if (host[LIFECYCLE_KEY] === current) delete host[LIFECYCLE_KEY];
    }
  }

  document.querySelectorAll('[data-mwg-runtime-style]').forEach(node => node.remove());

  document.title = asset.title;
  const style = document.createElement('style');
  style.dataset.mwgRuntimeStyle = view;
  style.textContent = asset.styles;
  document.head.appendChild(style);
  document.body.innerHTML = asset.bodyHtml;
  document.body.style.overflow = '';

  document.documentElement.dataset.mwgMountedView = view;
  document.documentElement.dataset.mwgView = view;
  const script = document.createElement('script');
  script.dataset.mwgRuntimeScript = view;
  script.textContent = isolatedRuntimeScript(asset.script);
  document.body.appendChild(script);
  previousScripts.forEach(node => node.remove());
  ensureRuntimeFrameHeightSync()?.request();
}

export function currentRuntimeView(): MagicGirlRuntimeView | null {
  if (typeof document === 'undefined') return null;
  const value = document.documentElement?.dataset?.mwgView;
  return value === 'start' || value === 'common' || value === 'fish' || value === 'update' ? value : null;
}
