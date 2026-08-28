type RuntimeViewName = 'start' | 'common' | 'fish' | 'update';

type RuntimeViewAsset = Readonly<{
  title: string;
  bodyHtml: string;
  styles: string;
  script: string;
}>;

type SharedRuntime = Readonly<{
  spec: 'mwg.tavern-runtime/v1';
  version: string;
  getViewAsset(view: RuntimeViewName): RuntimeViewAsset;
}>;

declare const __MWG_VIEW_NAME__: RuntimeViewName;
declare const __MWG_CARD_VERSION__: string;
declare function waitGlobalInitialized<T>(global: string): Promise<T>;

(() => {
  const view = __MWG_VIEW_NAME__;
  const expectedVersion = __MWG_CARD_VERSION__;
  const timeoutMs = 15000;

  const currentMessageId = (): number | null => {
    const helper = globalThis as typeof globalThis & { getCurrentMessageId?: () => unknown };
    if (typeof helper.getCurrentMessageId !== 'function') return null;
    try {
      const messageId = Number(helper.getCurrentMessageId());
      return Number.isInteger(messageId) ? messageId : null;
    } catch {
      return null;
    }
  };

  const lastMessageId = (): number | null => {
    const helper = globalThis as typeof globalThis & { getLastMessageId?: () => unknown };
    if (typeof helper.getLastMessageId !== 'function') return null;
    try {
      const messageId = Number(helper.getLastMessageId());
      return Number.isInteger(messageId) ? messageId : null;
    } catch {
      return null;
    }
  };

  // The creator is a one-time first-floor handoff. Keeping this gate in the
  // shell means a repeated marker in later AI text cannot recreate the form.
  const isViewAllowedOnThisFloor = (): boolean => {
    const messageId = currentMessageId();
    if (view === 'start') return messageId === null || messageId === 0;
    const latestMessageId = lastMessageId();
    if (messageId === null || latestMessageId === null) return true;
    if (view === 'fish') return messageId === latestMessageId;
    return [0, 1, 2].indexOf(latestMessageId - messageId) !== -1;
  };

  if (!isViewAllowedOnThisFloor()) {
    document.body.replaceChildren();
    document.body.dataset.mwgSkipped = view === 'start' ? 'initial-only' : view === 'fish' ? 'latest-only' : 'recent-only';
    return;
  }

  if (document.documentElement.dataset.mwgMountedView === view) return;
  document.documentElement.dataset.mwgMountedView = view;

  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    document.body.replaceChildren();
    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.style.cssText =
      'padding:10px;border:1px solid #b42318;border-radius:6px;background:#fff5f5;color:#b42318;font:13px/1.5 sans-serif;';
    alert.textContent = `魔法少女世界界面加载失败：${message}`;
    document.body.appendChild(alert);
  };

  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error('等待角色运行时超时，请确认角色脚本已启用')), timeoutMs);
  });

  const sharedRuntime =
    typeof waitGlobalInitialized === 'function'
      ? waitGlobalInitialized<SharedRuntime>('MagicGirlWorld')
      : Promise.reject(new Error('酒馆助手分享接口 waitGlobalInitialized 不可用'));

  Promise.race([Promise.resolve(sharedRuntime), timeout])
    .then(runtime => {
      const api = runtime || (globalThis as any).MagicGirlWorld;
      if (!api || api.spec !== 'mwg.tavern-runtime/v1') throw new Error('角色运行时接口无效');
      if (api.version !== expectedVersion) {
        throw new Error(`角色运行时版本不匹配（需要 ${expectedVersion}，实际 ${String(api.version)}）`);
      }
      (globalThis as any).MagicGirlWorld = api;

      const asset = api.getViewAsset(view);
      if (!asset?.bodyHtml || !asset?.styles || !asset?.script) throw new Error(`视图资源不完整: ${view}`);

      document.title = asset.title;
      const style = document.createElement('style');
      style.dataset.mwgRuntimeStyle = view;
      style.textContent = asset.styles;
      document.head.appendChild(style);

      document.body.innerHTML = asset.bodyHtml;

      document.documentElement.dataset.mwgRuntime = expectedVersion;
      document.documentElement.dataset.mwgView = view;
      const script = document.createElement('script');
      script.dataset.mwgRuntimeScript = view;
      script.textContent = asset.script;
      document.body.appendChild(script);
    })
    .catch(fail);
})();
