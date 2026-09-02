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
  const refresh = (): boolean => {
    checks += 1;
    const runtime = (globalThis as any).MagicGirlWorld;
    const capabilities = runtime?.getDesignAssistantCapabilities?.();
    const ready = capabilities?.towerGeneration === true && capabilities?.towerCoordinator === true;
    root.hidden = ready;
    if (ready) return true;
    if (title) title.textContent = '爬塔组件尚未安装';
    if (detail) detail.textContent = '剧情模式可以直接游玩；选择爬塔模式前请先安装角色卡专属组件。';
    return checks >= 20;
  };
  if (!refresh()) {
    const timer = window.setInterval(() => {
      if (refresh()) window.clearInterval(timer);
    }, 500);
  }
  button.addEventListener('click', () => {
    const runtime = (globalThis as any).MagicGirlWorld;
    if (typeof runtime?.installTowerExtension !== 'function') {
      if (detail) detail.textContent = '酒馆安装器尚未就绪，请刷新页面后重试。';
      return;
    }
    button.disabled = true;
    button.textContent = '正在打开酒馆安装器…';
    void Promise.resolve(runtime.installTowerExtension())
      .then((installed: boolean) => {
        button.textContent = installed ? '安装完成，请刷新酒馆' : '安装已取消';
        button.disabled = installed;
        if (detail && installed) detail.textContent = '组件已经安装。刷新酒馆后即可开始爬塔。';
        if (!installed) button.disabled = false;
      })
      .catch((error: unknown) => {
        button.disabled = false;
        button.textContent = '重新尝试安装';
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
