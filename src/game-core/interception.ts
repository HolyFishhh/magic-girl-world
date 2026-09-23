import { roundBattleValue } from './battleMath';
import { validateEffectProgramPolicy } from './effectProgramPolicy';
import { compileCompactCondition, compileCompactEffectList } from './compactEffectDsl';
import { evaluateConditionExpression, evaluateNumericExpression, type CoreEffectState, type EffectExecutionContext, type EffectProgram } from './effectDsl';

export interface InterceptionRule {
  id: string;
  window: 'before_damage' | 'before_card_play';
  subject?: 'self' | 'opponent';
  priority?: number;
  when?: string;
  card_type?: 'Attack' | 'Skill' | 'Power' | 'Curse' | 'Status';
  damage_kind?: 'attack' | 'effect' | 'damage_over_time' | 'hp_loss' | 'retaliation';
  cancel?: true;
  amount?: number | string;
  replace?: unknown;
  consume_stacks?: number;
  uses_per_turn?: number;
  uses_per_battle?: number;
}
export type InterceptionUsage = Record<string, { turn: number; turnUses: number; battleUses: number }>;
export const INTERCEPTION_SCHEMA = { type: 'array', minItems: 1, maxItems: 16, items: {
  type: 'object', additionalProperties: false, required: ['id', 'window'],
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }, window: { enum: ['before_damage', 'before_card_play'] },
    subject: { enum: ['self', 'opponent'] }, priority: { type: 'integer', minimum: -999, maximum: 999 }, when: { type: 'string', minLength: 1 },
    card_type: { enum: ['Attack', 'Skill', 'Power', 'Curse', 'Status'] }, damage_kind: { enum: ['attack', 'effect', 'damage_over_time', 'hp_loss', 'retaliation'] },
    cancel: { const: true }, amount: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'string', minLength: 1 }] }, replace: { $ref: '#/$defs/effectList' },
    consume_stacks: { type: 'integer', minimum: 1, maximum: 999 }, uses_per_turn: { type: 'integer', minimum: 1, maximum: 999 }, uses_per_battle: { type: 'integer', minimum: 1, maximum: 999 },
  }, oneOf: [{ required: ['cancel'] }, { required: ['amount'] }, { required: ['replace'] }],
  allOf: [
    { if: { properties: { window: { const: 'before_card_play' } } }, then: { not: { anyOf: [{ required: ['amount'] }, { required: ['damage_kind'] }] } } },
    { if: { properties: { window: { const: 'before_damage' } } }, then: { not: { required: ['card_type'] } } },
  ],
} };
export function validateInterceptions(value: unknown, creates?: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.length || value.length > 16) return 'intercepts 需要 1..16 条规则';
  const ids = new Set<string>();
  for (const r of value) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => !Object.hasOwn(INTERCEPTION_SCHEMA.items.properties, k))) return 'intercepts 含未知字段';
    if (typeof r.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.id) || ids.has(r.id)) return '拦截规则 id 无效或重复';
    ids.add(r.id);
    if (!['before_damage','before_card_play'].includes(r.window) || (r.subject !== undefined && !['self','opponent'].includes(r.subject))) return '拦截窗口/主体无效';
    if (r.priority !== undefined && (!Number.isInteger(r.priority) || Math.abs(r.priority) > 999)) return '拦截优先级无效';
    for (const k of ['consume_stacks','uses_per_turn','uses_per_battle']) if (r[k] !== undefined && (!Number.isInteger(r[k]) || r[k] < 1 || r[k] > 999)) return '拦截消耗/次数无效';
    if (['cancel','amount','replace'].filter(k => r[k] !== undefined).length !== 1 || (r.cancel !== undefined && r.cancel !== true)) return '每条拦截只选 cancel / amount / replace 一种结果';
    if (r.window === 'before_card_play' && (r.amount !== undefined || r.damage_kind !== undefined)) return '出牌拦截不支持伤害字段';
    if (r.card_type !== undefined && (r.window !== 'before_card_play' || !INTERCEPTION_SCHEMA.items.properties.card_type.enum.includes(r.card_type))) return '拦截卡牌类型无效';
    if (r.damage_kind !== undefined && !INTERCEPTION_SCHEMA.items.properties.damage_kind.enum.includes(r.damage_kind)) return '拦截伤害类型无效';
    if (r.when !== undefined) {
      const compiled = compileCompactEffectList({ when: r.when, block: 0 });
      if (typeof r.when !== 'string' || !compiled.ok || !validateEffectProgramPolicy(compiled.value, { allowStatusStacks: true, allowPendingResolution: true }).ok) return '拦截条件无法执行或读取了不可用的上下文';
    }
    if (r.amount !== undefined) {
      const compiled = compileCompactEffectList({ block: r.amount });
      if (!compiled.ok || compiled.value.steps[0]?.op !== 'gain_block' || (typeof r.amount === 'number' && r.amount < 0) || !validateEffectProgramPolicy(compiled.value, { allowStatusStacks: true, allowPendingResolution: true }).ok) return '拦截 amount 必须是可执行的非负数值/算术公式';
    }
    if (r.replace !== undefined) {
      const compiled = compileCompactEffectList(r.replace, { implicitTarget: 'self', creates });
      if (!compiled.ok || !validateEffectProgramPolicy(compiled.value, { triggerPolicy: 'forbid', modifierPolicy: 'forbid', allowStatusStacks: true, allowPendingResolution: true }).ok) return '拦截替换效果无法执行或依赖不可用的上下文';
    }
  }
  return null;
}
export interface PendingResolution {
  window: InterceptionRule['window']; subjectId: string; subjectSide: 'player' | 'enemy';
  amount: number; turn: number; damageKind?: string; cardType?: string; context?: Partial<EffectExecutionContext>;
}
export interface InterceptionSource {
  key: string; holderId: string; side: 'player' | 'enemy'; rule: InterceptionRule;
  read(): { stacks: number; usage?: InterceptionUsage } | undefined;
  state(): CoreEffectState;
  saveUsage(usage: InterceptionUsage): void;
  consume(stacks: number): Promise<void>;
  execute(program: EffectProgram, context: EffectExecutionContext): Promise<void>;
  creates?: unknown;
  present(): void;
}
/** One bounded window; nested replacement effects cannot re-enter an active rule. */
export async function resolveInterceptions(pending: PendingResolution, sources: InterceptionSource[], active = new Set<string>()): Promise<{ amount: number; cancelled: boolean }> {
  let amount = pending.amount;
  if (active.size >= 32) throw new Error('结算前拦截嵌套超过32层');
  const ordered = [...sources].sort((a,b) => (b.rule.priority || 0) - (a.rule.priority || 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const source of ordered) {
    const rule = source.rule, holder = source.read();
    if (!holder || holder.stacks <= 0 || active.has(source.key) || rule.window !== pending.window) continue;
    if ((rule.subject || 'self') === 'self' ? source.holderId !== pending.subjectId : source.side === pending.subjectSide) continue;
    if (rule.card_type && rule.card_type !== pending.cardType || rule.damage_kind && rule.damage_kind !== pending.damageKind) continue;
    const usage = holder.usage?.[rule.id];
    if (rule.consume_stacks && holder.stacks < rule.consume_stacks || rule.uses_per_turn && usage?.turn === pending.turn && usage.turnUses >= rule.uses_per_turn || rule.uses_per_battle && (usage?.battleUses || 0) >= rule.uses_per_battle) continue;
    const context: EffectExecutionContext = { spentEnergy: 0, ...pending.context, statusStacks: holder.stacks, pendingAmount: amount };
    if (rule.when) {
      const condition = compileCompactCondition(rule.when);
      if (!condition.ok) throw new Error('拦截条件已损坏');
      if (!evaluateConditionExpression(condition.value, source.state(), context)) continue;
    }
    active.add(source.key);
    try {
      source.saveUsage({ ...holder.usage, [rule.id]: { turn: pending.turn, turnUses: (usage?.turn === pending.turn ? usage.turnUses : 0) + 1, battleUses: (usage?.battleUses || 0) + 1 } });
      if (rule.consume_stacks) await source.consume(rule.consume_stacks);
      source.present();
      if (rule.cancel) return { amount: 0, cancelled: true };
      if (rule.replace !== undefined) {
        const compiled = compileCompactEffectList(rule.replace, { implicitTarget: 'self', creates: source.creates });
        if (!compiled.ok) throw new Error('拦截替换效果已损坏');
        await source.execute(compiled.value, context);
        return { amount: 0, cancelled: true };
      }
      const compiled = compileCompactEffectList({ block: rule.amount });
      if (!compiled.ok || compiled.value.steps[0].op !== 'gain_block') throw new Error('拦截数值已损坏');
      amount = Math.max(0, roundBattleValue(evaluateNumericExpression(compiled.value.steps[0].amount, source.state(), context)));
    } finally { active.delete(source.key); }
  }
  return { amount, cancelled: false };
}
export function describeInterceptions(value: unknown, describe: { formula(v: unknown): string; condition(v: unknown): string; effects(v: unknown): string }): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((r: InterceptionRule) => `结算前拦截：${r.subject === 'opponent' ? '敌方' : '持有者'}${r.window === 'before_damage' ? '受到伤害' : `打出${r.card_type ? ({Attack:'攻击',Skill:'技能',Power:'能力',Curse:'诅咒',Status:'状态'})[r.card_type] : ''}牌`}时${r.damage_kind ? `（${({attack:'攻击',effect:'效果',damage_over_time:'持续',hp_loss:'生命流失',retaliation:'反击'})[r.damage_kind]}伤害）` : ''}${r.when ? `，若${describe.condition(r.when)}` : ''}，${r.cancel ? '取消本次结算' : r.replace !== undefined ? `替换为：${describe.effects(r.replace)}` : `将本次伤害改为${describe.formula(r.amount)}`}；优先级${r.priority || 0}${r.consume_stacks ? `，消耗${r.consume_stacks}层` : ''}${r.uses_per_turn ? `，每回合最多${r.uses_per_turn}次` : ''}${r.uses_per_battle ? `，本场最多${r.uses_per_battle}次` : ''}${r.window === 'before_card_play' ? '（费用已支付，卡牌仍离手；重放逐次检查）' : '（格挡前）'}`);
}
export const INTERCEPTION_CONTRACT = '状态根部 intercepts:[{id,window:"before_damage"或"before_card_play",subject?:"self"(默认)或"opponent",priority?:整数,when?:通用条件,card_type?:Attack/Skill/Power/Curse/Status,damage_kind?:attack/effect/damage_over_time/hp_loss/retaliation,cancel?:true,amount?:数值或算术公式,replace?:浅层effects,consume_stacks?:正整数,uses_per_turn?:正整数,uses_per_battle?:正整数}]。cancel/amount/replace 恰选一项。出牌窗口只支持 cancel/replace 和 card_type；伤害窗口只支持 damage_kind 和三种结果。高优先级先，同优先级按持有者/状态/规则ID排序，取消/替换停止该次窗口。pending_amount 是当前包伤害；出牌窗口可读 event_paid_energy/total/resource及event_paid_hp/discard/sacrifices，重放这些支付量为0。self/opponent/stacks 以状态持有者为基准；subject:opponent作用于另一阵营。敌人的被动反制可用开场赋予此状态；召唤物持有时 self 仅精确召唤实例。伤害窗口在保护/召唤拦截及减伤之后、无实体/格挡/缓冲之前，包含生命流失但不包含支付生命费用；替换程序先执行，原伤害归零。出牌窗口在付费和费用触发之后、每次卡牌效果之前；取消不退费、不取消出牌事件/离手，不等于取消玩家选牌。只有玩家打出的卡（含自动/重放）有出牌窗口，敌方意图不是卡牌。次数按精确持有状态实例记录，移除后重新赋予重新计数，复制/转移不复制使用记录；无需强制次数上限，按设计平衡决定。活跃规则禁止自递归，整个窗口嵌套至多32层。';
