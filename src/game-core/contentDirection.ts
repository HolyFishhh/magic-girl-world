import { stableHash32 } from './deterministicRandom';
import { createRunPacingContext, formatRunPacingHint, recommendRunNodePacing } from './runPacing';
import type { RunNodeChoice, RunNodeKind, RunState } from './runState';

const THEMES: Record<RunNodeKind, readonly string[]> = {
  battle: ['追猎中的伏击', '守护目标', '狭窄地形遭遇', '仪式中断', '敌方侦察队'],
  elite: ['扭曲的强敌', '宿敌拦截', '失控实验体', '精锐猎杀队', '污染源守卫'],
  event: ['受困者求援', '危险交易', '异常遗物', '身份误认', '追踪线索', '阵营冲突'],
  rest: ['暂时安全的营火', '废弃据点', '雨夜屋檐', '结界内的喘息'],
  shop: ['流动黑市', '魔法工坊', '临时补给点', '战利品拍卖', '隐秘收藏室'],
  boss: ['章节宿敌决战', '城市级灾害核心', '幕后主使现身', '失控仪式终局'],
};

const FOCUSES: Partial<Record<RunNodeKind, readonly string[]>> = {
  battle: ['让进攻与防守都有用', '提供可预告的强行动', '鼓励使用当前构筑联动'],
  elite: ['高风险换取明确成长', '用机制要求改变出牌顺序', '给予可学习的多阶段压力'],
  event: ['即时收益与长期代价', '生命与资源的取舍', '信息与风险的取舍', '不同立场带来不同后果'],
  shop: ['补足构筑短板', '提供一个转变构筑方向的选择', '让低价实用品与高价成长并存'],
  boss: ['分阶段升级压力', '检验本章核心构筑', '让危险行动有明确预告和应对'],
};

const MECHANICS: Partial<Record<RunNodeKind, readonly string[]>> = {
  battle: ['格挡节奏', '状态叠层', '牌序取舍', '欲望风险', '能量转换'],
  elite: ['行动预告', '资源消耗', '状态反制', '构筑弱点', '阶段变化'],
  event: ['生命换收益', '金币换成长', '卡牌改造', '遗物代价', '路线情报'],
  shop: ['攻击补强', '防御补强', '抽弃循环', '状态联动', '能量效率'],
  boss: ['阶段变化', '行动预告', '持续成长', '资源压缩', '构筑检验'],
};

function pick(values: readonly string[], key: string): string {
  return values[stableHash32(key) % values.length];
}

/** Deterministic natural-language direction adds variety without another AI schema or history payload. */
export function formatRunNodeDirection(
  node: RunNodeChoice,
  runSeed: number,
  run?: Pick<RunState, 'actCount' | 'floorsPerAct' | 'nodeCounts'> | null,
): string {
  const key = `${runSeed}:${node.id}:${node.kind}`;
  const pacing = recommendRunNodePacing(createRunPacingContext(node, run));
  const pacingHint = formatRunPacingHint(pacing, node.kind);
  const theme = pick(THEMES[node.kind], `${key}:theme`);
  const focuses = FOCUSES[node.kind];
  const focus = focuses ? pick(focuses, `${key}:focus`) : null;
  const mechanics = MECHANICS[node.kind];
  const mechanic = mechanics ? pick(mechanics, `${key}:mechanic`) : null;
  const mechanicHint = mechanic ? `机制侧重“${mechanic}”。` : '';
  if (node.kind === 'battle') return `围绕“${theme}”生成普通战斗；${focus}。${mechanicHint}${pacingHint}`;
  if (node.kind === 'elite') return `围绕“${theme}”生成机制鲜明的精英战斗；${focus}。${mechanicHint}${pacingHint}`;
  if (node.kind === 'boss') return `围绕“${theme}”生成本章 Boss 战；${focus}。${mechanicHint}${pacingHint}`;
  if (node.kind === 'event') return `围绕“${theme}”生成短事件；选择应体现${focus}。${mechanicHint}${pacingHint}`;
  if (node.kind === 'shop')
    return `围绕“${theme}”生成简短商店场景和商品；${focus}，价格由程序决定。${mechanicHint}${pacingHint}`;
  return `围绕“${theme}”生成简短营火场景，不生成剧情选项。${pacingHint}`;
}
