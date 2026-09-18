export const TOWER_DUNGEON_PLAN_SPEC = 'mwg.tower-dungeon-plan/v1' as const;
export interface TowerDungeonPlan {
  spec: typeof TOWER_DUNGEON_PLAN_SPEC;
  theme: string;
  enemyTypes: string[];
  mainSystems: string[];
  bossDirection: string;
  acts: Array<{ act: number; theme: string; enemies: string; mechanics: string; boss: string; progression: string }>;
}

const prose = { type: 'string', minLength: 1, maxLength: 1600 };
export const towerDungeonPlanSchema = {
  type: 'object', additionalProperties: false,
  required: ['spec', 'theme', 'enemyTypes', 'mainSystems', 'bossDirection', 'acts'],
  properties: {
    spec: { const: TOWER_DUNGEON_PLAN_SPEC }, theme: prose, bossDirection: prose,
    enemyTypes: { type: 'array', minItems: 1, maxItems: 12, items: prose },
    mainSystems: { type: 'array', minItems: 1, maxItems: 12, items: prose },
    acts: { type: 'array', minItems: 3, maxItems: 3, items: {
      type: 'object', additionalProperties: false,
      required: ['act', 'theme', 'enemies', 'mechanics', 'boss', 'progression'],
      properties: { act: { type: 'integer', minimum: 1, maximum: 3 }, theme: prose,
        enemies: prose, mechanics: prose, boss: prose, progression: prose },
    } },
  },
};

export function isTowerDungeonPlan(value: unknown): value is TowerDungeonPlan {
  const record = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v: unknown) => typeof v === 'string' && !!v.trim() && v.length <= 1600;
  if (!record(value) || value.spec !== TOWER_DUNGEON_PLAN_SPEC || !text(value.theme) || !text(value.bossDirection)) return false;
  if (Object.keys(value).some(key => !['spec', 'theme', 'enemyTypes', 'mainSystems', 'bossDirection', 'acts'].includes(key))) return false;
  if (![value.enemyTypes, value.mainSystems].every(list => Array.isArray(list) && list.length >= 1 && list.length <= 12 && list.every(text))) return false;
  return Array.isArray(value.acts) && value.acts.length === 3 && value.acts.every((act, index) => record(act)
    && act.act === index + 1 && ['theme', 'enemies', 'mechanics', 'boss', 'progression'].every(key => text(act[key]))
    && Object.keys(act).every(key => ['act', 'theme', 'enemies', 'mechanics', 'boss', 'progression'].includes(key)));
}

/** Plan is final authored content, separate from provider reasoning and public prose. */
export function parseTowerPlannedNarrative(response: string): { narrative: string; dungeonPlan: TowerDungeonPlan } {
  const blocks = [...response.matchAll(/<TOWER_DUNGEON_PLAN>\s*([\s\S]*?)\s*<\/TOWER_DUNGEON_PLAN>/g)];
  if (blocks.length !== 1) throw new Error('开局剧情缺少唯一的副本规划，未开始机制生成');
  let plan: unknown;
  try { plan = JSON.parse(blocks[0][1].replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { throw new Error('副本规划 JSON 无效，未开始机制生成'); }
  if (!isTowerDungeonPlan(plan)) throw new Error('副本规划缺少主题、敌人体系或三幕递进关系，未开始机制生成');
  const narrative = response.replace(blocks[0][0], '').trim();
  if (/<\/?TOWER_DUNGEON_PLAN\b/.test(narrative)) throw new Error('副本规划边界无效');
  return { narrative, dungeonPlan: plan };
}

export function towerDungeonPlanningPrompt(): string {
  return '[本次副本规划，同一次响应完成]\n先按当前设定规划副本主题、主要敌人类型与机制体系、整体Boss方向，以及第1至3幕从引入到深化再到终局的递进关系（地图每幕16层，首幕前1至3层也需自然递进）。将正式规划数据放在唯一的<TOWER_DUNGEON_PLAN>JSON对象</TOWER_DUNGEON_PLAN>内，然后输出供玩家阅读的开局正文。规划是供后续生成使用的私有设计数据，不是思考过程；不要在正文泄露未来Boss、事件结果或完整规划。规划只指导后续设计，不提前生成全部战斗或卡牌。JSON必须符合：' + JSON.stringify(towerDungeonPlanSchema);
}
