/** Program-owned partitions of the flat card pool. Authored cards keep their existing contract. */
export interface RewardCardGroup { id: string; indices: number[]; pick: number }

export function readRewardCardGroups(reward: Record<string, any>, cardCount: number): RewardCardGroup[] {
  const value = Number(reward.limits?.cards ?? 1);
  const limit = Number.isInteger(value) && value >= 0 ? value : 1;
  if (reward.card_choice_groups == null) return cardCount
    ? [{id:'cards',indices:Array.from({length:cardCount},(_,i)=>i),pick:Math.min(limit,cardCount)}] : [];
  if (!Array.isArray(reward.card_choice_groups)) throw new Error('卡牌奖励分组必须是数组');
  const ids=new Set<string>(),used=new Set<number>();
  const groups=reward.card_choice_groups.map((entry: any)=>{
    if (!entry || typeof entry.id!=='string' || !entry.id || ids.has(entry.id)
      || !Array.isArray(entry.indices) || !Number.isInteger(entry.pick) || entry.pick<0 || entry.pick>entry.indices.length)
      throw new Error('卡牌奖励分组无效');
    ids.add(entry.id);
    for(const index of entry.indices){
      if(!Number.isInteger(index)||index<0||index>=cardCount||used.has(index))throw new Error('卡牌奖励分组候选无效或重复');
      used.add(index);
    }
    return {id:entry.id,indices:[...entry.indices],pick:entry.pick};
  });
  if(groups.reduce((sum,group)=>sum+group.pick,0)!==limit || used.size!==cardCount)
    throw new Error('卡牌奖励分组与剩余候选或次数不一致');
  return groups;
}

/** Consume only the chosen group; expired alternatives never become another group's options. */
export function planRewardCardGroupClaim(groups: RewardCardGroup[], selected: number[]) {
  const chosen=new Set(selected),removed=new Set(selected);
  const pending:RewardCardGroup[]=[];
  for(const group of groups){
    const count=group.indices.filter(index=>chosen.has(index)).length;
    if(count>group.pick)throw new Error('超过该组卡牌奖励可选次数');
    const pick=group.pick-count;
    pending.push({...group,pick,indices:group.indices.filter(index=>!chosen.has(index))});
  }
  if(selected.some(index=>!groups.some(group=>group.indices.includes(index))))throw new Error('卡牌不属于待领取奖励');
  const sorted=[...removed].sort((a,b)=>a-b);
  return {removed,groups:pending.map(group=>({...group,indices:group.indices.map(index=>index-sorted.filter(value=>value<index).length)}))};
}
