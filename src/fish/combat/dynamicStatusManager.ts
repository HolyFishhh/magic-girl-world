/**
 * 动态状态管理器 - 管理AI动态生成的状态效果定义
 *
 * 负责：
 * 1. 从MVU变量中读取AI生成的状态定义
 * 2. 管理状态效果的触发条件和效果
 * 3. 提供状态效果的查询和验证
 */

export interface DynamicStatusDefinition {
  id: string;
  name: string;
  emoji: string;
  description: string;
  type: 'buff' | 'debuff' | 'neutral';
  // 衰减/变化机制（每回合对层数的自动调整）：
  // - number: 直接增减（如 -1, +2）
  // - string:
  //   - x0.5 表示按比例变化（本回合结束后层数 = floor(层数 * 0.5)）
  //   - reset 表示直接清零
  //   - keep 表示不变化
  stacks_change?: number | string;
  maxStacks?: number;

  // 触发效果
  triggers: {
    apply?: string[]; // 施加时触发的效果
    tick?: string[]; // 每回合触发的效果（等价于 turn_start）
    remove?: string[]; // 移除时触发的效果
    stack?: string[]; // 叠加时触发的效果
    hold?: string[]; // 持有时的持续效果（修饰符等，会在移除时自动清理）
  };

  // 元数据
  source: 'ai' | 'system'; // 来源：AI生成或系统预定义
  createdAt: number; // 创建时间戳
}

export class DynamicStatusManager {
  private static instance: DynamicStatusManager;

  // 状态定义缓存
  private statusDefinitions: Map<string, DynamicStatusDefinition> = new Map();

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
    this.statusDefinitions.clear();
    this.loadFromMVU();
  }

  /**
   * 从MVU变量加载AI生成的状态定义
   */
  private loadFromMVU(): void {
    try {
      const variables = getVariables({ type: 'message' });
      const statusesRaw = variables?.stat_data?.battle?.statuses;

      if (!statusesRaw || !Array.isArray(statusesRaw)) {
        return;
      }

      // 处理MVU嵌套数组格式：递归解析直到找到实际对象数组
      let statuses: any[] = statusesRaw;
      let depth = 0;

      // 递归解析嵌套数组
      while (Array.isArray(statuses) && statuses.length > 0 && Array.isArray(statuses[0]) && depth < 3) {
        console.log(`🔍 Fish - 深度 ${depth} - 解析嵌套数组:`, statuses[0]);
        statuses = statuses[0];
        depth++;
      }

      console.log('🔍 Fish - 解析状态数组:', {
        原始: statusesRaw,
        解析后: statuses,
        长度: statuses.length,
        深度: depth,
      });

      // 过滤掉元数据标记和无效项
      const filteredStatuses = statuses.filter(item => {
        const isValid = item && typeof item === 'object' && item !== '$__META_EXTENSIBLE__$' && item.id && item.name;

        if (!isValid && item) {
          console.warn('⚠️ Fish - 状态对象无效:', item, '字段:', item ? Object.keys(item) : 'N/A');
        }

        return isValid;
      });

      for (const statusData of filteredStatuses) {
        if (this.validateStatusDefinition(statusData)) {
          const status: DynamicStatusDefinition = {
            ...statusData,
            source: 'ai',
            createdAt: statusData.createdAt || Date.now(),
          };
          this.statusDefinitions.set(status.id, status);
          console.log(`✅ 加载状态定义: ${status.name} (${status.id})`);
        }
      }
    } catch (error) {
      console.error('加载动态状态定义失败:', error);
    }
  }

  /**
   * 验证状态定义的有效性
   */
  private validateStatusDefinition(statusData: any): boolean {
    if (!statusData || typeof statusData !== 'object') {
      return false;
    }

    const required = ['id', 'name', 'emoji', 'description', 'type'];
    for (const field of required) {
      if (!statusData[field]) {
        console.warn(`状态定义缺少必需字段: ${field}`);
        return false;
      }
    }

    if (!['buff', 'debuff', 'neutral'].includes(statusData.type)) {
      console.warn(`无效的状态类型: ${statusData.type}`);
      return false;
    }

    return true;
  }

  /**
   * 获取状态定义
   */
  public getStatusDefinition(statusId: string): DynamicStatusDefinition | undefined {
    return this.statusDefinitions.get(statusId);
  }

  /**
   * 获取状态的触发效果
   */
  public getStatusTriggerEffects(statusId: string, trigger: keyof DynamicStatusDefinition['triggers']): string[] {
    const status = this.statusDefinitions.get(statusId);
    const triggers = status?.triggers;
    if (!status || !triggers || !(trigger in triggers)) {
      return [];
    }

    const effects = (triggers as any)[trigger] as any;
    if (Array.isArray(effects)) return effects as string[];
    if (typeof effects === 'string') return [effects];
    return [];
  }

  /**
   * 添加新的状态定义
   */
  public addStatusDefinition(status: DynamicStatusDefinition): void {
    if (this.validateStatusDefinition(status)) {
      this.statusDefinitions.set(status.id, status);
      this.saveToMVU();
    }
  }

  /**
   * 保存到MVU变量
   */
  private saveToMVU(): void {
    try {
      // 只保存AI生成的状态
      const aiStatuses = Array.from(this.statusDefinitions.values()).filter(status => status.source === 'ai');

      // 使用insertOrAssignVariables保存状态定义
      insertOrAssignVariables({ 'stat_data.battle.statuses': aiStatuses }, { type: 'message' });
    } catch (error) {
      console.error('保存动态状态定义失败:', error);
    }
  }

  /**
   * 强制重新加载
   */
  public forceReload(): void {
    // 清除所有状态定义并重新加载
    this.statusDefinitions.clear();

    // 重新加载
    this.loadFromMVU();
  }

  /**
   * 获取所有状态定义
   */
  public getAllStatusDefinitions(): Map<string, DynamicStatusDefinition> {
    return new Map(this.statusDefinitions);
  }
}
