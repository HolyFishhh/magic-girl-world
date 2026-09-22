import {
  executeNonCombatDeckPlan,
  migratePersistentRunDeck,
  parseNonCombatSettlement,
  planNonCombatDeckAction,
  type NonCombatDeckAction,
} from '../game-core';
import { presentCompactContent } from '../game-core/contentPresentation';
import type { ContentRuleReference } from '../game-core/contentDescription';
import { collectCardDisplayNames } from '../game-core/cardDisplayNames';
import { collectSummonDisplayNames } from '../game-core/summonDisplayNames';
import { collectStanceDefinitions, collectStanceNames } from '../game-core/stanceIdentityDisplay';
import { flattenMvuArray } from '../runtime/mvuArrays';
import { renderCardFace } from '../shared/cardFace';
import { renderRulePills } from '../shared/rulePills';
import { bindStatusReferenceDetails } from '../shared/statusReference';
import { renderSupportDetails } from '../shared/supportPresentation';
import { applyFixedRewardGrant } from './rewardTransactions';
import { applyNonCombatSettlementInStat } from './nonCombatSettlementTransactions';
import type { NonCombatAnswers } from './nonCombatSettlementTransactions';
import { pinSelectionToVisibleViewport } from './fixedSelectionViewport';

type JsonRecord = Record<string, any>;

export interface CollectNonCombatAnswersOptions {
  stat: JsonRecord;
  settlement: unknown;
  seed: string;
  /** Action ID to frozen run-instance IDs. Random actions are never re-rolled here. */
  randomTargets?: Record<string, string[]>;
  randomSeeds?: Record<string, string>;
}

export interface CollectArtifactAcquisitionAnswersOptions {
  stat: JsonRecord;
  artifacts: unknown;
  seed?: string;
  randomTargets?: Record<string, string[]>;
}

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cardFace(value: JsonRecord, kind: 'card' | 'item', stat: JsonRecord): string {
  const battle = stat.battle || {};
  const statuses = [
    ...flattenMvuArray<JsonRecord>(battle.statuses),
    ...flattenMvuArray<JsonRecord>(value.statuses),
    ...flattenMvuArray<JsonRecord>(value.status),
  ].filter(status => typeof status.id === 'string' && status.id);
  const resources = flattenMvuArray<JsonRecord>(battle.core?.resources);
  const references: ContentRuleReference[] = [];
  const descriptionOptions = {
    inlineStatusDetails: false,
    cardNames: collectCardDisplayNames(battle, value),
    summonNames: collectSummonDisplayNames(battle, value),
    stanceNames: collectStanceNames(battle, value),
    stanceDefinitions: collectStanceDefinitions(battle, value),
    onSummonReference: (reference: ContentRuleReference) => references.push(reference),
    statusNames: Object.fromEntries(statuses.map(status => [status.id, String(status.name || status.id)])),
    statusDefinitions: Object.fromEntries(statuses.map(status => [status.id, status])),
    resourceNames: Object.fromEntries(resources.map(resource => [resource.id, String(resource.name || resource.id)])),
    resourceEmojis: Object.fromEntries(resources.map(resource => [resource.id, String(resource.emoji || '')])),
  };
  const presentation = presentCompactContent(value, kind, descriptionOptions);
  const supportReferences = [
    ...references,
    ...statuses.map(status => ({
      id: String(status.id),
      name: String(status.name || status.id),
      rules: presentCompactContent(status, 'status', { ...descriptionOptions, onSummonReference: undefined }).rulesText,
      flavor: status.description,
    })),
  ];
  const content = { ...value, description: presentation.flavorText };
  const rulesHtml = renderRulePills(
    presentation.rulesGroups.length ? presentation.rulesGroups : ['暂无可显示的结构化规则'],
    supportReferences,
  );
  if (kind === 'item') {
    return renderSupportDetails(content, { kind: '道具', rulesHtml });
  }
  const rarity =
    (
      { Common: '普通', Uncommon: '罕见', Rare: '稀有', Epic: '史诗', Legendary: '传说', Corrupt: '腐化' } as Record<
        string,
        string
      >
    )[value.rarity] || '普通';
  const type =
    ({ Attack: '攻击', Skill: '技能', Power: '能力', Curse: '诅咒', Event: '事件' } as Record<string, string>)[
      value.type
    ] || '卡牌';
  return renderCardFace(content, {
    costLabel: value.type === 'Curse' ? '—' : String(value.cost ?? '—'),
    rarityLabel: rarity,
    typeLabel: type,
    rulesHtml,
    quantity: Number.isInteger(value.quantity) ? value.quantity : undefined,
    interactionClass: 'non-combat-selection-card',
  });
}

