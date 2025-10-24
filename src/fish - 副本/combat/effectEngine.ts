import { UnifiedEffectExecutor } from './unifiedEffectExecutor';

/**
 * 效果引擎 - 统一效果执行的入口点
 *
 * 这个类现在主要作为UnifiedEffectExecutor的包装器，
 * 为了保持向后兼容性而存在。
 */
export class EffectEngine {
  private static instance: EffectEngine;
  private unifiedExecutor: UnifiedEffectExecutor;

  private constructor() {
    this.unifiedExecutor = UnifiedEffectExecutor.getInstance();
  }

  public static getInstance(): EffectEngine {
    if (!EffectEngine.instance) {
      EffectEngine.instance = new EffectEngine();
    }
    return EffectEngine.instance;
  }

  /**
   * 执行效果字符串 - 统一入口点
   */
  public async executeEffect(
    effect: string,
    isPlayerSource: boolean,
    targetType?: 'player' | 'enemy',
    context?: any,
  ): Promise<void> {
    try {
      await this.unifiedExecutor.executeEffectString(effect, isPlayerSource, {
        targetType,
        ...context,
      });
    } catch (error) {
      console.error('执行效果失败:', effect, error);
      throw new Error(`未知效果: ${effect}`);
    }
  }

  /**
   * 处理回合开始时的状态效果
   */
  public processStatusEffectsAtTurnStart(target: 'player' | 'enemy'): void {
    this.unifiedExecutor.processStatusEffectsAtTurnStart(target);
  }

  /**
   * 处理回合结束时的状态效果
   */
  public async processStatusEffectsAtTurnEnd(target: 'player' | 'enemy'): Promise<void> {
    await this.unifiedExecutor.processStatusEffectsAtTurnEnd(target);
  }

  /**
   * 处理战斗开始时的状态效果
   */
  public async processStatusEffectsAtBattleStart(target: 'player' | 'enemy'): Promise<void> {
    await this.unifiedExecutor.processStatusEffectsAtBattleStart(target);
  }

  /**
   * 处理回合开始时的能力
   */
  public async processAbilitiesAtTurnStart(target: 'player' | 'enemy'): Promise<void> {
    await this.unifiedExecutor.processAbilitiesAtTurnStart(target);
  }

  /**
   * 处理战斗开始时的能力
   */
  public async processAbilitiesAtBattleStart(target: 'player' | 'enemy'): Promise<void> {
    await this.unifiedExecutor.processAbilitiesAtBattleStart(target);
  }

  /**
   * 处理回合结束时的能力
   */
  public async processAbilitiesAtTurnEnd(target: 'player' | 'enemy'): Promise<void> {
    await this.unifiedExecutor.processAbilitiesAtTurnEnd(target);
  }

  /**
   * 处理受到伤害时的能力
   */
  public async processAbilitiesOnTakeDamage(target: 'player' | 'enemy'): Promise<void> {
    await this.unifiedExecutor.processAbilitiesOnTakeDamage(target);
  }

  /**
   * 处理被动能力
   */
  public async processPassiveAbilities(target: 'player' | 'enemy'): Promise<void> {
    await this.unifiedExecutor.processAbilitiesByTrigger(target, 'passive');
  }

  /**
   * 通用的能力触发处理
   */
  public async processAbilitiesByTrigger(target: 'player' | 'enemy', trigger: string): Promise<void> {
    await this.unifiedExecutor.processAbilitiesByTrigger(target, trigger);
  }

  /**
   * 处理状态效果的战斗开始触发
   */
  public async processStatusEffectsAtBattleStart(target: 'player' | 'enemy'): Promise<void> {
    await this.unifiedExecutor.processStatusEffectsByTrigger(target, 'battle_start');
  }
}
