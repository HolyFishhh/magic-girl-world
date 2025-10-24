// 白木市魔法少女角色创建系统主程序
import { CharacterCreator } from './core/characterCreator';
import './index.scss';

console.log('🌟 白木市魔法少女角色创建系统启动');

// 启动系统
const initializeCharacterCreator = () => {
  console.log('🚀 开始初始化角色创建系统');

  try {
    // 检查基础环境
    if (typeof document === 'undefined') {
      console.error('❌ 文档对象未找到');
      return;
    }

    // 创建角色创建器实例
    new CharacterCreator();

    console.log('✨ 角色创建系统初始化完成');
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
