// 统一的变量中文映射，避免在多处重复维护
export const variableDisplayMap: { [key: string]: string } = {
  max_hp: '最大生命值',
  max_lust: '最大欲望值',
  max_energy: '最大能量',
  // 当前值/别名
  current_hp: '当前生命值',
  current_lust: '当前欲望值',
  current_energy: '当前能量',
  hp: '生命值',
  lust: '欲望值',
  energy: '当前能量',
  block: '格挡',
  draw: '抽牌数',
  discard: '弃牌数',
  hand_size: '手牌数',
  deck_size: '抽牌堆数',
  discard_pile_size: '弃牌堆数',
  cards_played_this_turn: '本回合出牌数',
  stacks: '层数',
};
