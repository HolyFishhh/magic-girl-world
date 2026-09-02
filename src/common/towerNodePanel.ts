import {
  createTowerFinale,
  migratePersistentRunDeck,
  planTowerEventOutcome,
  planTowerOpeningOutcome,
  type RunNodeKind,
  type RunState,
} from '../game-core';
import { normalizeMvuList } from './rewardTransactions';

export type TowerRestCardAction = 'upgrade' | 'remove' | 'duplicate' | 'transform';

export interface TowerNodePanelCallbacks {
  onOpeningChoice?: (choiceId: string) => void;
  onRetryOpening?: () => void;
  onEventChoice?: (choiceId: string) => void;
  onRestHeal?: () => void;
  onRestCardAction?: (action: TowerRestCardAction, card: Record<string, any>) => void;
  onLeaveShop?: () => void;
  onRestart?: () => void;
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
  const append = (label: string, source: unknown) => {
    const names = list(source).map(entry => text(entry.name, text(entry.id, '未命名')));
    if (names.length) result.push(`${label}：${names.join('、')}`);
  };
  append('卡牌', value.cards ?? value.card);
  append('遗物', value.artifacts ?? value.artifact);
  append('道具', value.items ?? value.item);
  return result;
}

function delta(label: string, value: number, unit = ''): string | null {
  if (!value) return null;
  return `${label}${value > 0 ? '+' : ''}${value}${unit}`;
}

function openingOutcomeSummary(value: unknown): { lines: string[]; error: string } {
  try {
    const outcome = planTowerOpeningOutcome(value);
    return {
      lines: [
        delta('生命', outcome.hpDelta),
        delta('生命上限', outcome.maxHpDelta),
        delta('金币', outcome.goldDelta),
        delta('删卡次数', outcome.cardRemovalDelta),
        ...rewardNames(outcome.reward),
      ].filter((entry): entry is string => Boolean(entry)),
      error: '',
    };
  } catch (error) {
    return { lines: [], error: error instanceof Error ? error.message : '馈赠结果无效' };
  }
}

