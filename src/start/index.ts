// 白木市魔法少女角色创建系统主程序。此入口直接使用酒馆助手全局 API，
// 不加载 common/fish 的 jQuery 运行时，避免角色创建 HTML 无谓膨胀。
import { CharacterCreator } from './core/characterCreator';
import './index.scss';

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
