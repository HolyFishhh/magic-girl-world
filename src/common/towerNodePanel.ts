import { describeOpeningDeckTransforms } from '../game-core/contentDescription';
import { expandBuiltinStatusDefinitions } from '../game-core/builtinStatusCatalog';
import {
  createTowerFinale,
  describeCardCost,
  planTowerEventOutcome,
  planTowerEventResourceSettlement,
  planTowerOpeningOutcome,
  type RunNodeKind,
  type RunState,
} from '../game-core';
import { presentCompactContent } from '../game-core/contentPresentation';
import type { ContentRuleReference } from '../game-core/contentDescription';
import { parseTowerEventFlow, requireTowerEventStage } from '../game-core/towerEventFlow';
import { describeNonCombatSettlement } from '../game-core/nonCombatSettlementDisplay';
import { planNonCombatCosts } from '../game-core/nonCombatSettlement';
import { hasSelectableRewards } from './rewardTransactions';
import { renderCardFace } from '../shared/cardFace';
import { renderSupportDetails } from '../shared/supportPresentation';
import { escapeHtml } from '../fish/shared/html';
import { renderRulePills } from '../shared/rulePills';
import { collectCardDisplayNames } from '../game-core/cardDisplayNames';
import { collectSummonDisplayNames } from '../game-core/summonDisplayNames';
import { collectStanceDefinitions, collectStanceNames } from '../game-core/stanceIdentityDisplay';
import { BATTLE_ITEM_USAGE_LABEL } from '../game-core/battleItemUsage';
import { CAMPFIRE_RULES } from '../game-core/towerCampfire';
import { availableTowerMemoryCards } from '../runtime/towerCardMemory';
import { bindRewardSelectionSurface, createRewardPreviewPill, createRewardSelectionOption, refreshRewardSelectionSurfaces, rewardPreviewLabel } from '../shared/rewardSelectionInteraction';

export type TowerRestCardAction = 'upgrade' | 'remove' | 'duplicate' | 'transform';

export interface TowerNodePanelCallbacks {
  onInitialArtifactAcquisition?: () => void;
  onOpeningChoice?: (choiceId: string) => void;
  onRetryOpening?: () => void;
  onEventChoice?: (choiceId: string) => void;
  onRestHeal?: () => void;
  onRestAction?: (action: 'train' | 'scavenge' | 'recall', cardId?: string) => void;
  onRestCardAction?: (action: TowerRestCardAction, card: Record<string, any>) => void;
  onLeaveShop?: () => void;
  onShopRemove?: (runInstanceId: string) => void;
  onRestart?: () => void;
  onContinueStory?: (input: string) => Promise<void>;
}

export interface TowerNodePanelOptions {
  root: HTMLElement;
  stat: Record<string, any>;
  run: RunState;
  isLatest: boolean;
  busy?: boolean;
  callbacks?: TowerNodePanelCallbacks;
}

const NODE_COPY: Readonly<Record<RunNodeKind, { icon: string; label: string }>> = {
  battle: { icon: '⚔', label: '战斗' },
  elite: { icon: '♜', label: '精英' },
  event: { icon: '❔', label: '事件' },
  rest: { icon: '♨', label: '篝火' },
  shop: { icon: '⚖', label: '商店' },
  treasure: { icon: '◆', label: '宝箱' },
  boss: { icon: '♛', label: '首领' },
};

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Match persistence-time expansion while rendering a candidate before it is claimed. */
function displayStatuses(content: unknown, ...values: unknown[]): Record<string, any>[] {
  return expandBuiltinStatusDefinitions(values.flatMap(list), content)
    .filter(isRecord) as Record<string, any>[];
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function appendInlineText(document: Document, parent: HTMLElement, value: string): void {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parent.append(document.createTextNode(value.slice(cursor, index)));
    const token = match[0];
    if (token.startsWith('**')) parent.append(createElement(document, 'strong', '', token.slice(2, -2)));
    else if (token.startsWith('`')) parent.append(createElement(document, 'code', '', token.slice(1, -1)));
    else parent.append(createElement(document, 'em', '', token.slice(1, -1)));
    cursor = index + token.length;
  }
  if (cursor < value.length) parent.append(document.createTextNode(value.slice(cursor)));
}

