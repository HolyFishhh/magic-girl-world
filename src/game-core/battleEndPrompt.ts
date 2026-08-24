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
    block?: number;
    statuses: readonly BattleEndPromptStatus[];
    handCount: number;
    drawPileCount: number;
    discardPileCount: number;
    exhaustPileCount?: number;
  };
  enemy?: {
    name: string;
    hp: number;
    maxHp: number;
    lust: number;
    maxLust: number;
    block?: number;
    statuses: readonly BattleEndPromptStatus[];
  } | null;
  turns: number;
  battleLog?: string;
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
  const rewardBoundary = input.result === 'victory' ? '奖励和经验由随后运行的 MVU 额外模型按预算登记。' : '不得叙述尚未发生的胜利奖励。';
  const continuation = input.continuation === 'run' ? '远征路线由程序继续。' : '玩家会通过自定义行动继续剧情。';
  return `[剧情模型要求] 只输出战后剧情正文，不输出选项、JSON、<UpdateVariable> 或更新命令。${rewardBoundary}${continuation}`;
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
    `- 最终格挡：${input.player.block ?? 0}\n`,
  );

  if (input.battleLog?.trim()) {
    summary.push('\n【战斗过程】\n', input.battleLog.trim(), '\n');
  }
  if (input.player.statuses.length > 0) {
    summary.push(`- 状态效果：${formatStatuses(input.player.statuses)}\n`);
  }

  if (input.enemy) {
    summary.push(
      '\n【敌人状态】\n',
      `- ${input.enemy.name}：生命值${input.enemy.hp}/${input.enemy.maxHp}，欲望值${input.enemy.lust}/${input.enemy.maxLust}，格挡${input.enemy.block ?? 0}\n`,
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
    `- 消耗堆：${input.player.exhaustPileCount ?? 0}张\n`,
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
