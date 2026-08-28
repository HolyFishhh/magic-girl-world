/**
 * 动态状态管理器 - 管理AI动态生成的状态效果定义
 *
 * 负责：
 * 1. 从MVU变量中读取AI生成的状态定义
 * 2. 管理状态效果的触发条件和效果
 * 3. 提供状态效果的查询和验证
 */

import { getCurrentMessageVariables } from '../../runtime/messageVariables';
import {
  StatusDefinitionRegistry,
  type RuntimeStatusDefinition,
  type StatusRuntimeEffect,
  type StatusTrigger,
} from '../../game-core';
import { normalizeMvuStatusDefinitions } from '../../runtime/mvuArrays';
import { readBattleDataContract } from '../core/battleDataContract';

export class DynamicStatusManager {
  private static instance: DynamicStatusManager;

  private readonly registry = new StatusDefinitionRegistry();

  private constructor() {
    // 延迟加载，避免在变量未准备好时加载
  }

  public static getInstance(): DynamicStatusManager {
    if (!DynamicStatusManager.instance) {
      DynamicStatusManager.instance = new DynamicStatusManager();
    }
    return DynamicStatusManager.instance;
  }

  /**
   * 手动刷新状态定义（从MVU变量重新加载）
   */
  public refreshFromMVU(): void {
    this.loadFromMVU();
  }

  /**
   * 从MVU变量加载AI生成的状态定义
   */
  private loadFromMVU(): void {
    this.registry.replace([]);
    try {
      const variables = getCurrentMessageVariables();
      const statusesRaw = readBattleDataContract(variables)?.data.statuses;
      const rawStatuses = normalizeMvuStatusDefinitions(statusesRaw);
      const statusNames = Object.fromEntries(
        rawStatuses
          .filter(status => typeof status.id === 'string' && typeof status.name === 'string' && status.name.trim())
          .map(status => [status.id, status.name.trim()]),
      );
      const result = this.registry.replace(rawStatuses, { statusNames });
      result.rejected.forEach(status => console.warn('忽略无效的状态定义:', status));
    } catch (error) {
      console.error('加载动态状态定义失败:', error);
    }
  }

  /**
   * 获取状态定义
   */
  public getStatusDefinition(statusId: string): RuntimeStatusDefinition | undefined {
    return this.registry.get(statusId);
  }

  /**
   * 获取状态的触发效果
   */
  public getStatusTriggerEffects(
    statusId: string,
    trigger: StatusTrigger,
  ): StatusRuntimeEffect[] {
    return this.registry.getTriggerEffects(statusId, trigger);
  }
}