function actionLabel(action: NonCombatDeckAction): string {
  const verb = action.kind === 'remove' ? '移除' : action.kind === 'transform' ? '变形' : '复制';
  return `${verb}${action.count}张牌`;
}

function createOverlay(document: Document, title: string, description: string) {
  const overlay = document.createElement('div');
  overlay.className = 'non-combat-selection-overlay';
  overlay.setAttribute('role', 'presentation');
  const panel = document.createElement('section');
  panel.className = 'non-combat-selection-dialog';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const intro = document.createElement('p');
  intro.className = 'non-combat-selection-intro';
  intro.textContent = description;
  const content = document.createElement('div');
  content.className = 'non-combat-selection-content';
  const footer = document.createElement('footer');
  footer.className = 'non-combat-selection-footer';
  panel.append(heading, intro, content, footer);
  overlay.append(panel);
  const style = document.createElement('style');
  style.textContent = `
    .non-combat-selection-overlay{position:fixed;inset:0;z-index:2147483000;background:#08101acc;color:#edf3ff;font:14px/1.5 system-ui;color-scheme:dark}
    .non-combat-selection-dialog{box-sizing:border-box;display:flex;flex-direction:column;min-height:0;width:min(960px,calc(100% - 24px));max-height:calc(100vh - 24px);padding:16px;border:1px solid #607a9b;border-radius:16px;background:#111c2d;box-shadow:0 22px 64px #000a;overflow:hidden}
    .non-combat-selection-dialog h2{flex:none;margin:0;font-size:18px;overflow-wrap:anywhere}
    .non-combat-selection-intro{flex:none;margin:6px 0 12px;color:#c4d5eb;overflow-wrap:anywhere}
    .non-combat-selection-content{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr));grid-auto-rows:max-content;align-content:start;align-items:start;justify-items:center;min-height:0;gap:12px;overflow:auto;padding:3px;overscroll-behavior:contain}
    .non-combat-selection-option{display:block;box-sizing:border-box;min-width:0;max-width:100%;padding:0;border:2px solid #3d5978;border-radius:12px;background:#18283d;color:inherit;cursor:pointer;text-align:left}
    .non-combat-selection-option.is-selected{border-color:#8ecaff;background:#284d76;box-shadow:0 0 0 2px #8ecaff66}
    .non-combat-selection-option:focus-visible{outline:3px solid #d8f1ff;outline-offset:2px}
    .non-combat-selection-option .mwg-card{pointer-events:none;min-height:250px}
    .non-combat-selection-option .mwg-status-reference,.non-combat-selection-option [data-content-reference],.non-combat-selection-option .card-preview-trigger{pointer-events:auto}
    .non-combat-selection-footer{flex:none;display:flex;justify-content:space-between;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid #38516d}
    .non-combat-selection-footer button{min-height:44px;padding:9px 16px;border:1px solid #769cc4;border-radius:9px;background:#203a58;color:#fff;font:inherit;cursor:pointer}
    .non-combat-selection-footer button[disabled]{opacity:.5;cursor:not-allowed}`;
  overlay.append(style);
  document.body.append(overlay);
  const unpin = pinSelectionToVisibleViewport(panel);
  bindStatusReferenceDetails(document);
  return { content, footer, close: () => { unpin(); overlay.remove(); } };
}

