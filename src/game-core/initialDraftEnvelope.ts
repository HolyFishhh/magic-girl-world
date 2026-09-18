/** Program-owned protocol structure only. No story, numbers or effects defaults. */
export const INITIAL_DRAFT_SPEC = 'mwg.initial-draft/v1';
export const INITIAL_DRAFT_ROOT_FIELDS = ['spec', 'narrative', 'player', 'opening', 'registry'] as const;
export const INITIAL_DRAFT_AUTHOR_REQUIRED_ROOTS = ['registry', 'player', 'opening'] as const;
const REQUIRED_SHAPES = [
  ['player', 'object'], ['player.core', 'object'], ['player.cards', 'array'],
  ['opening', 'object'], ['opening.choices', 'array'], ['registry', 'object'],
] as const;
const record = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
export interface InitialDraftEnvelopeIssue { path: string[]; message: string }

/** Match the compiler's structural boundary, collecting independent faults.
 * Deeper gameplay/readiness checks remain authoritative and separate. */
export function collectInitialDraftEnvelopeIssues(value: unknown): InitialDraftEnvelopeIssue[] {
  if (!record(value)) return [{path:[],message:'草稿必须是对象'}];
  const issues: InitialDraftEnvelopeIssue[] = [];
  if (value.spec !== INITIAL_DRAFT_SPEC) issues.push({path:['spec'],message:`草稿版本必须为 ${INITIAL_DRAFT_SPEC}`});
  if (typeof value.narrative !== 'string') issues.push({path:['narrative'],message:'缺少关联的 preset 剧情文本'});
  for (const [name,kind] of REQUIRED_SHAPES) {
    const path=name.split('.');let parent:unknown=value;
    for(const part of path.slice(0,-1))parent=record(parent)?parent[part]:undefined;
    // A missing parent already has a diagnostic; do not imply it exists.
    if(!record(parent))continue;
    const field=parent[path[path.length-1]];
    if(kind==='array'?!Array.isArray(field):!record(field))issues.push({path,message:`${name} 必须为${kind==='array'?'数组':'对象'}`});
  }
  return issues;
}

export function initialDraftAuthorEnvelopeContract(): string {
  return `必须完整输出根字段 ${INITIAL_DRAFT_AUTHOR_REQUIRED_ROOTS.join('、')}，按此顺序先定义、再引用、最后构造奖励；结构边界：${REQUIRED_SHAPES.map(([path,type])=>`${path}:${type}`).join('；')}。这只是结构索引，不是可提交的空模板，所有具体人物、卡牌、馈赠与定义仍须由AI完整创作。顶层 narrative 由 preset 提供，不输出；spec 可省略，提供时只能为 ${INITIAL_DRAFT_SPEC}。`;
}
