// 魔法少女世界角色创建系统主程序。此入口直接使用酒馆助手全局 API，
// 不加载 common/fish 的 jQuery 运行时，避免角色创建 HTML 无谓膨胀。
import { CharacterCreator } from './core/characterCreator';
import { ensureRuntimeFrameHeightSync } from '../runtime/runtimeFrameHeight';
import './index.scss';

ensureRuntimeFrameHeightSync()?.request();

function installTowerExtensionCheck(): void {
  const root = document.querySelector<HTMLElement>('[data-tower-extension-check]');
  const button = root?.querySelector<HTMLButtonElement>('[data-action="install-tower-extension"]');
  const title = root?.querySelector<HTMLElement>('[data-tower-extension-title]');
  const detail = root?.querySelector<HTMLElement>('[data-tower-extension-detail]');
  if (!root || !button) return;
  let checks = 0;
  let checking = false;
  let installMode: 'install' | 'update' = 'install';
  let timer: number | undefined;
  const stopPolling = (): void => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };
  const refresh = async (force = false): Promise<boolean> => {
    if (checking) return false;
    checking = true;
    checks += 1;
    const runtime = (globalThis as any).MagicGirlWorld;
    const capabilities = runtime?.getDesignAssistantCapabilities?.();
    const localReady = capabilities?.towerGeneration === true
      && capabilities?.towerCoordinator === true
      && capabilities?.singleFloorStart === true;
    if (!runtime) {
      checking = false;
      return checks >= 20;
    }
    try {
      const version = typeof runtime.checkTowerExtensionVersion === 'function'
        ? await runtime.checkTowerExtensionVersion(force)
        : null;
      const current = localReady && (!version || ['current', 'newer', 'unknown'].includes(version.status));
      root.hidden = current;
      if (current) return true;
      installMode = version?.status === 'outdated' || Boolean(capabilities?.version) ? 'update' : 'install';
      if (title) title.textContent = installMode === 'update' ? '爬塔组件需要更新' : '爬塔组件尚未安装';
      if (detail) {
        detail.textContent = version?.message
          || '剧情模式可以直接游玩；选择爬塔模式前请先安装角色卡专属组件。';
      }
      button.textContent = installMode === 'update' ? '更新到最新版' : '快捷安装';
      return checks >= 20;
    } catch (error) {
      root.hidden = localReady;
      if (!localReady && detail) {
        detail.textContent = error instanceof Error ? error.message : '插件版本检查失败，请刷新后重试。';
      }
      return localReady || checks >= 20;
    } finally {
      checking = false;
    }
  };
  void refresh().then(done => {
    if (done) return;
    timer = window.setInterval(() => {
      void refresh().then(finished => {
        if (finished) stopPolling();
      });
    }, 500);
  });
  button.addEventListener('click', () => {
    const runtime = (globalThis as any).MagicGirlWorld;
    if (typeof runtime?.installTowerExtension !== 'function') {
      if (detail) detail.textContent = '酒馆安装器尚未就绪，请刷新页面后重试。';
      return;
    }
    button.disabled = true;
    button.textContent = installMode === 'update' ? '正在更新组件…' : '正在打开酒馆安装器…';
    void Promise.resolve(runtime.installTowerExtension())
      .then((installed: boolean) => {
        button.textContent = installed
          ? `${installMode === 'update' ? '更新' : '安装'}完成，请刷新酒馆`
          : `${installMode === 'update' ? '更新' : '安装'}已取消`;
        button.disabled = installed;
        if (detail && installed) detail.textContent = '组件文件已经准备好，刷新酒馆后会加载最新版。';
        if (!installed) button.disabled = false;
      })
      .catch((error: unknown) => {
        button.disabled = false;
        button.textContent = installMode === 'update' ? '重新尝试更新' : '重新尝试安装';
        if (detail) detail.textContent = error instanceof Error ? error.message : '快捷安装失败，请稍后重试。';
      });
  });
}

// 启动系统
const initializeCharacterCreator = () => {
  try {
    // 检查基础环境
    if (typeof document === 'undefined') {
      console.error('❌ 文档对象未找到');
      return;
    }

    // 创建角色创建器实例
    new CharacterCreator();
    installTowerExtensionCheck();

  } catch (error) {
    console.error('❌ 角色创建系统初始化失败:', error);
  }
};

// 根据环境进行初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeCharacterCreator);
} else {
  initializeCharacterCreator();
}
