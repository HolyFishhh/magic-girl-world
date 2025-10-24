/**
 * if语句和动态变量测试
 * 验证修复后的功能是否正确工作
 */

import { UnifiedEffectParser } from '../combat/unifiedEffectParser';
import { UnifiedEffectExecutor } from '../combat/unifiedEffectExecutor';

export class IfStatementTest {
  private parser: UnifiedEffectParser;
  private executor: UnifiedEffectExecutor;

  constructor() {
    this.parser = new UnifiedEffectParser();
    this.executor = UnifiedEffectExecutor.getInstance();
  }

  /**
   * 测试if语句解析
   */
  public testIfStatementParsing(): void {
    console.log('🧪 开始测试if语句解析...');

    const testCases = [
      // 简单if语句
      'if[ME.energy > 2][OP.hp - 15]',
      
      // if-else语句
      'if[ME.energy >= 3][OP.hp - 20]else[OP.hp - 10]',
      
      // 复杂条件
      'if[ME.hp < ME.max_hp / 2][ME.block + 10, draw + 1]else[OP.hp - 8]',
      
      // 嵌套中括号
      'if[ME.energy > 1][if[OP.hp <= 15][OP.hp - 999]else[OP.hp - 10]]else[ME.block + 5]',
      
      // 动态变量计算
      'if[energy >= max_energy / 2][OP.hp - energy * 3]else[ME.hp + energy]',
    ];

    testCases.forEach((testCase, index) => {
      console.log(`\n测试用例 ${index + 1}: ${testCase}`);
      
      try {
        const expressions = this.parser.parseEffectString(testCase);
        
        if (expressions.length === 0) {
          console.error('❌ 解析失败：没有返回表达式');
          return;
        }

        const expression = expressions[0];
        
        if (!expression.isValid) {
          console.error('❌ 解析失败：', expression.errorMessage);
          return;
        }

        if (!expression.isConditional) {
          console.error('❌ 解析失败：不是条件表达式');
          return;
        }

        console.log('✅ 解析成功');
        console.log('  条件:', expression.condition);
        console.log('  真效果:', expression.trueEffect);
        console.log('  假效果:', expression.falseEffect || '无');
        console.log('  描述:', expression.description);
        
      } catch (error) {
        console.error('❌ 解析异常:', error);
      }
    });
  }

  /**
   * 测试动态变量处理
   */
  public testDynamicVariables(): void {
    console.log('\n🧪 开始测试动态变量处理...');

    const testCases = [
      // 基础变量引用
      'ME.hp + max_hp / 4',
      
      // 能量变量
      'OP.hp - energy * 2',
      
      // 复杂数学表达式
      'ME.lust + (ME.max_lust - ME.lust) / 2',
      
      // 混合变量
      'OP.hp - (energy + ME.lust) * 1.5',
    ];

    testCases.forEach((testCase, index) => {
      console.log(`\n动态变量测试 ${index + 1}: ${testCase}`);
      
      try {
        const expressions = this.parser.parseEffectString(testCase);
        
        if (expressions.length === 0) {
          console.error('❌ 解析失败：没有返回表达式');
          return;
        }

        const expression = expressions[0];
        
        if (!expression.isValid) {
          console.error('❌ 解析失败：', expression.errorMessage);
          return;
        }

        console.log('✅ 解析成功');
        console.log('  属性:', expression.attribute);
        console.log('  操作符:', expression.operator);
        console.log('  值:', expression.value);
        console.log('  是否变量引用:', expression.isVariableReference);
        
      } catch (error) {
        console.error('❌ 解析异常:', error);
      }
    });
  }

  /**
   * 测试嵌套括号解析
   */
  public testNestedBrackets(): void {
    console.log('\n🧪 开始测试嵌套括号解析...');

    const testCases = [
      // 简单嵌套
      'if[ME.energy > 0][if[OP.hp <= 10][OP.hp - 999]]',
      
      // 复杂嵌套
      'if[ME.hp < 50][if[ME.energy >= 2][OP.hp - 20]else[OP.hp - 10]]else[if[ME.energy >= 3][OP.hp - 30]else[ME.block + 5]]',
      
      // 多层嵌套
      'if[ME.energy > 1][if[OP.hp <= 15][if[ME.lust > 50][OP.hp - 999]else[OP.hp - 50]]else[OP.hp - 10]]else[ME.block + 5]',
    ];

    testCases.forEach((testCase, index) => {
      console.log(`\n嵌套括号测试 ${index + 1}: ${testCase}`);
      
      try {
        const expressions = this.parser.parseEffectString(testCase);
        
        if (expressions.length === 0) {
          console.error('❌ 解析失败：没有返回表达式');
          return;
        }

        const expression = expressions[0];
        
        if (!expression.isValid) {
          console.error('❌ 解析失败：', expression.errorMessage);
          return;
        }

        console.log('✅ 解析成功');
        console.log('  条件:', expression.condition);
        console.log('  真效果:', expression.trueEffect);
        console.log('  假效果:', expression.falseEffect || '无');
        
      } catch (error) {
        console.error('❌ 解析异常:', error);
      }
    });
  }

  /**
   * 运行所有测试
   */
  public runAllTests(): void {
    console.log('🚀 开始运行if语句和动态变量测试...\n');
    
    this.testIfStatementParsing();
    this.testDynamicVariables();
    this.testNestedBrackets();
    
    console.log('\n✅ 所有测试完成！');
  }
}

// 如果直接运行此文件，执行测试
if (typeof window === 'undefined') {
  const test = new IfStatementTest();
  test.runAllTests();
}