function chooseIndexes(
  document: Document,
  title: string,
  description: string,
  entries: readonly JsonRecord[],
  pick: number,
  kind: 'card' | 'item',
  stat: JsonRecord,
  signal?: AbortSignal,
): Promise<number[] | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    const opener =
      document.activeElement && typeof (document.activeElement as HTMLElement).focus === 'function'
        ? (document.activeElement as HTMLElement)
        : null;
    const dialog = createOverlay(document, title, description);
    const selected = new Set<number>();
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = '确认选择';
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = '返回';
    dialog.footer.append(back, confirm);
    const refresh = () => {
      confirm.disabled = selected.size !== pick;
      dialog.content.querySelectorAll<HTMLElement>('[data-choice-index]').forEach(option => {
        const index = Number(option.dataset.choiceIndex);
        option.classList.toggle('is-selected', selected.has(index));
        option.setAttribute('aria-pressed', String(selected.has(index)));
      });
    };
    entries.forEach((entry, index) => {
      const option = document.createElement('article');
      option.className = 'non-combat-selection-option';
      option.dataset.choiceIndex = String(index);
      option.tabIndex = 0;
      option.setAttribute('role', 'button');
      option.setAttribute('aria-pressed', 'false');
      option.setAttribute('aria-label', `选择 ${entry.name || entry.id || index + 1}`);
      option.innerHTML = cardFace(entry, kind, stat);
      const toggle = (event: Event) => {
        const target = event.target as Element | null;
        if (target?.closest('.mwg-status-reference,[data-content-reference],a,button,details')) return;
        if (selected.has(index)) selected.delete(index);
        else if (selected.size < pick) selected.add(index);
        refresh();
      };
      option.addEventListener('click', toggle);
      option.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggle(event);
      });
      dialog.content.append(option);
    });
    let finished = false;
    const abort = () => finish(null);
    const finish = (answer: number[] | null) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      dialog.close();
      opener?.focus({ preventScroll: true });
      resolve(answer);
    };
    signal?.addEventListener('abort', abort, { once: true });
    back.addEventListener('click', () => finish(null));
    confirm.addEventListener('click', () => {
      if (selected.size !== pick) return;
      finish([...selected].sort((left, right) => left - right));
    });
    refresh();
    confirm.focus({ preventScroll: true });
  });
}

function showFrozenAction(
  document: Document,
  action: NonCombatDeckAction,
  cards: readonly JsonRecord[],
  stat: JsonRecord,
): Promise<boolean> {
  return new Promise(resolve => {
    const opener =
      document.activeElement && typeof (document.activeElement as HTMLElement).focus === 'function'
        ? (document.activeElement as HTMLElement)
        : null;
    const verb =
      action.kind === 'remove' ? '将移除以下卡牌' : action.kind === 'duplicate' ? '将复制以下卡牌' : '将把以下卡牌变形';
    const dialog = createOverlay(document, verb, '结果已在进入事件时确定。确认后会按下面的牌组操作继续。');
    if (action.kind === 'transform' && action.replacement) {
      const replacement = document.createElement('div');
      replacement.innerHTML = cardFace(action.replacement, 'card', stat);
      dialog.content.append(replacement);
    }
    cards.forEach(card => {
      const entry = document.createElement('div');
      entry.innerHTML = cardFace(card, 'card', stat);
      dialog.content.append(entry);
    });
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = '返回';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = '确认继续';
    dialog.footer.append(back, confirm);
    const finish = (accepted: boolean) => {
      dialog.close();
      opener?.focus({ preventScroll: true });
      resolve(accepted);
    };
    back.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    confirm.focus({ preventScroll: true });
  });
}

export async function choosePendingCardRemoval(stat: JsonRecord, remaining: number, signal?: AbortSignal): Promise<string | null> {
  const cards = migratePersistentRunDeck(flattenMvuArray<JsonRecord>(stat.battle?.cards));
  if (!cards.length) return null;
  const indexes = await chooseIndexes(globalThis.document, '获得删卡机会 · 选择要永久移除的卡牌',
    `剩余 ${remaining} 次。确认后立即移除所选实例；返回不会消耗次数，可从角色面板继续处理。`, cards, 1, 'card', stat, signal);
  return indexes === null ? null : cards[indexes[0]].runInstanceId;
}

function chooseGrantIndexes(
  document: Document,
  title: string,
  entries: readonly JsonRecord[],
  pick: number,
  kind: 'card' | 'item',
  stat: JsonRecord,
): Promise<number[] | null> {
  if (pick === 0) return Promise.resolve([]);
  if (pick === entries.length) return Promise.resolve(entries.map((_, index) => index));
  return chooseIndexes(document, title, `从 ${entries.length} 个候选中选择 ${pick} 个。`, entries, pick, kind, stat);
}

function frozenActionPlan(
  cards: readonly JsonRecord[],
  action: NonCombatDeckAction,
  seed: string,
  randomTargets: Record<string, string[]> | undefined,
) {
  const frozen = randomTargets?.[action.id];
  if (!frozen) throw new Error(`随机牌组行动 ${action.id} 尚未冻结`);
  // Ask the shared planner for the current eligible identity pool without
  // invoking its random ordering. The persisted list remains authoritative.
  const planned = planNonCombatDeckAction(cards, { ...action, pick: 'choose' }, seed, frozen);
  return { ...planned, selectedIds: [...frozen], pending: false };
}

