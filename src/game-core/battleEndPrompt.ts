import { formatBattleEndResult, type BattleEndResult } from './battleTerminal';

export interface BattleEndPromptStatus {
  name: string;
  stacks: number;
}

export interface BattleEndPromptCard {
  name: string;
  description: string;
}

export type BattleContinuationMode = 'ordinary' | 'run';

export interface BattleEndPromptInput {
  result: BattleEndResult;
  continuation: BattleContinuationMode;
  narrativeText?: string;
  player: {
    hp: number;
    maxHp: number;
    lust: number;
    maxLust: number;
    energy: number;
    statuses: readonly BattleEndPromptStatus[];
    handCount: number;
    drawPileCount: number;
    discardPileCount: number;
  };
  enemy?: {
    name: string;
    hp: number;
    maxHp: number;
    lust: number;
    maxLust: number;
    statuses: readonly BattleEndPromptStatus[];
  } | null;
  turns: number;
  narrativeCards?: readonly BattleEndPromptCard[];
  rewardBudget?: string;
  buildGuidance?: string;
}

export interface BattleEndPrompt {
  resultText: string;
  battleSummary: string;
  promptedBattleSummary: string;
}

function formatStatuses(statuses: readonly BattleEndPromptStatus[]): string {
  return statuses.map(status => `${status.name}${status.stacks > 1 ? `${status.stacks}层` : ''}`).join('、');
}

function formatResponseRequirement(input: Pick<BattleEndPromptInput, 'result' | 'continuation'>): string {
  if (input.continuation === 'run') {
    if (input.result === 'victory') {
      return '[回复要求] 同一回复内：立即将预算中的奖励候选和经验写入 <UpdateVariable>；不要生成 <Options>，奖励后由路线界面继续。';
    }
    if (input.result === 'defeat') {
      return '[回复要求] 输出剧情和 <UpdateVariable>；不得生成胜利奖励或 <Options>。';
    }
    return '[回复要求] 输出剧情和 <UpdateVariable>；只按事件叙事处理奖励或代价，不要生成 <Options>。';
  }

  if (input.result === 'victory') {
    return '[回复要求] 同一回复内：立即将预算中的奖励候选和经验写入 <UpdateVariable>；另生成2-5个领奖后的剧情行动 <Option>。奖励领取、查看、选择、放弃均不是 <Option>。';
  }
  if (input.result === 'defeat') {
    return '[回复要求] 同一回复内：生成2-5个后续剧情行动 <Option> 和 <UpdateVariable>；不得生成胜利奖励。';
  }
  return '[回复要求] 同一回复内：生成2-5个后续剧情行动 <Option> 和 <UpdateVariable>；只按事件叙事处理奖励或代价。';
}

/** Format the post-battle model prompt without reading UI, MUV or Tavern globals. */
export function formatBattleEndPrompt(input: BattleEndPromptInput): BattleEndPrompt {
  const resultText = formatBattleEndResult(input.result);
  const summary: string[] = [`战斗结束！结果：${resultText}\n`];

  if (input.narrativeText) summary.push(`【叙事】\n${input.narrativeText}\n`);
  summary.push(
    '【玩家状态】\n',
    `- 生命值：${input.player.hp}/${input.player.maxHp}\n`,
    `- 欲望值：${input.player.lust}/${input.player.maxLust}\n`,
    `- 剩余能量：${input.player.energy}\n`,
  );
  if (input.player.statuses.length > 0) {
    summary.push(`- 状态效果：${formatStatuses(input.player.statuses)}\n`);
  }

  if (input.enemy) {
    summary.push(
      '\n【敌人状态】\n',
      `- ${input.enemy.name}：生命值${input.enemy.hp}/${input.enemy.maxHp}，欲望值${input.enemy.lust}/${input.enemy.maxLust}\n`,
    );
    if (input.enemy.statuses.length > 0) {
      summary.push(`- 状态效果：${formatStatuses(input.enemy.statuses)}\n`);
    }
  }

  summary.push(
    '\n【战斗统计】\n',
    `- 持续回合：${input.turns}回合\n`,
    `- 手牌剩余：${input.player.handCount}张\n`,
    `- 抽牌堆：${input.player.drawPileCount}张\n`,
    `- 弃牌堆：${input.player.discardPileCount}张\n`,
  );

  const narrativeCards = input.narrativeCards || [];
  if (narrativeCards.length > 0) {
    summary.push('\n【叙事卡牌使用】\n');
    for (const card of narrativeCards) summary.push(`- 使用了叙事卡牌：${card.name} - ${card.description}\n`);
    summary.push('\n请根据以上详细的战斗结果信息生成后续剧情，体现战斗过程对角色状态的影响。特别注意融入叙事卡牌的使用效果和影响。');
  } else {
    summary.push('\n请根据以上详细的战斗结果信息生成后续剧情，体现战斗过程对角色状态的影响。');
  }

  const rewardLines = [input.rewardBudget, input.buildGuidance].filter(Boolean).join('\n');
  const battleSummary = summary.join('');
  const responseRequirement = formatResponseRequirement(input);
  return {
    resultText,
    battleSummary,
    promptedBattleSummary: `${battleSummary}\n\n[战斗后续] ${input.continuation}\n[战斗结算]${rewardLines ? `\n${rewardLines}` : ''}\n${responseRequirement}`,
  };
}
