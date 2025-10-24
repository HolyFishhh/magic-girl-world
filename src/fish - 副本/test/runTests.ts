/**
 * 测试运行器
 * 用于验证修复后的功能
 */

import { IfStatementTest } from './ifStatementTest';

// 模拟浏览器环境中的全局对象
declare global {
  var $: any;
  var _: any;
  var toastr: any;
  var YAML: any;
}

// 简单的jQuery模拟
global.$ = (selector: string) => ({
  text: (value?: string) => (value !== undefined ? {} : ''),
  html: (value?: string) => (value !== undefined ? {} : ''),
  addClass: () => ({}),
  removeClass: () => ({}),
  css: () => ({}),
  show: () => ({}),
  hide: () => ({}),
  length: 0,
});

// 简单的lodash模拟
global._ = {
  has: () => false,
  assign: () => ({}),
  cloneDeep: (obj: any) => JSON.parse(JSON.stringify(obj)),
};

// 简单的toastr模拟
global.toastr = {
  success: (message: string) => console.log('✅', message),
  error: (message: string) => console.error('❌', message),
  warning: (message: string) => console.warn('⚠️', message),
  info: (message: string) => console.log('ℹ️', message),
};

// 简单的YAML模拟
global.YAML = {
  parse: (str: string) => JSON.parse(str),
  stringify: (obj: any) => JSON.stringify(obj),
};

/**
 * 主测试函数
 */
function runTests() {
  console.log('🧪 开始运行Fish RPG测试套件...\n');

  try {
    // 运行if语句测试
    const ifTest = new IfStatementTest();
    ifTest.runAllTests();

    console.log('\n🎉 所有测试完成！');
  } catch (error) {
    console.error('❌ 测试运行失败:', error);
    process.exit(1);
  }
}

// 运行测试
runTests();