/** Small safe Markdown-like renderer for model prose; it never uses innerHTML. */
function createNarrative(document: Document, value: string, className = 'tower-node-narrative'): HTMLElement {
  const root = createElement(document, 'div', `${className} tower-node-richtext`);
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: HTMLUListElement | null = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = createElement(document, 'p');
    paragraph.forEach((line, index) => {
      if (index) p.append(document.createElement('br'));
      appendInlineText(document, p, line);
    });
    root.append(p);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    root.append(list);
    list = null;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const tag = `h${Math.min(4, heading[1].length + 2)}` as 'h3' | 'h4';
      const element = createElement(document, tag);
      appendInlineText(document, element, heading[2]);
      root.append(element);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list ??= createElement(document, 'ul');
      const item = createElement(document, 'li');
      appendInlineText(document, item, bullet[1]);
      list.append(item);
      continue;
    }
    const quote = line.match(/^>\s*(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      const block = createElement(document, 'blockquote');
      appendInlineText(document, block, quote[1]);
      root.append(block);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return root;
}

function text(value: unknown, fallback = ''): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function list(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  return Object.values(value).filter(isRecord);
}

function rewardNames(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const result: string[] = [];
  const append = (kind: 'card' | 'relic' | 'item', source: unknown) => {
    result.push(...list(source).map(entry => rewardPreviewLabel(kind, entry)));
  };
  append('card', value.cards ?? value.card);
  append('relic', value.artifacts ?? value.artifact);
  append('item', value.items ?? value.item);
  return result;
}

function isRewardSummary(line: string): boolean {
  return /^(卡牌|遗物|道具)：/.test(line);
}

function appendOutcomeSummary(
  document: Document,
  container: HTMLElement,
  line: string,
  details?: HTMLDetailsElement,
): void {
  const tone = /(?:^|：)[^+\n]*-|结束本次冒险/.test(line) ? 'is-cost' : 'is-gain';
  if (details && (isRewardSummary(line) || line.includes('逐张永久转化'))) {
    const pill = createRewardPreviewPill(document, details, line);
    pill.className = `${pill.className} ${tone}`;
    container.append(pill);
    return;
  }
  container.append(createElement(document, 'em', tone, line));
}

function delta(label: string, value: number, unit = ''): string | null {
  if (!value) return null;
  return `${label}${value > 0 ? '+' : ''}${value}${unit}`;
}

function openingOutcomeSummary(value: unknown, battle: Record<string, any> = {}): { lines: string[]; error: string } {
  try {
    const outcome = planTowerOpeningOutcome(value);
    return {
      lines: [
        delta('生命', outcome.hpDelta),
        delta('生命上限', outcome.maxHpDelta),
        delta('欲望', outcome.lustDelta),
        delta('欲望上限', outcome.maxLustDelta),
        delta('金币', outcome.goldDelta),
        delta(outcome.cardRemovalDelta > 0 ? '删卡次数（获得后立即选择，未确认保留）' : '删卡次数', outcome.cardRemovalDelta),
        ...describeOpeningDeckTransforms(outcome.deckTransforms, list(battle.cards)),
        ...rewardNames(outcome.reward),
      ].filter((entry): entry is string => Boolean(entry)),
      error: '',
    };
  } catch (error) {
    return { lines: [], error: error instanceof Error ? error.message : '馈赠结果无效' };
  }
}

function eventOutcomeSummary(value: unknown, battle: unknown): { lines: string[]; error: string } {
  try {
    const outcome = planTowerEventOutcome(value);
    const core = isRecord(battle) && isRecord(battle.core) ? battle.core : {};
    const resourceSettlement = planTowerEventResourceSettlement(outcome.resourceDeltas, core.resources);
    const shortage = resourceSettlement.shortage;
    return {
      lines: [
        delta('生命', outcome.hpDelta),
        delta('生命上限', outcome.maxHpDelta),
        delta('欲望', outcome.lustDelta),
        delta('金币', outcome.goldDelta),
        delta(outcome.cardRemovalDelta > 0 ? '删卡次数（获得后立即选择，未确认保留）' : '删卡次数', outcome.cardRemovalDelta),
        ...outcome.grantedCards.map(card => {
          const quantity = Number.isInteger(Number(card.quantity)) && Number(card.quantity) > 0 ? Number(card.quantity) : 1;
          return `获得${card.type === 'Curse' ? '诅咒' : '卡牌'}：${card.name || card.id} ×${quantity}`;
        }),
        delta('欲望上限', outcome.maxLustDelta),
        describeNonCombatSettlement({ cost: isRecord(value) ? value.cost : undefined,
          deck_actions: isRecord(value) ? value.deck_actions : undefined,
          grant: isRecord(value) ? value.grant : undefined }, {
          resourceNames: Object.fromEntries(list(core.resources).map(resource => [resource.id, resource.name])),
        }),
        ...resourceSettlement.changes.map(change =>
          delta(`${change.emoji || '◆'}${change.name}`, change.delta),
        ),
        ...rewardNames(outcome.reward),
        ...(outcome.routeOutcome === 'failed' ? ['此选择会结束本次冒险'] : []),
      ].filter((entry): entry is string => Boolean(entry)),
      error: shortage
        ? `${shortage.name}不足：需要 ${shortage.required}，当前只有 ${shortage.available}`
        : '',
    };
  } catch (error) {
    return { lines: [], error: error instanceof Error ? error.message : '事件结果无效' };
  }
}

/** Costs are public before a choice; every other event outcome stays concealed. */
function eventChoiceCostSummary(value: unknown, battle: unknown): { lines: string[]; error: string } {
  try {
    const outcome = planTowerEventOutcome(value);
    const core = isRecord(battle) && isRecord(battle.core) ? battle.core : {};
    const resourceNames = Object.fromEntries(
      list(core.resources).map(resource => [text(resource.id), text(resource.name, text(resource.id))]),
    );
    const costs = [
      outcome.cost.hp ? `支付${outcome.cost.hp}点生命` : '',
      outcome.cost.maxHp ? `支付${outcome.cost.maxHp}点生命上限` : '',
      outcome.cost.gold ? `支付${outcome.cost.gold}金币` : '',
      ...Object.entries(outcome.cost.resources).map(([id, amount]) => `支付${amount}${resourceNames[id] || id}`),
    ].filter((entry): entry is string => Boolean(entry));
    return { lines: costs, error: '' };
  } catch (error) {
    return { lines: [], error: error instanceof Error ? error.message : '事件结果无效' };
  }
}

function createPanelHeader(document: Document, icon: string, kicker: string, title: string): HTMLElement {
  const header = createElement(document, 'header', 'tower-node-panel-header');
  header.append(createElement(document, 'span', 'tower-node-panel-icon', icon));
  const copy = createElement(document, 'div', 'tower-node-panel-heading');
  copy.append(createElement(document, 'small', '', kicker));
  copy.append(createElement(document, 'h2', '', title));
  header.append(copy);
  return header;
}

function createChoiceButton(
  document: Document,
  choice: Record<string, any>,
  summary: { lines: string[]; error: string },
  disabled: boolean,
  onSelect: (() => void) | undefined,
): HTMLElement {
  const panel = createElement(document, 'article', 'tower-story-choice');
  const button = createElement(document, 'button', 'tower-story-choice-select');
  button.type = 'button';
  button.disabled = disabled || Boolean(summary.error) || !onSelect;
  button.dataset.choiceId = String(choice.id || '');
  const main = createElement(document, 'span', 'tower-story-choice-main');
  main.append(createElement(document, 'strong', '', text(choice.label, '未命名选项')));
  const description = text(choice.description);
  if (description) main.append(createElement(document, 'span', 'tower-story-choice-flavor', description));
  button.append(main);
  if (summary.lines.length) {
    const costs = createElement(document, 'span', 'tower-story-choice-effects tower-story-choice-costs');
    costs.append(createElement(document, 'small', '', '代价'));
    summary.lines.forEach(line => costs.append(createElement(document, 'em', 'is-cost', line)));
    button.append(costs);
  }
  // Commit the story decision before revealing its private outcome.
  panel.append(button);
  if (summary.error) button.append(createElement(document, 'span', 'tower-story-choice-error', '当前条件无法选择'));
  if (onSelect) button.addEventListener('click', onSelect);
  return panel;
}

/** Opening gifts are claimed through the ordinary reward face controller. */
function createOpeningChoice(
  document: Document,
  choice: Record<string, any>,
  summary: { lines: string[]; error: string },
  disabled: boolean,
  onClaim: (() => void) | undefined,
  battle: Record<string, any> = {},
): HTMLElement {
  const reward = isRecord(choice.outcome) && isRecord(choice.outcome.reward) ? choice.outcome.reward : {};
  const transformTargets = list(choice.outcome?.deck_transforms).map(action => action.replacement).filter(isRecord);
  const previewEntries = [
    ['card', [...list(reward.cards ?? reward.card), ...transformTargets]], ['content', reward.artifacts ?? reward.artifact], ['item', reward.items ?? reward.item],
  ] as const;
  const previewCount = previewEntries.reduce((count, [, values]) => count + list(values).length, 0);
  const { option: panel, input, preview } = createRewardSelectionOption(document, {
    value: text(choice.id),
    label: text(choice.label, '未命名选项'),
    previewLabel: rewardNames(reward).join(' · ') || (list(choice.outcome?.deck_transforms).length ? '查看转化目标卡牌' : '馈赠'),
    disabled: disabled || Boolean(summary.error) || !onClaim,
    className: 'tower-story-choice tower-opening-choice',
    ariaLabel: `选择馈赠：${text(choice.label, '未命名选项')}`,
  });
  input.dataset.choiceId = text(choice.id);
  const details = preview.parentElement as HTMLDetailsElement;
  const pick = input.parentElement as HTMLElement;
  pick.className = 'reward-pick tower-opening-choice-pick';
  const main = pick.querySelector('span') as HTMLElement;
  main.className = 'tower-story-choice-main';
  const description = text(choice.description);
  if (description) pick.append(createElement(document, 'span', 'tower-story-choice-flavor', description));
  if (summary.lines.length) {
    const effects = createElement(document, 'span', 'tower-story-choice-effects');
    effects.append(createElement(document, 'small', '', '实际变化：'));
    summary.lines.forEach(line => appendOutcomeSummary(document, effects, line, details));
    pick.append(effects);
  }

  preview.className = 'tower-opening-choice-rewards';
  for (const [kind, values] of previewEntries) {
    for (const value of list(values)) {
      const statuses = displayStatuses(value, battle.statuses, reward.statuses, value.statuses, value.status)
        .filter(status => typeof status.id === 'string' && status.id.trim());
      const resources = list(battle.core?.resources);
      const references: ContentRuleReference[] = [];
      const descriptionOptions = {
        inlineStatusDetails: false,
        cardNames: collectCardDisplayNames(battle, value),
        summonNames: collectSummonDisplayNames(battle, value),
        stanceNames: collectStanceNames(battle, value),
        stanceDefinitions: collectStanceDefinitions(battle, value),
        onSummonReference: (reference: ContentRuleReference) => references.push(reference),
        statusNames: Object.fromEntries(statuses.map(status => [status.id, text(status.name, status.id)])),
        statusDefinitions: Object.fromEntries(statuses.map(status => [status.id, status])),
        resourceNames: Object.fromEntries(resources.map(resource => [resource.id, text(resource.name, resource.id)])),
        resourceEmojis: Object.fromEntries(resources.map(resource => [resource.id, text(resource.emoji)])),
      };
      const presentation = presentCompactContent(value, kind, descriptionOptions);
      const face = createElement(document, 'span', kind === 'card' ? 'collection-card tower-choice-content' : 'collection-support tower-choice-content');
      const content = { ...value, description: presentation.flavorText };
      face.innerHTML = kind === 'card'
        ? renderCardFace(content, {
            costLabel: value.type === 'Curse' ? '—' : describeCardCost(value.cost, Object.fromEntries(resources.map(resource => [resource.id, resource]))),
            rarityLabel: ({Common:'普通',Uncommon:'罕见',Rare:'稀有',Epic:'史诗',Legendary:'传说',Corrupt:'腐化'} as Record<string,string>)[value.rarity] || '普通', typeLabel: ({ Attack: '攻击', Skill: '技能', Power: '能力', Curse: '诅咒', Event: '事件' } as Record<string,string>)[value.type] || '技能',
            rulesHtml: renderRulePills(presentation.rulesGroups, [...references, ...statuses.map(status => ({ id: status.id, name: status.name, rules: presentCompactContent(status, 'status', { ...descriptionOptions, onSummonReference: undefined }).rulesText, flavor: status.description }))]), quantity: value.quantity || 1,
          })
        : renderSupportDetails(content, {
            kind: kind === 'item' ? '道具' : '遗物',
            rulesHtml: renderRulePills(presentation.rulesGroups.length ? presentation.rulesGroups : ['暂无可显示的结构化规则'], [...references, ...statuses.map(status => ({ id: status.id, name: status.name, rules: presentCompactContent(status, 'status', { ...descriptionOptions, onSummonReference: undefined }).rulesText, flavor: status.description }))]),
            extraHtml: presentation.usageText ? `<p class="item-usage">${BATTLE_ITEM_USAGE_LABEL}</p>` : '',
          });
      if (transformTargets.includes(value)) preview.append(createElement(document, 'strong', 'tower-transform-target-label', '转化目标：每张原牌转为1张'));
      preview.append(face);
    }
  }
  if (summary.error) panel.append(createElement(document, 'span', 'tower-story-choice-error', summary.error));
  if (onClaim) bindRewardSelectionSurface(input);
  refreshRewardSelectionSurfaces(panel);
  return panel;
}

function renderOpening(options: TowerNodePanelOptions, shell: HTMLElement): boolean {
  const { run, isLatest, busy, callbacks } = options;
  const opening = run.opening;
  if (opening.phase === 'consumed' || opening.phase === 'skipped') return false;
  const document = options.root.ownerDocument;
  shell.dataset.panel = 'opening';
  shell.dataset.phase = opening.phase;

  if (opening.phase === 'ready' && isRecord(opening.content)) {
    shell.append(createPanelHeader(document, '✦', `第 ${run.act} 幕开幕馈赠`, text(opening.content.title, '旅途开始之前')));
    const narrativePhase = opening.narrativePhase;
    const waitingForPreset = narrativePhase === 'pending' || narrativePhase === 'generating';
    if (waitingForPreset) {
      const state = createElement(document, 'div', `tower-node-generation is-${narrativePhase}`);
      state.append(createElement(document, 'span', 'tower-node-spinner'));
      state.append(createElement(document, 'p', '', '正在使用当前预设生成本幕剧情，完成后即可选择馈赠。'));
      shell.append(state);
    } else {
      if (narrativePhase === 'failed') {
        shell.append(createElement(
          document,
          'p',
          'tower-node-error',
          `原预设剧情生成失败，已保留事件摘要：${text(opening.narrativeError, '可继续选择，不影响本局。')}`,
        ));
      }
    }
    if (hasSelectableRewards(options.stat)) {
      shell.append(createElement(document, 'p', 'tower-node-generation', '请先领取上一幕剩余战利品，再选择本幕馈赠。'));
      return true;
    }
    const choices = Array.isArray(opening.content.choices) ? opening.content.choices.filter(isRecord) : [];
    const choiceGrid = createElement(document, 'div', 'tower-story-choices');
    for (const choice of choices) {
      const id = text(choice.id);
      choiceGrid.append(
        createOpeningChoice(
          document,
          choice,
          openingOutcomeSummary(choice.outcome, options.stat.battle),
          !isLatest || Boolean(busy) || waitingForPreset,
          id && callbacks?.onOpeningChoice ? () => callbacks.onOpeningChoice?.(id) : undefined,
          options.stat.battle,
        ),
      );
    }
    if (choices.length === 0) shell.append(createElement(document, 'p', 'tower-node-error', '开局馈赠没有可用选项。'));
    else {
      shell.append(choiceGrid);
      const inputs = Array.from(choiceGrid.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      let selectedChoiceId = '';
      const confirm = createElement(document, 'button', 'tower-node-primary tower-opening-confirm', '确认领取馈赠并恢复生命');
      confirm.type = 'button';
      confirm.disabled = true;
      inputs.forEach(input => {
        input.addEventListener('change', () => {
          if (input.checked) {
            inputs.forEach(other => { if (other !== input) other.checked = false; });
            selectedChoiceId = input.value;
          } else if (selectedChoiceId === input.value) selectedChoiceId = '';
          refreshRewardSelectionSurfaces(choiceGrid);
          confirm.disabled = !selectedChoiceId || Boolean(busy) || !isLatest || !callbacks?.onOpeningChoice;
        });
      });
      confirm.addEventListener('click', () => {
        if (!selectedChoiceId || confirm.disabled) return;
        confirm.disabled = true;
        inputs.forEach(input => { input.disabled = true; });
        refreshRewardSelectionSurfaces(choiceGrid);
        callbacks?.onOpeningChoice?.(selectedChoiceId);
      });
      shell.append(confirm);
    }
    return true;
  }

  const phaseCopy = {
    pending: ['馈赠已在准备队列中', '后台会根据当前世界、角色和本幕构筑生成选择。'],
    generating: ['正在生成开幕馈赠', '生成不会阻塞页面；完成后选项会自动出现在这里。'],
    failed: ['开幕馈赠生成失败', text(opening.error, '可以安全重试，不会重置地图或牌组。')],
  } as const;
  const copy = phaseCopy[opening.phase as keyof typeof phaseCopy] ?? ['正在准备爬塔开局', '请稍候。'];
  shell.append(createPanelHeader(document, opening.phase === 'failed' ? '!' : '✦', `第 ${run.act} 幕开幕馈赠`, copy[0]));
  const state = createElement(document, 'div', `tower-node-generation is-${opening.phase}`);
  if (opening.phase !== 'failed') state.append(createElement(document, 'span', 'tower-node-spinner'));
  state.append(createElement(document, 'p', '', copy[1]));
  if (['failed', 'pending'].includes(opening.phase) && isLatest && callbacks?.onRetryOpening) {
    const retry = createElement(document, 'button', 'tower-node-primary', opening.phase === 'pending' ? '继续准备本幕馈赠' : '重试馈赠生成');
    retry.type = 'button';
    retry.disabled = Boolean(busy);
    retry.addEventListener('click', () => callbacks.onRetryOpening?.());
    state.append(retry);
  }
  shell.append(state);
  return true;
}

function appendNarrative(
  document: Document,
  shell: HTMLElement,
  stat: Record<string, any>,
  kind: RunNodeKind,
  collapsed = false,
): void {
  const active = isRecord(stat.run_node) ? stat.run_node : {};
  const narrative = text(active.narrative);
  // The shared story panel owns the latest narrative and its history.
  const payload = isRecord(stat[`run_${kind}`]) ? stat[`run_${kind}`] : {};
  const description = text(payload.description);
  if (description && description !== narrative)
    shell.append(createNarrative(document, description, 'tower-node-description'));
}

function renderEvent(options: TowerNodePanelOptions, shell: HTMLElement): void {
  const { stat, isLatest, busy, callbacks } = options;
  const document = options.root.ownerDocument;
  const event = isRecord(stat.run_event) ? stat.run_event : {};
  if (stat.run_result != null || text(event.selected_choice_id)) {
    renderEventReveal(options, shell);
    const pending = createElement(document, 'div', 'tower-node-callout');
    pending.append(createElement(document, 'strong', '', '事件选择已确定'));
    pending.append(createElement(document, 'span', '', '完成下方奖励选择后，路线会自动继续。'));
    shell.append(pending);
    return;
  }
  let choices: Record<string, any>[] = [];
  try {
    const flow = parseTowerEventFlow(event, planTowerEventOutcome);
    const stage = requireTowerEventStage(flow, stat.run_event_state?.stage_id ?? flow.startStage);
    choices = stage.choices;
    if (stage.narrative) shell.append(createNarrative(document, stage.narrative, 'tower-node-description'));
  } catch (error) {
    shell.append(createElement(document, 'p', 'tower-node-error', error instanceof Error ? error.message : '事件阶段无效'));
    return;
  }
  const grid = createElement(document, 'div', 'tower-story-choices');
  for (const choice of choices) {
    const id = text(choice.id);
    const summary = eventChoiceCostSummary(choice.outcome, stat.battle);
    try {
      const plan = planTowerEventOutcome(choice.outcome);
      const core = stat.battle?.core ?? {};
      planNonCombatCosts(plan.cost, { ...core, lust: core.lust ?? 0, max_lust: core.max_lust ?? 1,
        gold: stat.run?.gold ?? 0 });
    } catch (error) { summary.error = error instanceof Error ? error.message : '当前条件不足'; }
    grid.append(
      createChoiceButton(
        document,
        choice,
        summary,
        !isLatest || Boolean(busy),
        id && callbacks?.onEventChoice ? () => callbacks.onEventChoice?.(id) : undefined,
      ),
    );
  }
  if (choices.length) shell.append(grid);
  else shell.append(createElement(document, 'p', 'tower-node-error', '这个事件没有可用选项。'));
}

function renderEventReveal(options: TowerNodePanelOptions, shell: HTMLElement): boolean {
  const { stat } = options;
  if (!isRecord(stat.run_event_reveal) || !isRecord(stat.run_event_reveal.outcome)) return false;
  const document = options.root.ownerDocument;
  const reveal = stat.run_event_reveal;
  const result = createElement(document, 'div', 'tower-node-callout tower-event-result');
  result.append(createElement(document, 'strong', '', `事件结果 · ${text(reveal.label, '已作出选择')}`));
  for (const line of eventOutcomeSummary(reveal.outcome, stat.battle).lines) {
    appendOutcomeSummary(document, result, line);
  }
  const statuses = displayStatuses(reveal.outcome, stat.battle?.statuses);
  const resources: Record<string, any> = Object.fromEntries(list(stat.battle?.core?.resources).map(resource => [resource.id, resource]));
  for (const card of list(reveal.outcome.gain_cards)) {
    const definitions = displayStatuses(card, statuses, card.statuses, card.status);
    const references: ContentRuleReference[] = [];
    const descriptionOptions = {
      onSummonReference: (reference: ContentRuleReference) => references.push(reference),
      statusNames: Object.fromEntries(definitions.map(status => [status.id, status.name])),
      statusDefinitions: Object.fromEntries(definitions.map(status => [status.id, status])),
      resourceNames: Object.fromEntries(Object.entries(resources).map(([id, resource]) => [id, resource.name])),
      resourceEmojis: Object.fromEntries(Object.entries(resources).map(([id, resource]) => [id, resource.emoji])),
      cardNames: collectCardDisplayNames(stat.battle, card), summonNames: collectSummonDisplayNames(stat.battle, card),
      stanceNames: collectStanceNames(stat.battle, card),
      stanceDefinitions: collectStanceDefinitions(stat.battle, card),
    };
    const presentation = presentCompactContent(card, 'card', descriptionOptions);
    const face = createElement(document, 'div', 'collection-card');
    face.innerHTML = renderCardFace({ ...card, description: presentation.flavorText }, {
      costLabel: card.type === 'Curse' ? '—' : describeCardCost(card.cost, resources),
      typeLabel: ({ Attack: '攻击', Skill: '技能', Power: '能力', Curse: '诅咒', Event: '事件' } as Record<string, string>)[card.type] || '卡牌',
      rarityLabel: ({ Common: '普通', Uncommon: '罕见', Rare: '稀有', Epic: '史诗', Legendary: '传说', Corrupt: '腐化' } as Record<string, string>)[card.rarity] || '普通',
      rulesHtml: renderRulePills(presentation.rulesGroups, [...references, ...definitions.map(status => ({ id: status.id, name: status.name,
        rules: presentCompactContent(status, 'status', { ...descriptionOptions, onSummonReference: undefined }).rulesText, flavor: status.description }))]),
      quantity: card.quantity || 1,
    });
    result.append(face);
  }
  shell.append(result);
  return true;
}

function renderRest(options: TowerNodePanelOptions, shell: HTMLElement): void {
  const { stat, run, isLatest, busy, callbacks } = options;
  const document = options.root.ownerDocument;
  const actions = createElement(document, 'div', 'tower-rest-main-actions');
  const heal = createElement(document, 'button', 'tower-node-primary', '休息 · 恢复 30% 最大生命');
  heal.type = 'button'; heal.disabled = !isLatest || Boolean(busy) || !callbacks?.onRestHeal;
  heal.addEventListener('click', () => callbacks?.onRestHeal?.()); actions.append(heal);
  for (const [action, label] of [['train', `锻炼 · 生命上限 +${CAMPFIRE_RULES.maxHpGain}`], ['scavenge', `搜刮 · 获得 ${CAMPFIRE_RULES.goldMinimum}–${CAMPFIRE_RULES.goldMaximum} 金币`]] as const) {
    const button = createElement(document, 'button', 'tower-node-primary', label);
    button.type = 'button'; button.disabled = !isLatest || Boolean(busy) || !callbacks?.onRestAction;
    button.addEventListener('click', () => callbacks?.onRestAction?.(action)); actions.append(button);
  }
  shell.append(createElement(document, 'p', 'tower-node-muted', '只能完成一件事。锻炼增加生命上限，当前生命保持不变。'));
  shell.append(actions);
  const cards = availableTowerMemoryCards(stat, run.currentNode?.id || '', 'recall');
  const recall = createElement(document, 'details', 'tower-campfire-recall');
  recall.append(createElement(document, 'summary', '', '回忆 · 取回一张曾经错过的牌'));
  const memoryList = createElement(document, 'div', 'tower-campfire-memory-cards');
  for (const card of cards) {
    const entry = createElement(document, 'article', 'tower-campfire-memory-card');
    const face = createElement(document, 'div');
    const references: ContentRuleReference[] = [];
    const statuses = displayStatuses(card, stat.battle?.statuses);
    const presentation = presentCompactContent(card, 'card', {
      cardNames: collectCardDisplayNames(stat.battle, card), summonNames: collectSummonDisplayNames(stat.battle, card),
      stanceNames: collectStanceNames(stat.battle, card), stanceDefinitions: collectStanceDefinitions(stat.battle, card),
      onSummonReference: reference => references.push(reference),
      statusNames: Object.fromEntries(statuses.map(status => [status.id, status.name])),
      statusDefinitions: Object.fromEntries(statuses.map(status => [status.id, status])),
      resourceNames: Object.fromEntries(list(stat.battle?.core?.resources).map(resource => [resource.id, resource.name])),
      resourceEmojis: Object.fromEntries(list(stat.battle?.core?.resources).map(resource => [resource.id, resource.emoji])),
    });
    face.innerHTML = renderCardFace(card, {
      costLabel: card.type === 'Curse' ? '—' : describeCardCost(card.cost),
      rarityLabel: ({ Common: '普通', Uncommon: '罕见', Rare: '稀有', Epic: '史诗', Legendary: '传说', Corrupt: '诅咒' } as Record<string, string>)[card.rarity] || '普通',
      typeLabel: ({ Attack: '攻击', Skill: '技能', Power: '能力', Event: '事件', Curse: '诅咒' } as Record<string, string>)[card.type] || '技能',
      rulesHtml: renderRulePills(presentation.rulesGroups, references),
    });
    const button = createElement(document, 'button', 'tower-node-primary', `回忆 ${text(card.name)}`);
    button.type = 'button'; button.disabled = !isLatest || Boolean(busy) || !callbacks?.onRestAction;
    button.addEventListener('click', () => callbacks?.onRestAction?.('recall', String(card.id)));
    entry.append(face, button); memoryList.append(entry);
  }
  if (!cards.length) memoryList.append(createElement(document, 'p', 'tower-node-muted', '暂时没有错过且仍可获得的牌。'));
  recall.append(memoryList); shell.append(recall);
}

function renderFinale(options: TowerNodePanelOptions, shell: HTMLElement): void {
  const document = options.root.ownerDocument;
  const finale = createTowerFinale(options.run);
  shell.dataset.panel = 'finale';
  shell.append(createPanelHeader(document, finale.fishEmoji, '冒险结算', '冒险获胜'));
  const scene = createElement(document, 'div', 'tower-finale-scene');
  scene.hidden = true;
  const ascend = createElement(document, 'button', 'tower-node-primary tower-finale-ascend', '爬上塔尖');
  ascend.type = 'button';
  ascend.addEventListener('click', () => { scene.hidden = false; ascend.hidden = true; });
  shell.append(ascend);
  const fish = createElement(document, 'blockquote', 'tower-finale-line is-fish');
  fish.append(createElement(document, 'strong', '', '🐟'));
  fish.append(createElement(document, 'p', '', finale.fishLine));
  const player = createElement(document, 'blockquote', 'tower-finale-line is-player');
  player.append(createElement(document, 'strong', '', text(options.stat.battle?.core?.emoji, '✨')));
  player.append(createElement(document, 'p', '', finale.playerLine));
  const damage = createElement(document, 'div', 'tower-finale-damage', `${finale.damage}`);
  damage.setAttribute('aria-label', `对作者鱼造成 ${finale.damage} 点总分伤害`);
  scene.append(fish, player, damage);
  shell.append(scene);
  const score = createElement(document, 'div', 'tower-finale-score');
  const total = createElement(document, 'span');
  total.append(createElement(document, 'small', '', '已评估敌人总分'));
  total.append(createElement(document, 'strong', '', String(finale.defeatedEnemyScore)));
  const average = createElement(document, 'span');
  average.append(createElement(document, 'small', '', `已评估 ${options.run.score.encounters.length} 场的相对难度`));
  average.append(createElement(document, 'strong', '', options.run.score.encounters.length ? `${finale.averageDifficultyPercent}%` : '暂无可比评分'));
  score.append(total, average);
  shell.append(score);
}

/** Render only locked v3 tower state. The caller owns the strict mode gate. */
export function renderTowerNodePanel(options: TowerNodePanelOptions): boolean {
  const { root, run, stat, callbacks, isLatest, busy } = options;
  const document = root.ownerDocument;
  root.replaceChildren();
  root.style.display = 'none';
  root.removeAttribute('data-panel');
  const shell = createElement(document, 'article', 'tower-node-panel');
  shell.setAttribute('role', 'region');
  shell.setAttribute('aria-label', '当前爬塔地点');
  shell.setAttribute('aria-live', 'polite');
  shell.setAttribute('aria-busy', String(Boolean(busy)));

  if (stat.initial_artifact_acquisition?.phase === 'pending') {
    shell.dataset.panel = 'initial-artifacts';
    shell.append(createPanelHeader(document, '🎁', '冒险准备', '初始遗物'));
    shell.append(createElement(document, 'p', 'tower-node-narrative', '这些遗物在获得时会调整牌组或角色状态。完成选择后即可继续冒险，返回不会消耗任何内容。'));
    const names = list(stat.initial_artifact_acquisition.artifacts).map(artifact => String(artifact.name || artifact.id));
    shell.append(createElement(document, 'p', 'tower-node-callout', names.join('、')));
    for (const artifact of list(stat.initial_artifact_acquisition.artifacts)) {
      const references: ContentRuleReference[] = [];
      const statuses = displayStatuses(artifact, stat.battle?.statuses, artifact.statuses);
      const presentation = presentCompactContent(artifact, 'content', {
        cardNames: collectCardDisplayNames(stat.battle, artifact),
        summonNames: collectSummonDisplayNames(stat.battle, artifact),
        stanceNames: collectStanceNames(stat.battle, artifact),
        stanceDefinitions: collectStanceDefinitions(stat.battle, artifact),
        resourceNames: Object.fromEntries(list(stat.battle?.core?.resources).map(resource => [resource.id, resource.name])),
        statusNames: Object.fromEntries(statuses.map(status => [status.id, status.name])),
        statusDefinitions: Object.fromEntries(statuses.map(status => [status.id, status])),
        onSummonReference: (reference: ContentRuleReference) => references.push(reference),
      });
      const preview = createElement(document, 'div', 'collection-support');
      preview.innerHTML = renderSupportDetails({ ...artifact, description: presentation.flavorText }, {
        kind: '遗物', rulesHtml: renderRulePills(presentation.rulesGroups, references),
      });
      shell.append(preview);
    }
    const button = createElement(document, 'button', 'tower-node-primary', '领取初始遗物效果');
    button.type = 'button';
    button.disabled = !isLatest || Boolean(busy) || !callbacks?.onInitialArtifactAcquisition;
    button.addEventListener('click', () => callbacks?.onInitialArtifactAcquisition?.());
    shell.append(button);
  } else if (run.phase === 'won') {
    renderFinale(options, shell);
  } else if (run.phase === 'lost') {
    renderEventReveal(options, shell);
    shell.dataset.panel = 'terminal';
    shell.append(createPanelHeader(document, '◇', '冒险结算', '这次星路止步于此'));
    const score = createElement(document, 'div', 'tower-finale-score');
    score.append(createElement(document, 'span', '', `已评估敌人总分 ${run.score.defeatedEnemyScore}`));
    score.append(createElement(document, 'span', '', run.score.encounters.length
      ? `已评估 ${run.score.encounters.length} 场的相对难度 ${run.score.averageDifficultyPercent}%` : '暂无可比评分'));
    shell.append(score);
    shell.append(
      createElement(document, 'p', 'tower-node-narrative', '保留这次构筑的印记，准备好后可以开始新的冒险。'),
    );
    if (isLatest && callbacks?.onRestart) {
      const restart = createElement(document, 'button', 'tower-node-primary', '开始新冒险');
      restart.type = 'button';
      restart.disabled = Boolean(busy);
      restart.addEventListener('click', () => callbacks.onRestart?.());
      shell.append(restart);
    }
  } else {
    const openingRendered = renderOpening(options, shell);
    if (!openingRendered) {
      if (run.phase !== 'in_node' || !run.currentNode) {
        if (!renderEventReveal(options, shell)) return false;
        options.root.append(shell);
        options.root.style.display = '';
        options.root.dataset.panel = 'event-result';
        return true;
      }
      const kind = run.currentNode.kind;
      const active = isRecord(stat.run_node) ? stat.run_node : {};
      shell.dataset.panel = kind;
      shell.append(
        createPanelHeader(
          document,
          NODE_COPY[kind].icon,
          `${NODE_COPY[kind].label} · 第 ${run.currentNode.floor} 层`,
          text(active.title, NODE_COPY[kind].label),
        ),
      );
      const eventResolved = Boolean(
        kind === 'event' &&
        (stat.run_result != null || text(isRecord(stat.run_event) ? stat.run_event.selected_choice_id : '')),
      );
      appendNarrative(document, shell, stat, kind, eventResolved);
      if (kind === 'event') renderEvent(options, shell);
      else if (kind === 'rest') renderRest(options, shell);
      else if (kind === 'shop') {
        shell.append(createElement(document,'p','tower-node-callout','商品与删牌服务已陈列在下方，可以逐件购买，随时离开。'));
      } else if (kind === 'treasure') {
        shell.append(createElement(document, 'p', 'tower-node-callout', '宝箱已经开启：从三件遗物中选择一件。'));
      } else {
        shell.append(createElement(document, 'p', 'tower-node-callout', '战斗内容已经准备完成。'));
      }
    }
  }

  if (['won', 'lost'].includes(run.phase) && isLatest && callbacks?.onContinueStory) {
    const form = createElement(document, 'div', 'tower-story-continuation');
    const input = createElement(document, 'textarea', 'tower-story-input');
    input.placeholder = '冒险之后，你想做什么？';
    input.setAttribute('aria-label', '继续剧情的行动');
    const button = createElement(document, 'button', 'tower-node-primary', '继续剧情');
    button.type = 'button'; button.disabled = Boolean(busy);
    const error = createElement(document, 'p', 'tower-node-muted');
    button.addEventListener('click', async () => {
      if (!input.value.trim()) { error.textContent = '请先输入想继续的剧情'; return; }
      button.disabled = true; input.disabled = true; error.textContent = '';
      try { await callbacks.onContinueStory!(input.value); }
      catch (cause) { error.textContent = cause instanceof Error ? cause.message : '继续剧情失败'; }
      finally { button.disabled = false; input.disabled = false; }
    });
    form.append(input, button, error); shell.append(form);
  }
  root.append(shell);
  root.style.display = '';
  root.dataset.panel = shell.dataset.panel || 'opening';
  return true;
}
