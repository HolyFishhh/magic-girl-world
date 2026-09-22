/** Shared authoring, display and execution contract for holder-local status selection. */
export interface StatusActionSpec {
  mode: 'remove' | 'copy' | 'transfer';
  from: 'self' | 'opponent';
  to?: 'self' | 'opponent';
  pick?: 'choose' | 'first' | 'random';
  count?: number | 'all';
  stacks?: number;
  filter?: { type?: 'buff' | 'debuff' | 'neutral'; ids?: string[]; tags?: string[]; min_stacks?: number };
}
export const STATUS_ACTION_CONTRACT = '状态选择/复制/转移使用 {status_action:{mode:"remove"|"copy"|"transfer",from:"self"|"opponent",to?:"self"|"opponent",pick?:"choose"|"first"|"random",count?:1..999或"all",stacks?:1..999,filter?:{type?:"buff"|"debuff"|"neutral",ids?:[状态ID],tags?:[标签ID],min_stacks?:正整数}}。from 指当前精确持有者或当前对方，不接受群体 targets；召唤自己的 self 仍是该召唤。复制/转移必填 to；remove 不写 to；不能向自己转移。count 默认1，候选不足处理实际数量；pick 默认 choose（玩家手选且可取消，敌方自动随机），first 按持有顺序；stacks 省略处理选中状态全部现有层数。filter 字段同时满足，ids/tags 内任一匹配；状态定义根 tags 是可选且不重复的英文标签数组，类型中性写 neutral。复制保留来源，转移仅扣除目标实际接收的层数；目标层数上限、人工制品或不接收状态导致未接收时不丢失来源。层数和期限不重新计算；与同ID状态合并时取较长剩余期限，无期限优先；仍按该状态自身衰减规则运行，不能改名为力量等预设。目标写入、来源扣除在同一动作事务内完成，再执行来源移除与目标获得/叠加生命周期；取消或动作失败回滚。';
export interface SelectableStatus {
  id: string; name: string; type: string; stacks: number; duration?: number; emoji?: string; description?: string;
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validateStatusAction(value: unknown): string | null {
  if (!record(value)) return 'status_action 必须是对象';
  if (Object.keys(value).some(k => !['mode','from','to','pick','count','stacks','filter'].includes(k))) return 'status_action 含未知字段';
  if (!['remove','copy','transfer'].includes(value.mode)) return 'mode 只能是 remove/copy/transfer';
  if (!['self','opponent'].includes(value.from)) return 'from 必须是 self/opponent';
  if (value.mode !== 'remove' && !['self','opponent'].includes(value.to)) return '复制/转移必须指定 to:self/opponent';
  if (value.mode === 'remove' && value.to !== undefined) return '移除状态不接受 to';
  if (value.mode === 'transfer' && value.from === value.to) return '不能向同一持有者转移状态';
  if (value.pick !== undefined && !['choose','first','random'].includes(value.pick)) return 'pick 无效';
  for (const key of ['count','stacks']) if (value[key] !== undefined && !(key === 'count' && value[key] === 'all')
    && (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 999)) return `${key} 必须是 1..999 的整数${key === 'count' ? ' 或 all' : ''}`;
  if (value.filter !== undefined) {
    const f = value.filter;
    if (!record(f) || Object.keys(f).some(k => !['type','ids','tags','min_stacks'].includes(k))) return '状态 filter 无效';
    if (f.type !== undefined && !['buff','debuff','neutral'].includes(f.type)) return 'filter.type 无效';
    if (f.min_stacks !== undefined && (!Number.isInteger(f.min_stacks) || f.min_stacks < 1 || f.min_stacks > 999)) return 'filter.min_stacks 无效';
    for (const key of ['ids','tags']) if (f[key] !== undefined && (!Array.isArray(f[key]) || !f[key].length || f[key].length > 64
      || f[key].some((x: unknown) => typeof x !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(x)) || new Set(f[key]).size !== f[key].length)) return `filter.${key} 必须是非空且不重复的 ID 数组`;
  }
  return null;
}
export function statusMatchesAction(status: SelectableStatus, spec: StatusActionSpec, tags: readonly string[] = []): boolean {
  const f = spec.filter;
  return status.stacks > 0 && (!f?.type || status.type === f.type) && (!f?.ids || f.ids.includes(status.id))
    && (!f?.tags || f.tags.some(tag => tags.includes(tag))) && status.stacks >= (f?.min_stacks ?? 1);
}
export interface StatusReceiveOptions {
  /** Copied metadata is applied before any apply/stack lifecycle runs. */
  copied?: SelectableStatus;
  accepted?(stacks: number): Promise<void>;
}
export function copiedStatusDuration(existing: SelectableStatus | undefined, copied: SelectableStatus): number | undefined {
  if (!existing) return copied.duration;
  if (existing.duration === undefined || copied.duration === undefined) return undefined;
  return Math.max(existing.duration, copied.duration);
}
export interface StatusActionPorts {
  read(side: 'self' | 'opponent'): readonly SelectableStatus[];
  tags(id: string): readonly string[];
  random(): number;
  choose(candidates: readonly SelectableStatus[], count: number): Promise<readonly string[] | null>;
  /** Host must preserve holder identity and run lifecycle hooks inside the enclosing action transaction. */
  apply(side: 'self' | 'opponent', status: SelectableStatus, count: number, options: StatusReceiveOptions): Promise<void>;
  remove(side: 'self' | 'opponent', id: string, count: number): Promise<void>;
}
export async function executeStatusAction(spec: StatusActionSpec, ports: StatusActionPorts, interactive: boolean): Promise<void> {
  const issue = validateStatusAction(spec);
  if (issue) throw new Error(issue);
  const snapshot = structuredClone(ports.read(spec.from));
  let candidates = snapshot.filter(s => statusMatchesAction(s, spec, ports.tags(s.id)));
  const count = Math.min(candidates.length, spec.count === 'all' ? candidates.length : spec.count ?? 1);
  if (!count) return;
  if (spec.pick === 'random' || (spec.pick ?? 'choose') === 'choose' && !interactive) {
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(Math.max(0, ports.random()) * (i + 1)));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
  } else if ((spec.pick ?? 'choose') === 'choose' && interactive && count < candidates.length) {
    const selected = await ports.choose(candidates, count);
    if (selected === null) throw Object.assign(new Error('状态选择已取消'), { code: 'CHOICE_CANCELLED' });
    if (selected.length !== count || new Set(selected).size !== count || selected.some(id => !candidates.some(s => s.id === id))) throw new Error('状态选择无效');
    const ids = new Set(selected);
    candidates = candidates.filter(s => ids.has(s.id));
  }
  if (JSON.stringify(snapshot) !== JSON.stringify(ports.read(spec.from))) throw new Error('状态选择已经过期，请重新选择');
  for (const selected of candidates.slice(0, count)) {
    const current = ports.read(spec.from).find(s => s.id === selected.id);
    if (!current) continue;
    // Earlier selected states can trigger effects; never transfer newly gained layers of a later selection.
    const amount = Math.min(current.stacks, selected.stacks, spec.stacks ?? selected.stacks);
    if (amount <= 0) continue;
    if (spec.mode === 'remove') await ports.remove(spec.from, selected.id, amount);
    else await ports.apply(spec.to!, { ...current }, amount, {
      copied: { ...current },
      ...(spec.mode === 'transfer' ? { accepted: async (accepted: number) => ports.remove(spec.from, selected.id, accepted) } : {}),
    });
  }
}
export function describeStatusAction(spec: StatusActionSpec, names: Record<string,string> = {}, self = '自身', opponent = '对方'): string {
  const holder = (side: string | undefined) => side === 'self' ? self : opponent;
  const f = spec.filter;
  const filter = [f?.type && ({buff:'增益',debuff:'减益',neutral:'中性状态'}[f.type]), f?.ids?.map(id => names[id] || id).join('或'),
    f?.tags?.length ? `带标签 ${f.tags.join('或')}` : '', f?.min_stacks ? `至少${f.min_stacks}层` : ''].filter(Boolean).join('、');
  const pick = spec.count === 'all' ? '全部' : `${spec.pick === 'random' ? '随机' : spec.pick === 'first' ? '按持有顺序取' : '选择至多'}${spec.count ?? 1}个`;
  return `从${holder(spec.from)}的${filter || '任意'}状态中${pick}，${spec.mode === 'remove' ? '移除' : spec.mode === 'copy' ? `复制并赋予${holder(spec.to)}` : `转移给${holder(spec.to)}`}${spec.stacks ? `各至多${spec.stacks}层` : '全部现有层数'}${spec.mode === 'remove' ? '' : '；保留状态身份与期限，层数上限或阻挡未接收的部分保留在来源处'}`;
}