function eventOutcomeSummary(value: unknown): { lines: string[]; error: string } {
  try {
    const outcome = planTowerEventOutcome(value);
    return {
      lines: [
        delta('生命', outcome.hpDelta),
        delta('生命上限', outcome.maxHpDelta),
        delta('金币', outcome.goldDelta),
        delta('删卡次数', outcome.cardRemovalDelta),
        ...rewardNames(outcome.reward),
        ...(outcome.routeOutcome === 'failed' ? ['此选择会结束本次远征'] : []),
      ].filter((entry): entry is string => Boolean(entry)),
      error: '',
    };
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
): HTMLButtonElement {
  const button = createElement(document, 'button', 'tower-story-choice');
  button.type = 'button';
  button.disabled = disabled || Boolean(summary.error) || !onSelect;
  button.dataset.choiceId = String(choice.id || '');
  const main = createElement(document, 'span', 'tower-story-choice-main');
  main.append(createElement(document, 'strong', '', text(choice.label, '未命名选项')));
  const description = text(choice.description);
  if (description) main.append(createElement(document, 'span', '', description));
  button.append(main);
  if (summary.lines.length) {
    const effects = createElement(document, 'span', 'tower-story-choice-effects');
    summary.lines.forEach(line => {
      const tone = /(?:^|：)[^+\n]*-|结束本次远征/.test(line) ? 'is-cost' : 'is-gain';
      effects.append(createElement(document, 'em', tone, line));
    });
    button.append(effects);
  }
  if (summary.error) button.append(createElement(document, 'span', 'tower-story-choice-error', summary.error));
  if (onSelect) button.addEventListener('click', onSelect);
  return button;
}

function renderOpening(options: TowerNodePanelOptions, shell: HTMLElement): boolean {
  const { run, isLatest, busy, callbacks } = options;
  const opening = run.opening;
  if (opening.phase === 'consumed' || opening.phase === 'skipped') return false;
  const document = options.root.ownerDocument;
  shell.dataset.panel = 'opening';
  shell.dataset.phase = opening.phase;

  if (opening.phase === 'ready' && isRecord(opening.content)) {
    shell.append(createPanelHeader(document, '✦', '启程馈赠', text(opening.content.title, '旅途开始之前')));
    const narrativePhase = opening.narrativePhase;
    const waitingForPreset = narrativePhase === 'pending' || narrativePhase === 'generating';
    if (waitingForPreset) {
      const state = createElement(document, 'div', `tower-node-generation is-${narrativePhase}`);
      state.append(createElement(document, 'span', 'tower-node-spinner'));
      state.append(createElement(document, 'p', '', '正在使用当前预设生成开局剧情，完成后即可选择馈赠。'));
      shell.append(state);
    } else {
      const narrative = text(opening.content.narrative);
      if (narrative) shell.append(createElement(document, 'p', 'tower-node-narrative', narrative));
      if (narrativePhase === 'failed') {
        shell.append(createElement(
          document,
          'p',
          'tower-node-error',
          `原预设剧情生成失败，已保留事件摘要：${text(opening.narrativeError, '可继续选择，不影响本局。')}`,
        ));
      }
    }
    const choices = Array.isArray(opening.content.choices) ? opening.content.choices.filter(isRecord) : [];
    const choiceGrid = createElement(document, 'div', 'tower-story-choices');
    for (const choice of choices) {
      const id = text(choice.id);
      choiceGrid.append(
        createChoiceButton(
          document,
          choice,
          openingOutcomeSummary(choice.outcome),
          !isLatest || Boolean(busy) || waitingForPreset,
          id && callbacks?.onOpeningChoice ? () => callbacks.onOpeningChoice?.(id) : undefined,
        ),
      );
    }
    if (choices.length === 0) shell.append(createElement(document, 'p', 'tower-node-error', '开局馈赠没有可用选项。'));
    else shell.append(choiceGrid);
    return true;
  }

  const phaseCopy = {
    pending: ['馈赠已在准备队列中', '后台会根据当前世界、角色和起始牌组生成开局选择。'],
    generating: ['正在生成开局馈赠', '生成不会阻塞页面；完成后选项会自动出现在这里。'],
    failed: ['开局馈赠生成失败', text(opening.error, '可以安全重试，不会重置地图或牌组。')],
  } as const;
  const copy = phaseCopy[opening.phase as keyof typeof phaseCopy] ?? ['正在准备爬塔开局', '请稍候。'];
  shell.append(createPanelHeader(document, opening.phase === 'failed' ? '!' : '✦', '启程馈赠', copy[0]));
  const state = createElement(document, 'div', `tower-node-generation is-${opening.phase}`);
  if (opening.phase !== 'failed') state.append(createElement(document, 'span', 'tower-node-spinner'));
  state.append(createElement(document, 'p', '', copy[1]));
  if (opening.phase === 'failed' && isLatest && callbacks?.onRetryOpening) {
    const retry = createElement(document, 'button', 'tower-node-primary', '重新生成馈赠');
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
  if (narrative) {
    if (collapsed) {
      const archive = createElement(document, 'details', 'tower-node-narrative-archive');
      archive.append(createElement(document, 'summary', '', '查看本次事件剧情'));
      archive.append(createElement(document, 'p', 'tower-node-narrative', narrative));
      shell.append(archive);
    } else {
      shell.append(createElement(document, 'p', 'tower-node-narrative', narrative));
    }
  }
  const payload = isRecord(stat[`run_${kind}`]) ? stat[`run_${kind}`] : {};
  const description = text(payload.description);
  if (description && description !== narrative)
    shell.append(createElement(document, 'p', 'tower-node-description', description));
}

function renderEvent(options: TowerNodePanelOptions, shell: HTMLElement): void {
  const { stat, isLatest, busy, callbacks } = options;
  const document = options.root.ownerDocument;
  const event = isRecord(stat.run_event) ? stat.run_event : {};
  if (stat.run_result != null || text(event.selected_choice_id)) {
    const pending = createElement(document, 'div', 'tower-node-callout');
    pending.append(createElement(document, 'strong', '', '事件选择已确定'));
    pending.append(createElement(document, 'span', '', '完成下方奖励选择后，路线会自动继续。'));
    shell.append(pending);
    return;
  }
  const choices = Array.isArray(event.choices) ? event.choices.filter(isRecord) : [];
  const grid = createElement(document, 'div', 'tower-story-choices');
  for (const choice of choices) {
    const id = text(choice.id);
    grid.append(
      createChoiceButton(
        document,
        choice,
        eventOutcomeSummary(choice.outcome),
        !isLatest || Boolean(busy),
        id && callbacks?.onEventChoice ? () => callbacks.onEventChoice?.(id) : undefined,
      ),
    );
  }
  if (choices.length) shell.append(grid);
  else shell.append(createElement(document, 'p', 'tower-node-error', '这个事件没有可用选项。'));
}

function renderRest(options: TowerNodePanelOptions, shell: HTMLElement): void {
  const { stat, isLatest, busy, callbacks } = options;
  const document = options.root.ownerDocument;
  const actions = createElement(document, 'div', 'tower-rest-main-actions');
  const heal = createElement(document, 'button', 'tower-node-primary', '恢复 30% 最大生命');
  heal.type = 'button';
  heal.disabled = !isLatest || Boolean(busy) || !callbacks?.onRestHeal;
  heal.addEventListener('click', () => callbacks?.onRestHeal?.());
  actions.append(heal);
  shell.append(actions);

  const cards = migratePersistentRunDeck(normalizeMvuList<Record<string, any>>(stat.battle?.cards));
  const details = createElement(document, 'details', 'tower-rest-card-picker');
  const summary = createElement(document, 'summary', '', `处理卡牌 · ${cards.length} 张`);
  summary.setAttribute('aria-label', `展开可处理的卡牌，共 ${cards.length} 张`);
  details.append(summary);
  const cardList = createElement(document, 'div', 'tower-rest-card-list');
  for (const card of cards) {
    const row = createElement(document, 'article', 'tower-rest-card');
    const identity = createElement(document, 'div', 'tower-rest-card-identity');
    identity.append(createElement(document, 'span', 'tower-rest-card-emoji', text(card.emoji, '🃏')));
    const copy = createElement(document, 'div');
    copy.append(createElement(document, 'strong', '', text(card.name, text(card.id, '未命名卡牌'))));
    copy.append(createElement(document, 'small', '', text(card.rarity, 'Common')));
    identity.append(copy);
    const cardActions = createElement(document, 'div', 'tower-rest-card-actions');
    const add = (action: TowerRestCardAction, label: string, hidden = false) => {
      if (hidden) return;
      const button = createElement(document, 'button', `tower-rest-${action}`, label);
      button.type = 'button';
      button.disabled = !isLatest || Boolean(busy) || !callbacks?.onRestCardAction;
      button.dataset.runInstanceId = text(card.runInstanceId);
      button.addEventListener('click', () => callbacks?.onRestCardAction?.(action, card));
      cardActions.append(button);
    };
    add('upgrade', '升级', Number(card.upgrade_level || 0) >= 1);
    add('remove', '移除');
    add('duplicate', '复制');
    add('transform', '变形');
    row.append(identity, cardActions);
    cardList.append(row);
  }
  if (cards.length === 0) cardList.append(createElement(document, 'p', 'tower-node-muted', '当前没有可处理的卡牌。'));
  details.append(cardList);
  shell.append(details);
}

function renderFinale(options: TowerNodePanelOptions, shell: HTMLElement): void {
  const document = options.root.ownerDocument;
  const finale = createTowerFinale(options.run);
  shell.dataset.panel = 'finale';
  shell.append(createPanelHeader(document, finale.fishEmoji, '塔顶 · 作者房间', '这条鱼好像还在改代码'));
  const scene = createElement(document, 'div', 'tower-finale-scene');
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
  total.append(createElement(document, 'small', '', '击败敌人总分'));
  total.append(createElement(document, 'strong', '', String(finale.defeatedEnemyScore)));
  const average = createElement(document, 'span');
  average.append(createElement(document, 'small', '', '平均相对难度'));
  average.append(createElement(document, 'strong', '', `${finale.averageDifficultyPercent}%`));
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

  if (run.phase === 'won') {
    renderFinale(options, shell);
  } else if (run.phase === 'lost') {
    shell.dataset.panel = 'terminal';
    shell.append(createPanelHeader(document, '◇', '远征结束', '这次星路止步于此'));
    shell.append(
      createElement(document, 'p', 'tower-node-narrative', '保留这次构筑的经验，准备好后可以开始新的远征。'),
    );
    if (isLatest && callbacks?.onRestart) {
      const restart = createElement(document, 'button', 'tower-node-primary', '开始新远征');
      restart.type = 'button';
      restart.disabled = Boolean(busy);
      restart.addEventListener('click', () => callbacks.onRestart?.());
      shell.append(restart);
    }
  } else {
    const openingRendered = renderOpening(options, shell);
    if (!openingRendered) {
      if (run.phase !== 'in_node' || !run.currentNode) return false;
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
        shell.append(
          createElement(document, 'p', 'tower-node-callout', '商品已准备完成，请在下方选择购买；也可以直接离开。'),
        );
        if (isLatest && callbacks?.onLeaveShop) {
          const leave = createElement(document, 'button', 'tower-node-secondary', '离开商店');
          leave.type = 'button';
          leave.disabled = Boolean(busy);
          leave.addEventListener('click', () => callbacks.onLeaveShop?.());
          shell.append(leave);
        }
      } else if (kind === 'treasure') {
        shell.append(createElement(document, 'p', 'tower-node-callout', '宝箱已经开启，请在下方选择本次收获。'));
      } else {
        shell.append(createElement(document, 'p', 'tower-node-callout', '战斗内容已经准备完成。'));
      }
    }
  }

  root.append(shell);
  root.style.display = '';
  root.dataset.panel = shell.dataset.panel || 'opening';
  return true;
}
