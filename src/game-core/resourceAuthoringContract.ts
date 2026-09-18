/** Public compact examples. Tests execute the JSON actually rendered in the prompt. */
export function formatCombatResourceAuthoringContract(placement: 'runtime' | 'initial-draft' = 'runtime'): string {
  const examples = {
    resource: { id: 'charge', name: '充能', emoji: '⚡', max: 6, refresh: 'retain', start: 0 },
    gain: { cost: 1, effects: { resource: { id: 'charge', amount: 2 } } },
    loss: { cost: 1, effects: { resource: { id: 'charge', amount: -2 } } },
    spend: { cost: { energy: 1, charge: 2 }, effects: { damage: 10 } },
  };
  return [
    placement === 'initial-draft'
      ? '玩家自定义资源只在 registry.resources 注册为 {id,name,emoji,max,refresh,end_of_battle?,start?或current?}。id 不能是 energy，refresh 只用 reset/retain，必须满足 0<=start/current<=max。初始值可写 start，存档值写 current，二者同时存在时 current 优先。'
      : '自定义资源先在 core.resources 注册为 {id,name,emoji,max,refresh,end_of_battle?,start?或current?}；初始草稿模式则统一登记在 registry.resources。id 不能是 energy，refresh 只用 reset/retain，必须满足 0<=start/current<=max。初始值可写 start，存档值写 current，二者同时存在时 current 优先。',
    '资源定义可选 description 文本，仅用于向玩家解释；程序保留并展示，不从说明推导数值或执行效果。具体获得、消耗和触发仍写在实际规则中。',
    formatCombatResourceExecutionContract(),
    `资源语义示例（只说明规则，不是必须生成的内容）：${JSON.stringify(examples)}`,
    '示例 gain 从 0 变 2；loss 从 2 变 0、从 1 也变 0；spend 必须同时有 1 能量和 2 充能，支付后才造成 10 伤害。由 AI 按剧情设计资源、费用和数值，程序不会照抄示例造卡，也不会按 description 自动把正数改为负数。',
  ].join('\n');
}

/** Shared by the raw prompt and the checked worldbook resource section. */
export function formatCombatResourceExecutionContract(): string {
  return [
    '资源 end_of_battle 独立控制战后结余：retain 保留当前值到下一场，reset 在战后恢复 start（省略 start 则为 0）。新资源按设计明确选择；旧存档省略此字段仍保留。此规则不修改每回合 refresh。',
    '资源 refresh 的执行含义：reset 是每回合开始补满到 max，不是归零或恢复 start，第一回合也补满；retain 保留当前量、不自动补充。从 0 逐渐积累并跨回合消费的资源应选择 retain，不应仅凭名称“重置”选择 reset。',
    '资源效果只写 {resource:{id:"资源ID",amount:数值或公式},to?:目标,targets?,when?} 或 {set_resource:{id:"资源ID",value:数值或公式},to?:目标,targets?,when?}。默认目标是自身；amount 为正数是增加，为负数是减少，结果限制在 0 到 max；set_resource 是直接设值，不是增减。amount 只属于 resource 内部以及明确声明 amount 的召唤专用对象。',
    '负数 resource 效果不是出牌费用：资源不足仍可打出，只会扣到 0。若必须支付 N 点资源才能打出，写复合 cost:{energy:能量费,资源ID:N}，不足时整张牌不能打出；费用已经自动扣除，effects 不得重复扣费。若只是可选条件收益，不能擅自改成必付费用；when 在每个效果执行时重新判断当前状态，不会冻结为整张牌的共同条件，描述应准确对应各步。',
    '资源用途：产出须连接真实的支付、公式读取、条件或其他可执行联动，不强制消费。只有产出而无用途不能兑现当前收益承诺；尚未领取奖励或未来剧情的用途须明确为未来依赖。按剧情补齐所需机制，不删除资源或改说明掩盖缺失。',
  ].join('\n');
}
