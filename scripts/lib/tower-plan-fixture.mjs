export const dungeonPlanFixture = {
  spec: 'mwg.tower-dungeon-plan/v1', theme: '镜海高塔', enemyTypes: ['镜灵'], mainSystems: ['折射'], bossDirection: '镜海女王',
  acts: [1, 2, 3].map(act => ({act, theme: `镜海第${act}幕`, enemies: '镜灵守卫', mechanics: '逐层增加折射联动', boss: '守门人', progression: '辨识、组合到破解'})),
};
export const withDungeonPlan = narrative => `<TOWER_DUNGEON_PLAN>${JSON.stringify(dungeonPlanFixture)}</TOWER_DUNGEON_PLAN>\n${narrative}`;
