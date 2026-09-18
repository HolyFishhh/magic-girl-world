/** Authoring invariant, not a semantic validator or permission to mutate saves. */
export function semanticPreservationContract(): string {
  return '语义保留：结构或载体改写须保留事件、条件、发生者、持有者、目标、数值、时机、次数及寿命；不能靠删条件或收益、改说明、换机制获得合法结果。修复仅在指定可修改字段内进行；载体迁移无法在该范围内保持上述维度时保留失败。自由设计可组合公开能力；玩家明确要求无法等价表达时保留缺口，不省略或用相近机制冒充。不新增检查报告字段，不重写已成立剧情。';
}