/** Collect answers only; stat is never written. Later deck actions run on a private draft. */
export async function collectNonCombatAnswers(
  options: CollectNonCombatAnswersOptions,
): Promise<NonCombatAnswers | null> {
  return collectNonCombatAnswersInternal(options, false);
}

async function collectNonCombatAnswersInternal(
  options: CollectNonCombatAnswersOptions,
  materializeRandom: boolean,
): Promise<NonCombatAnswers | null> {
  const plan = parseNonCombatSettlement(options.settlement);
  const document = globalThis.document;
  if (!document?.body) throw new Error('当前页面无法显示非战斗选择器');
  let cards = migratePersistentRunDeck(flattenMvuArray<JsonRecord>(options.stat?.battle?.cards));
  const deck: Record<string, string[]> = {};
  for (const action of plan.deckActions) {
    let actionPlan;
    if (action.pick === 'random') {
      const frozenSeed = options.randomSeeds?.[action.id];
      if (!options.randomTargets?.[action.id] && materializeRandom) {
        if (!options.randomTargets) options.randomTargets = {};
        options.randomTargets[action.id] = planNonCombatDeckAction(cards, action, options.seed).selectedIds;
      }
      actionPlan = frozenSeed
        ? planNonCombatDeckAction(cards, action, frozenSeed)
        : frozenActionPlan(cards, action, options.seed, options.randomTargets);
      const resolved: JsonRecord[] = [];
      for (const id of actionPlan.selectedIds) {
        const found = cards.find(card => card.runInstanceId === id);
        if (found) resolved.push(found);
      }
      if (resolved.length !== action.count) throw new Error(`随机牌组行动 ${action.id} 的固定目标已失效`);
      if (!(await showFrozenAction(document, action, resolved, options.stat))) return null;
    } else {
      const waiting = planNonCombatDeckAction(cards, action, options.seed);
      const indexes = await chooseIndexes(
        document,
        actionLabel(action),
        `从 ${waiting.candidates.length} 张符合条件的牌中选择 ${action.count} 张。`,
        waiting.candidates,
        action.count,
        'card',
        options.stat,
      );
      if (!indexes) return null;
      actionPlan = planNonCombatDeckAction(
        cards,
        action,
        options.seed,
        indexes.map(index => waiting.candidates[index].runInstanceId),
      );
    }
    deck[action.id] = [...actionPlan.selectedIds];
    cards = executeNonCombatDeckPlan(cards, actionPlan, replacement => replacement);
  }
  const answers: NonCombatAnswers = Object.keys(deck).length ? { deck } : {};
  if (plan.grant) {
    const cardsChoice = await chooseGrantIndexes(
      document,
      '选择获得的卡牌',
      plan.grant.cards,
      plan.grant.limits.cards,
      'card',
      options.stat,
    );
    if (cardsChoice === null) return null;
    const itemsChoice = await chooseGrantIndexes(
      document,
      '选择获得的道具',
      plan.grant.items,
      plan.grant.limits.items,
      'item',
      options.stat,
    );
    if (itemsChoice === null) return null;
    answers.grant = { cards: cardsChoice, items: itemsChoice };
  }
  return answers;
}

export async function collectArtifactAcquisitionAnswers(
  options: CollectArtifactAcquisitionAnswersOptions,
): Promise<Record<string, NonCombatAnswers> | null> {
  if (!Array.isArray(options.artifacts)) return {};
  const result: Record<string, NonCombatAnswers> = {};
  const draft = structuredClone(options.stat);
  for (const artifact of options.artifacts) {
    if (!record(artifact) || artifact.on_acquire === undefined) continue;
    const id = typeof artifact.id === 'string' && artifact.id ? artifact.id : null;
    if (!id) throw new Error('获得时遗物缺少稳定 ID');
    const seed = options.seed ?? JSON.stringify([options.stat?.run?.seed ?? 0, 'acquisition', id]);
    const randomTargets: Record<string, string[]> = { ...(options.randomTargets || {}) };
    const answers = await collectNonCombatAnswersInternal(
      {
        stat: draft,
        settlement: artifact.on_acquire,
        seed,
        randomTargets,
      },
      true,
    );
    if (answers === null) return null;
    result[id] = answers;
    applyNonCombatSettlementInStat(draft, artifact.on_acquire, answers, {
      seed,
      randomTargets,
      requireFrozenRandom: true,
      grant: applyFixedRewardGrant,
    });
  }
  return result;
}
