/**
 * 统一的选择器描述工具
 * - 支持 hand.|draw.|discard. 前缀
 * - 支持 random/leftmost/rightmost/all/choose/current 系列
 * - 支持数字后缀：leftmost2/rightmost3/random2 等
 * - 支持 all_cards（全部卡牌：手牌+抽牌堆+弃牌堆）
 * - 支持组合：使用 + 连接多个选择器
 */
export function describeSelector(selector: string): string {
  const domainMap: { [k: string]: string } = { hand: '手牌', draw: '抽牌堆', discard: '弃牌堆' };

  const selectors = selector.split('+');
  const descriptions = selectors.map(raw => {
    const s = raw.trim();
    const dm = s.match(/^(hand|draw|discard)\.(.+)$/);
    const core = dm ? dm[2] : s;
    const domainCN = dm ? domainMap[dm[1]] : '';

    switch (core) {
      case 'random':
        return `${domainCN || ''}随机`;
      case 'leftmost':
        return `${domainCN || ''}最左侧`;
      case 'rightmost':
        return `${domainCN || ''}最右侧`;
      case 'all':
        return domainCN ? `所有${domainCN}` : '所有卡牌';
      case 'all_cards':
        return '全部卡牌（手牌+抽牌堆+弃牌堆）';
      case 'current':
        return `${domainCN || ''}当前`;
      case 'current_left':
        return `${domainCN || ''}当前左侧`;
      case 'current_right':
        return `${domainCN || ''}当前右侧`;
      case 'current_adjacent':
        return `${domainCN || ''}当前相邻`;
      case 'choose':
        return `${domainCN || ''}选择`;
      default: {
        const numMatch = core.match(/^(leftmost|rightmost|random)(\d+)$/);
        if (numMatch) {
          const [, type, num] = numMatch;
          const typeDesc = type === 'leftmost' ? '最左侧' : type === 'rightmost' ? '最右侧' : '随机';
          return `${domainCN}${typeDesc}${num}张`;
        }
        return s; // 未知关键字保持原样，便于向后扩展
      }
    }
  });

  return descriptions.join('和');
}
