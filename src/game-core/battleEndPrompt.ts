import { formatBattleEndResult, type BattleEndResult } from './battleTerminal';

export interface BattleEndPromptStatus {
  name: string;
  stacks: number;
  duration?: number;
  description?: string;
}

export interface BattleEndPromptCard {
  name: string;
  description: string;
}

export interface BattleEndPromptAsset {
  name: string;
  count?: number;
  description?: string;
}

export type BattleContinuationMode = 'ordinary' | 'run';

export interface BattleEndPromptInput {
  result: BattleEndResult;
  continuation: BattleContinuationMode;
  narrativeText?: string;
  playerContinuation?: string;
  player: {
    hp: number;
    maxHp: number;
    lust: number;
    maxLust: number;
    energy: number;
    maxEnergy?: number;
    drawPerTurn?: number;
    block?: number;
    statuses: readonly BattleEndPromptStatus[];
    handCount: number;
    drawPileCount: number;
    discardPileCount: number;
    exhaustPileCount?: number;
    cards?: readonly BattleEndPromptAsset[];
    relics?: readonly BattleEndPromptAsset[];
    abilities?: readonly BattleEndPromptAsset[];
    items?: readonly BattleEndPromptAsset[];
    desireEffect?: string;
  };
  enemy?: {
    name: string;
    hp: number;
    maxHp: number;
    lust: number;
    maxLust: number;
    energy?: number;
    maxEnergy?: number;
    block?: number;
    statuses: readonly BattleEndPromptStatus[];
    actions?: readonly BattleEndPromptAsset[];
    abilities?: readonly BattleEndPromptAsset[];
    desireEffect?: string;
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
  return statuses
    .map(status => {
      const stacks = status.stacks > 1 ? `${status.stacks}层` : '';
      const duration = Number.isFinite(status.duration) ? `剩余${Math.max(0, Math.floor(status.duration!))}回合` : '';
      const description = String(status.description || '')
        .replace(/\s+/g, ' ')
        .trim();
      const compactDescription = description.length > 72 ? `${description.slice(0, 71)}…` : description;
      const details = [duration, compactDescription].filter(Boolean).join('；');
      return `${status.name}${stacks}${details ? `（${details}）` : ''}`;
    })
    .join('、');
}

function formatAssets(assets: readonly BattleEndPromptAsset[] | undefined): string {
  if (!assets?.length) return '无';
  return assets
    .map(asset => {
      const count = (asset.count ?? 1) > 1 ? `×${asset.count}` : '';
      const description = String(asset.description || '').replace(/\s+/g, ' ').trim();
      return `${asset.name}${count}${description ? `（${description}）` : ''}`;
    })
    .join('、');
}

/** Format the post-battle model prompt without reading UI, MUV or Tavern globals. */
export function formatBattleEndPrompt(input: BattleEndPromptInput): BattleEndPrompt {
  const resultText = formatBattleEndResult(input.result);
  const summary: string[] = [
    '请根据以下按回合战斗摘要，先把本场战斗从开端到结果完整剧情化，再自然衔接后续剧情。必须覆盖摘要中的每个回合，避免从开战直接跳到结算；同一回合的事件可以组织为连贯场景。摘要只记录关键事件，因此可以合理补充招式细节、动作衔接、场景反馈与角色反应，但不得改写既定胜负、回合中的关键行动、最终状态或玩家明确指定的后续行动。正文不要机械复述日志或逐条报数。\n',
    `【战斗结果】${resultText}\n`,
  ];

  summary.push(`\n【按回合战斗摘要】\n${input.battleLog?.trim() || '- 无可用战斗事件记录'}\n`);
  summary.push(
    '\n【本局构筑与资源】\n',
    `- 卡牌：${formatAssets(input.player.cards)}\n`,
    `- 遗物：${formatAssets(input.player.relics)}\n`,
    `- 能力：${formatAssets(input.player.abilities)}\n`,
    `- 道具：${formatAssets(input.player.items)}\n`,
    `- 玩家欲望效果：${input.player.desireEffect || '无'}\n`,
  );
  if (input.enemy) {
    summary.push(
      `- 敌方行动：${formatAssets(input.enemy.actions)}\n`,
      `- 敌方能力：${formatAssets(input.enemy.abilities)}\n`,
      `- 敌方欲望效果：${input.enemy.desireEffect || '无'}\n`,
    );
  }

  if (input.playerContinuation?.trim()) {
    summary.push(`\n【玩家指定的战后行动】${input.playerContinuation.trim()}\n`);
  }
  if (input.narrativeText) summary.push(`\n【确定的战斗叙事】${input.narrativeText}\n`);

  const narrativeCards = input.narrativeCards || [];
  if (narrativeCards.length > 0) {
    summary.push('\n【叙事卡牌使用】\n');
    for (const card of narrativeCards) summary.push(`- ${card.name}：${card.description}\n`);
  }

  summary.push(
    `\n【最终状态｜持续${input.turns}回合】\n`,
    '玩家：\n',
    `- 生命值：${input.player.hp}/${input.player.maxHp}\n`,
    `- 欲望值：${input.player.lust}/${input.player.maxLust}\n`,
    `- 剩余能量：${input.player.energy}${input.player.maxEnergy === undefined ? '' : `/${input.player.maxEnergy}`}\n`,
    ...(input.player.drawPerTurn === undefined ? [] : [`- 每回合抽牌：${input.player.drawPerTurn}张\n`]),
    `- 最终格挡：${input.player.block ?? 0}\n`,
    `- 当前状态：${formatStatuses(input.player.statuses) || '无'}\n`,
    `- 手牌：${input.player.handCount}张；抽牌堆：${input.player.drawPileCount}张；弃牌堆：${input.player.discardPileCount}张；消耗堆：${input.player.exhaustPileCount ?? 0}张\n`,
  );

  if (input.enemy) {
    summary.push(
      '敌方：\n',
      `- ${input.enemy.name}：生命值${input.enemy.hp}/${input.enemy.maxHp}，欲望值${input.enemy.lust}/${input.enemy.maxLust}，能量${input.enemy.energy ?? 0}${input.enemy.maxEnergy === undefined ? '' : `/${input.enemy.maxEnergy}`}，格挡${input.enemy.block ?? 0}\n`,
      `- 当前状态：${formatStatuses(input.enemy.statuses) || '无'}\n`,
    );
  } else {
    summary.push('敌方：无\n');
  }

  const battleSummary = summary.join('');
  return {
    resultText,
    battleSummary,
    // Reward budgets and variable-only instructions travel through reward.request.
    // The story model receives only settled facts and the complete battle log.
    promptedBattleSummary: battleSummary,
  };
}
