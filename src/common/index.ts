// RPG UI - 动态版本入口文件
import '../runtime/bootstrap';
import {
  getCurrentChatMessageText,
  getCurrentMessageVariables,
  getRelativeChatMessageText,
  isCurrentMessageLatest,
  isCurrentMessageWithinDepth,
  rerenderHistoricalMessageForDepth,
  watchCurrentMessageDepth,
} from '../runtime/messageVariables';
import { readRunState } from '../runtime/runStateAdapter';
import { createContentPackFromMvuBattle } from '../runtime/contentPackAdapter';
import { flattenMvuArray } from '../runtime/mvuArrays';
import {
  canGenerateCompactStatusDescription,
  assessInitialPlayerContent,
  describeCompactCard,
  describeCompactContent,
  describeCompactStatus,
  formatBuildGuidance,
  formatShopBudget,
  formatEnemyBudget,
  formatBuildBudget,
  formatRoutePrompt,
  formatWorldContinuityHint,
  formatOptionPrompt,
  formatPlayerContentReadiness,
  formatPlayerContentRepairPrompt,
  createRunPacingContext,
  recommendBuildGuidance,
  recommendEnemyBudget,
  recommendShopPrice,
  recommendShopBudget,
  summarizeBuildBudget,
  type RunNodeChoice,
  type RunNodeKind,
  type PlayerContentReadiness,
} from '../game-core';
import { readStatusLocation, readStatusProfession } from './statusAdapter';
import { TavernCommonActionHost } from './commonActionHost';
import {
  needsProgressionSettlement,
  progressionFromTotalExperience,
  requiredExperienceForLevel,
  settleBattleProgression,
  totalExperienceAt,
  type ProgressionSettlement,
} from './progression';
import {
  hasSelectableRewards,
  inspectRewardCandidates,
  normalizeMvuList,
  readRewardRoot,
  readRewardLimits,
  type RewardSelections,
} from './rewardTransactions';
import { hasOptionTagMarkup, parseOptionTags } from './optionTags';
import { TavernRunActionHost } from './runActionHost';
import './index.scss';

const commonActionHost = TavernCommonActionHost.getInstance();
const runActionHost = TavernRunActionHost.getInstance();

// ---------------- 奖励内联渲染：状态与工具 ----------------
let __STAT__: any = null;
let __DELTA__: any = null;
// 记录本轮玩家领取奖励的汇总文本，供下一次选项发送时拼接
let __PENDING_REWARD_SUMMARY: string | null = null;
let __PENDING_RUN_SUMMARY: string | null = null;
let __RUN_ERROR: string | null = null;
let __stopLatestMessageGuard: (() => void) | null = null;
let __BATTLE_BOOK_DATA: { playerStatusEffects: any[]; statuses: any[] } = {
  playerStatusEffects: [],
  statuses: [],
};

// 防重复发送标志已移至下方统一定义
function getStatRootRef(variables: any): any {
  return variables?.stat_data && typeof variables.stat_data === 'object' ? variables.stat_data : {};
}
let __isMutating = false; // 防抖标记
let __USER_MUTATION_PILLS: string[] = [];
// 持久通知（本页面会话内保持）
// 自定义行动控件绑定（全局只绑定一次）
let __customActionBound = false;
function bindCustomActionControls() {
  if (__customActionBound) return;
  const inputEl = document.getElementById('custom-action-input') as HTMLInputElement | null;
  const sendBtn = document.getElementById('custom-action-send') as HTMLButtonElement | null;
  if (!inputEl || !sendBtn) return; // 元素尚未渲染
  __customActionBound = true;
  const doSend = async () => {
    const text = (inputEl.value || '').trim();
    if (!text) {
      if (typeof toastr !== 'undefined') toastr.info('请输入要发送的内容');
      return;
    }
    // 检查是否有奖励待领取，如果有则不允许发送
    const choiceContainer = document.getElementById('choice-container');
    if (choiceContainer && choiceContainer.style.display !== 'none') {
      if (typeof toastr !== 'undefined') toastr.warning('请先领取或跳过奖励');
      return;
    }

    if (__IS_SENDING_OPTION) return;

    try {
      await handleOption(text);
    } catch (e) {
      console.error('自定义行动发送失败:', e);
      if (typeof toastr !== 'undefined') toastr.error('发送失败，请重试');
    } finally {
      inputEl.value = '';
      inputEl.focus();
    }
  };
  sendBtn.onclick = doSend;
  inputEl.addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key === 'Enter') doSend();
  });
}

const __PERSIST_PILLS: string[] = [];
// 取消基于上一轮快照的对比，改为直接读取 delta_data

// 中文标签映射
const CN_LABELS: Record<string, string> = {
  head: '头部',
  neck: '颈部',
  hands: '手部',
  upper_body: '上身',
  lower_body: '下身',
  underwear: '内衣',
  legs: '腿部',
  feet: '脚部',
  profession: '职业',
  inventory: '持有物',
  permanent_status: '永久状态',
};

function normalizeOptionsList<T = any>(value: any): T[] {
  if (!value) return [];
  if (Array.isArray(value) || typeof value === 'object') return normalizeMvuList<T>(value);
  return [];
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const RUN_NODE_LABELS: Record<RunNodeKind, { icon: string; name: string; prompt: string }> = {
  battle: { icon: '⚔', name: '战斗', prompt: '生成一场与当前章节和构筑相符的普通战斗。' },
  elite: { icon: '◆', name: '精英', prompt: '生成一场更危险、机制更鲜明的精英战斗。' },
  event: { icon: '?', name: '事件', prompt: '生成一个有明确取舍的短事件。' },
  rest: { icon: '♨', name: '营火', prompt: '生成简短的营火休整场景，不代替玩家选择恢复或升级。' },
  shop: { icon: '¤', name: '商店', prompt: '生成本次商店的简短场景和商品候选；价格由程序决定。' },
  boss: { icon: '♛', name: 'Boss', prompt: '生成本章节 Boss 战，机制应检验当前构筑。' },
};

function isBattleRunNode(kind: RunNodeKind): boolean {
  return kind === 'battle' || kind === 'elite' || kind === 'boss';
}

function runNodeSummary(node: RunNodeChoice): string {
  const label = RUN_NODE_LABELS[node.kind];
  return `${label.name} · Act ${node.act} 第${node.floor}层`;
}

function currentContentPack(): ReturnType<typeof createContentPackFromMvuBattle> | null {
  const battle = __STAT__?.battle;
  if (!battle || typeof battle !== 'object') return null;
  return createContentPackFromMvuBattle(battle);
}

function currentBuildContext(): {
  pack: ReturnType<typeof createContentPackFromMvuBattle>;
  budget: ReturnType<typeof summarizeBuildBudget>;
} | null {
  const battle = __STAT__?.battle;
  if (!battle || typeof battle !== 'object') return null;
  const core = battle.core && typeof battle.core === 'object' ? battle.core : {};
  const pack = currentContentPack();
  if (!pack) return null;
  if (pack.cards.length === 0) return null;
  const budget = summarizeBuildBudget(pack, {
    hp: Number(core.hp),
    maxHp: Number(core.max_hp),
  });
  return { pack, budget };
}

function currentInitialContentReadiness(): PlayerContentReadiness | null {
  const pack = currentContentPack();
  const battle = __STAT__?.battle;
  const core = battle?.core;
  return pack
    ? assessInitialPlayerContent(pack, {
        hp: core?.hp,
        maxHp: core?.max_hp,
        lust: core?.lust,
        maxLust: core?.max_lust,
        level: battle?.level,
        exp: battle?.exp,
      })
    : null;
}

function buildBudgetPrompt(context: ReturnType<typeof currentBuildContext>): string | null {
  return context ? `[构筑摘要] ${formatBuildBudget(context.budget)}` : null;
}

function buildEnemyBudgetPrompt(node: RunNodeChoice, context: ReturnType<typeof currentBuildContext>): string | null {
  return context
    ? `[敌人预算] ${formatEnemyBudget(recommendEnemyBudget(context.budget, node.danger, node.act))}`
    : null;
}

function buildGuidancePrompt(context: ReturnType<typeof currentBuildContext>): string | null {
  return context ? `[构筑建议] ${formatBuildGuidance(recommendBuildGuidance(context.pack, context.budget))}` : null;
}

async function ensureAndConsumeRunState(): Promise<void> {
  try {
    const result = await runActionHost.syncPendingRunState();
    if (result.consumedRunResult) __RUN_ERROR = null;
    if (result.restUpgrade) {
      __USER_MUTATION_PILLS.push(`卡牌升级：${result.restUpgrade.cardName}`);
      __PENDING_RUN_SUMMARY = `{{user}}在营火升级了${result.restUpgrade.cardName}`;
      __RUN_ERROR = null;
    }
  } catch (error) {
    __RUN_ERROR = error instanceof Error ? error.message : '路线状态结算失败';
  }
}

function getRewardLimits(stat: any): { cards: number; artifacts: number; items: number } {
  return readRewardLimits(stat);
}

function computeChangePillsByDelta(delta: any, stat: any): string[] {
  const pills: string[] = [];
  const tryParseJson = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const parseArrowJsonPair = (text: string): { oldVal: any; newVal: any } | null => {
    if (typeof text !== 'string') return null;
    if (!text.includes('->')) return null;

    const parts = text.split('->');
    if (parts.length < 2) return null;

    const left = parts[0].trim();
    const right = parts.slice(1).join('->').trim();

    const oldVal = tryParseJson(left);
    const newVal = tryParseJson(right);

    return { oldVal, newVal };
  };
  // 提取 ASSIGNED 文本中的 JSON（数组/对象），忽略字符串里的括号
  const parseAssignedArrayFromText = (text: string): any[] | null => {
    if (typeof text !== 'string') return null;

    const extractJson = (t: string): string | null => {
      const first = t.indexOf('[') >= 0 && (t.indexOf('{') === -1 || t.indexOf('[') < t.indexOf('{')) ? '[' : '{';
      const start = t.indexOf(first);
      if (start === -1) return null;
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < t.length; i++) {
        const ch = t[i];
        if (inStr) {
          if (esc) {
            esc = false;
            continue;
          }
          if (ch === '\\') {
            esc = true;
            continue;
          }
          if (ch === '"') {
            inStr = false;
            continue;
          }
          continue;
        } else {
          if (ch === '"') {
            inStr = true;
            continue;
          }
          if (ch === first) depth++;
          else if (ch === (first === '[' ? ']' : '}')) {
            depth--;
            if (depth === 0) return t.slice(start, i + 1);
          }
        }
      }
      return null;
    };

    // 优先尝试 ASSIGNED ... into array 的直接片段
    const m = text.match(/ASSIGNED\s+(\[.*|\{.*)/);
    const tail = m ? m[1] : text;
    const jsonSlice = extractJson(tail);
    if (!jsonSlice) return null;

    const parsed = tryParseJson(jsonSlice);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
    return null;
  };

  // 职业
  const prof = delta?.status?.profession;
  if (typeof prof === 'string' && prof.includes('->')) {
    const pair = parseArrowJsonPair(prof);
    const oldObj = pair?.oldVal && typeof pair.oldVal === 'object' ? pair.oldVal : null;
    const newObj = pair?.newVal && typeof pair.newVal === 'object' ? pair.newVal : null;
    if (oldObj && newObj && ('name' in oldObj || 'name' in newObj)) {
      if (String(oldObj.name ?? '') !== String(newObj.name ?? '')) {
        pills.push(`职业名：${oldObj.name || '无'}->${newObj.name || '无'}`);
      }
      if (String(oldObj.ability ?? '') !== String(newObj.ability ?? '')) {
        pills.push(`职业能力：${oldObj.ability || '无'}->${newObj.ability || '无'}`);
      }
    } else {
      pills.push('职业：' + prof);
    }
  }
  else if (prof && typeof prof === 'object') {
    const nameDelta = prof.name;
    const abilityDelta = prof.ability;
    if (typeof nameDelta === 'string' && nameDelta.includes('->')) pills.push('职业名：' + nameDelta);
    if (typeof abilityDelta === 'string' && abilityDelta.includes('->')) pills.push('职业能力：' + abilityDelta);
  }

  // 服装变更（逐字段）
  const clothingDelta = delta?.status?.clothing;
  const clothingKeys = ['head', 'neck', 'hands', 'upper_body', 'lower_body', 'underwear', 'legs', 'feet'];

  if (typeof clothingDelta === 'string' && clothingDelta.includes('->') && clothingDelta.includes('{')) {
    const pair = parseArrowJsonPair(clothingDelta);
    if (pair && pair.newVal && typeof pair.newVal === 'object') {
      const oldObj = pair.oldVal && typeof pair.oldVal === 'object' ? pair.oldVal : {};
      const newObj = pair.newVal;
      clothingKeys.forEach(k => {
        const oldV = oldObj?.[k] ?? '';
        const newV = newObj?.[k] ?? '';
        if (String(oldV) !== String(newV)) {
          pills.push(`${CN_LABELS[k] || k}：${oldV || '无'}->${newV || '无'}`);
        }
      });
    }
  } else if (typeof clothingDelta === 'object' && clothingDelta !== null) {
    // 处理直接对象格式的服装变更
    clothingKeys.forEach(k => {
      const v = clothingDelta?.[k];
      if (typeof v === 'string' && v.includes('->')) {
        pills.push(`${CN_LABELS[k] || k}：${v}`);
      }
    });
  }

  // 永久状态、持有物：只显示“新增”类文本
  // MUV delta may report one assignment or a list of assignments.
  const handleSimpleAssign = (val: any, label: string) => {
    const arr = Array.isArray(val) ? val : typeof val === 'string' ? [val] : [];
    arr.forEach((txt: any) => {
      const s = String(txt);
      const m = s.match(/ASSIGNED\s+"([^"]+)"/);
      if (m && m[1]) pills.push(`新增${label}：${m[1]}`);
      else if (/新增|ADDED|\+/.test(s)) pills.push(`新增${label}：${s.replace(/^.*?(新增|ADDED|\+)\s*/, '')}`);
    });
  };
  handleSimpleAssign(delta?.status?.permanent_status, '永久状态');
  handleSimpleAssign(delta?.status?.inventory, '持有物');

  // battle 扩展新增（卡牌/遗物/道具）：解析文本中可能的新增提示
  const handleListAdd = (root: any, label: string) => {
    if (!root) return;

    const arr = Array.isArray(root) ? root : typeof root === 'string' ? [root] : [];
    arr.forEach((entry: any) => {
      const s = String(entry);
      if (s.includes('[') || s.includes('{')) {
        // 可扩展变量：解析包含 JSON 数组片段的变化文本（ASSIGNED/ADDED/等）
        const parsed = parseAssignedArrayFromText(s);
        if (parsed && parsed.length) {
          parsed.forEach((x: any) => {
            const name = x?.name || x?.id || '未知';
            const qty = x?.quantity ? ` x${x.quantity}` : '';
            pills.push(`新增${label}：${name}${qty}`);
          });
        }
        // 若无法解析出结构，则不显示原始文本，避免污染通知
      } else if (s.includes('->')) {
        // 普通变量：箭头格式
        pills.push(`${label}：${s}`);
      }
    });
  };
  handleListAdd(delta?.battle?.cards, '卡牌');
  handleListAdd(delta?.battle?.artifacts, '遗物');
  handleListAdd(delta?.battle?.items, '道具');

  // 欲望效果：仅显示名称
  const ple = delta?.battle?.player_lust_effect;
  if (ple) {
    // 可能是整段字符串（包含 -> 与 JSON），也可能是对象（各字段分别是变化字符串）
    if (typeof ple === 'string') {
      if (ple.includes('->')) {
        const pair = parseArrowJsonPair(ple);
        const newName = pair && pair.newVal && typeof pair.newVal === 'object' ? pair.newVal.name : null;
        if (newName) pills.push(`玩家欲望效果：${newName}`);
      }
      // 其他纯文本形式忽略，避免把整段 JSON/描述原样塞进通知
    } else if (typeof ple === 'object' && ple !== null) {
      const nameDelta = ple.name;
      if (typeof nameDelta === 'string') {
        if (nameDelta.includes('->')) {
          const parts = nameDelta.split('->');
          const right = parts.slice(1).join('->').trim();
          try {
            const parsed = JSON.parse(right);
            const newName = typeof parsed === 'string' ? parsed : null;
            if (newName) pills.push(`玩家欲望效果：${newName}`);
          } catch {
            const newName = right.replace(/^"|"$/g, '');
            if (newName) pills.push(`玩家欲望效果：${newName}`);
          }
        } else if (nameDelta) {
          // 某些实现可能直接给出新名称
          pills.push(`玩家欲望效果：${nameDelta}`);
        }
      }
    }
  }

  // 删卡次数变化
  const del = delta?.battle?.core?.card_removal_count;
  if (typeof del === 'string' && del.includes('->')) pills.push('删卡次数：' + del);

  return pills;
}

async function applyRewardSelectionsInline(selections: RewardSelections) {
  const settlement = await runActionHost.settleRewardSelections(selections);
  const settledSummary = settlement.summary;
  settledSummary.cards.forEach(name => __USER_MUTATION_PILLS.push(`新增卡牌：${name}`));
  settledSummary.artifacts.forEach(name => __USER_MUTATION_PILLS.push(`新增遗物：${name}`));
  settledSummary.items.forEach(name => __USER_MUTATION_PILLS.push(`新增道具：${name}`));

  const parts: string[] = [];
  if (settledSummary.cards.length) parts.push(`卡牌[${settledSummary.cards.join('，')}]`);
  if (settledSummary.artifacts.length) parts.push(`遗物[${settledSummary.artifacts.join('，')}]`);
  if (settledSummary.items.length) parts.push(`道具[${settledSummary.items.join('，')}]`);
  if (settlement.kind === 'shop') {
    __PENDING_REWARD_SUMMARY = parts.length
      ? `{{user}}在商店花费${settlement.spentGold}金币，购得：${parts.join(' ')}`
      : '{{user}}离开了商店，没有购买商品';
  } else if (settlement.kind === 'event') {
    __PENDING_REWARD_SUMMARY = parts.length
      ? `{{user}}在事件中获得：${parts.join(' ')}`
      : '{{user}}结束了事件，没有领取奖励';
  } else {
    __PENDING_REWARD_SUMMARY = parts.length ? `{{user}}已获得：${parts.join(' ')}` : '{{user}}没有领取奖励';
  }
}

// 渲染通知模块（插入在正文和选项之间）
function renderNotifyModule() {
  const stat = __STAT__ || {};
  const delta = __DELTA__ || {};

  const pills = computeChangePillsByDelta(delta, stat);
  // 持久化：将本轮解析出的变化和用户选择追加到持久列表（去重）
  const addPersist = (list: string[]) => {
    list.forEach(p => {
      if (!__PERSIST_PILLS.includes(p)) __PERSIST_PILLS.push(p);
    });
  };
  addPersist(pills);
  if (__USER_MUTATION_PILLS.length) addPersist(__USER_MUTATION_PILLS);
  // 清空一次性用户操作 pills，避免重复追加
  __USER_MUTATION_PILLS = [];

  // 检查经验/等级变化
  const expDisp = __DELTA__?.battle?.exp;
  const levelDisp = __DELTA__?.battle?.level;
  let hasExpChange = false;
  if (typeof expDisp === 'string' && expDisp.includes('->')) {
    const parts = expDisp.split('->');
    const oldNum = parseInt(parts[0].trim(), 10);
    const newNum = parseInt(parts.slice(1).join('->').trim(), 10);
    if (!isNaN(oldNum) && !isNaN(newNum) && newNum > oldNum) hasExpChange = true;
  }
  const hasLevelChange = typeof levelDisp === 'string' && levelDisp.includes('->');

  // 升级奖励逻辑改为“基于exp自动结算”，不再基于level的delta在此处处理

  const notifySection = document.getElementById('notify-section');
  const changesSection = document.getElementById('changes-section');
  const expSection = document.getElementById('exp-section');
  const changesList = document.getElementById('changes-list');
  const expDisplay = document.getElementById('exp-display');
  const levelExpBadge = document.getElementById('level-exp-badge');

  if (!notifySection || !changesSection || !expSection || !changesList || !expDisplay || !levelExpBadge) return;

  // 渲染变化提示（使用持久列表）
  if (__PERSIST_PILLS.length > 0) {
    changesSection.style.display = 'block';
    changesList.innerHTML = __PERSIST_PILLS.map((p: string) => `<span class="pill">${escapeHtml(p)}</span>`).join('');
  } else {
    changesSection.style.display = 'none';
  }

  // 渲染经验/等级变化
  if (hasExpChange || hasLevelChange) {
    expSection.style.display = 'block';
    const lines: string[] = [];

    // 从 delta 解析经验变化，计算升级前后状态
    if (hasExpChange && typeof expDisp === 'string' && expDisp.includes('->')) {
      const parts = expDisp.split('->');
      const oldExp = parseInt(parts[0].trim(), 10) || 0;
      const newExpFromDelta = parseInt(parts.slice(1).join('->').trim(), 10) || 0;

      // 从结算后的累计经验减去本轮增量，稳定反推出结算前状态。
      const currentLevel = Number(stat?.battle?.level ?? 1);
      const currentExp = Number(stat?.battle?.exp ?? 0);
      const expGain = newExpFromDelta - oldExp;
      const afterTotal = totalExperienceAt(currentLevel, currentExp);
      const before = progressionFromTotalExperience(Math.max(0, afterTotal - Math.max(0, expGain)));
      const beforeLevel = before.level;
      const beforeExp = before.exp;

      const beforeNeed = requiredExperienceForLevel(beforeLevel);
      const afterNeed = requiredExperienceForLevel(currentLevel);

      // 只有等级真正变化时才显示等级变化
      if (beforeLevel !== currentLevel) {
        lines.push(`等级：LV ${beforeLevel} -> LV ${currentLevel}`);
      }
      lines.push(`经验值：${beforeExp}/${beforeNeed} -> ${currentExp}/${afterNeed}`);
    } else {
      // 如果没有exp变化，只显示当前状态
      const levelNow = Number(stat?.battle?.level ?? 1);
      const expNow = Number(stat?.battle?.exp ?? 0);
      const needNow = requiredExperienceForLevel(levelNow);

      lines.push(`等级：LV ${levelNow}`);
      lines.push(`经验值：${expNow}/${needNow}`);
    }

    expDisplay.innerHTML = lines
      .map(
        t =>
          `<div class="exp-item"><span class="exp-icon">✨</span><span class="exp-text">${escapeHtml(t)}</span></div>`,
      )
      .join('');

    // 显示等级徽章
    const levelNow = Number(stat?.battle?.level ?? 1);
    const expNow = Number(stat?.battle?.exp ?? 0);
    levelExpBadge.textContent = `Lv.${levelNow} · EXP ${expNow}`;
    levelExpBadge.style.display = 'block';
  } else {
    expSection.style.display = 'none';
    levelExpBadge.style.display = 'none';
  }

  // 显示通知模块
  const hasContent = __PERSIST_PILLS.length > 0 || hasExpChange || hasLevelChange;
  notifySection.style.display = hasContent ? 'block' : 'none';

  // 不再使用上一轮快照
}

// 渲染选择模块（浮动在选项之上）
function renderChoiceModule() {
  const stat = __STAT__ || {};
  const reward = readRewardRoot(stat) || {};
  const limits = getRewardLimits(stat);

  const cards = normalizeOptionsList<any>(reward.card);
  const artifacts = normalizeOptionsList<any>(reward.artifact);
  const items = normalizeOptionsList<any>(reward.item);
  const inspections = inspectRewardCandidates(stat);
  const usableLimits = {
    cards: Math.min(limits.cards, inspections.cards.filter(result => result.ok).length),
    artifacts: Math.min(limits.artifacts, inspections.artifacts.filter(result => result.ok).length),
    items: Math.min(limits.items, inspections.items.filter(result => result.ok).length),
  };

  const choiceOverlay = document.getElementById('choice-container');
  const choiceTitle = document.getElementById('choice-title');
  const cardSection = document.getElementById('card-rewards-section');
  const artifactSection = document.getElementById('artifact-rewards-section');
  const itemSection = document.getElementById('item-rewards-section');

  if (!choiceOverlay || !cardSection || !artifactSection || !itemSection) return;
  const run = readRunState(stat);
  const isShop = run?.phase === 'in_node' && run.currentNode?.kind === 'shop';
  const isEventReward = run?.phase === 'in_node' && run.currentNode?.kind === 'event' && stat?.run_result != null;
  if (choiceTitle) {
    choiceTitle.textContent = isShop ? `商店 · ${run.gold} 金币` : isEventReward ? '事件奖励' : '奖励结算';
  }
  // 渲染卡牌选项
  if (cards.length > 0) {
    cardSection.style.display = 'block';
    const cardOptions = document.getElementById('card-options');
    const cardCount = document.getElementById('card-selection-count');
    const cardSelected = document.getElementById('card-selected');
    const cardMax = document.getElementById('card-max');

    if (cardOptions && cardCount && cardSelected && cardMax) {
      cardCount.textContent = `${cards.length}选${usableLimits.cards}`;
      cardMax.textContent = String(usableLimits.cards);

      const inputType = 'checkbox';
      const inputName = '';

      cardOptions.innerHTML = cards
        .map((card, idx) => {
          const inspection = inspections.cards[idx];
          const invalid = !inspection?.ok;
          // 处理费用显示
          const cost = card.cost;
          let costDisplay = '';
          if (cost === 'energy') {
            costDisplay = '消耗: 全部能量';
          } else if (typeof cost === 'number') {
            costDisplay = `消耗: ${cost}`;
          } else if (cost !== undefined && cost !== null) {
            costDisplay = `消耗: ${cost}`;
          }
          const priceDisplay = isShop ? `价格: ${recommendShopPrice('cards', card, run.act)} 金币` : '';
          const cardDescription =
            card.description ||
            describeCompactCard(card, { statusNames: contentDescriptionStatusNames(card) }) ||
            '效果见卡牌规则';

          return `
        <label class="option${invalid ? ' option-invalid' : ''}">
          <input type="${inputType}" ${inputName ? `name="${inputName}"` : ''} value="${idx}" ${invalid ? 'disabled' : ''} />
          <span class="icon">${escapeHtml(card.emoji || '🃏')}</span>
          <span class="text">
            <div class="name">${escapeHtml(card.name || '未知')}</div>
            ${costDisplay ? `<div class="cost">${escapeHtml(costDisplay)}</div>` : ''}
            ${priceDisplay ? `<div class="cost">${escapeHtml(priceDisplay)}</div>` : ''}
            <div class="desc">${escapeHtml(cardDescription)}</div>
            ${invalid ? `<div class="reward-validation">不可领取：${escapeHtml(inspection.message)}</div>` : ''}
          </span>
        </label>
      `;
        })
        .join('');
    }
  } else {
    cardSection.style.display = 'none';
  }

  // 渲染遗物选项
  if (artifacts.length > 0) {
    artifactSection.style.display = 'block';
    const artifactOptions = document.getElementById('artifact-options');
    const artifactCount = document.getElementById('artifact-selection-count');
    const artifactSelected = document.getElementById('artifact-selected');
    const artifactMax = document.getElementById('artifact-max');

    if (artifactOptions && artifactCount && artifactSelected && artifactMax) {
      artifactCount.textContent = `${artifacts.length}选${usableLimits.artifacts}`;
      artifactMax.textContent = String(usableLimits.artifacts);

      const inputType = 'checkbox';
      const inputName = '';

      artifactOptions.innerHTML = artifacts
        .map((artifact, idx) => {
          const inspection = inspections.artifacts[idx];
          const invalid = !inspection?.ok;
          return `
        <label class="option${invalid ? ' option-invalid' : ''}">
          <input type="${inputType}" ${inputName ? `name="${inputName}"` : ''} value="${idx}" ${invalid ? 'disabled' : ''} />
          <span class="icon">${escapeHtml(artifact.emoji || '💎')}</span>
          <span class="text">
            <div class="name">${escapeHtml(artifact.name || '未知')}</div>
            ${isShop ? `<div class="cost">价格: ${escapeHtml(recommendShopPrice('artifacts', artifact, run.act))} 金币</div>` : ''}
            <div class="desc">${escapeHtml(contentRuleDescription(artifact, '效果见规则'))}</div>
            ${invalid ? `<div class="reward-validation">不可领取：${escapeHtml(inspection.message)}</div>` : ''}
          </span>
        </label>
      `;
        })
        .join('');
    }
  } else {
    artifactSection.style.display = 'none';
  }

  // 渲染道具选项
  if (items.length > 0) {
    itemSection.style.display = 'block';
    const itemOptions = document.getElementById('item-options');
    const itemCount = document.getElementById('item-selection-count');
    const itemSelected = document.getElementById('item-selected');
    const itemMax = document.getElementById('item-max');

    if (itemOptions && itemCount && itemSelected && itemMax) {
      itemCount.textContent = `${items.length}选${usableLimits.items}`;
      itemMax.textContent = String(usableLimits.items);

      const inputType = 'checkbox';
      const inputName = '';

      itemOptions.innerHTML = items
        .map((item, idx) => {
          const inspection = inspections.items[idx];
          const invalid = !inspection?.ok;
          return `
        <label class="option${invalid ? ' option-invalid' : ''}">
          <input type="${inputType}" ${inputName ? `name="${inputName}"` : ''} value="${idx}" ${invalid ? 'disabled' : ''} />
          <span class="icon">${escapeHtml(item.emoji || '🧪')}</span>
          <span class="text">
            <div class="name">${escapeHtml(item.name || '未知')}</div>
            ${isShop ? `<div class="cost">价格: ${escapeHtml(recommendShopPrice('items', item, run.act))} 金币</div>` : ''}
            <div class="desc">${escapeHtml(contentRuleDescription(item, '效果见规则'))}</div>
            ${invalid ? `<div class="reward-validation">不可领取：${escapeHtml(inspection.message)}</div>` : ''}
          </span>
        </label>
      `;
        })
        .join('');
    }
  } else {
    itemSection.style.display = 'none';
  }

  // 显示选择模块
  const hasChoices = cards.length > 0 || artifacts.length > 0 || items.length > 0;
  choiceOverlay.style.display = hasChoices ? 'flex' : 'none';

  // 设置选择事件
  if (hasChoices) {
    setupChoiceEvents(cards, artifacts, items, usableLimits);
  }
}

// 设置选择事件
function setupChoiceEvents(cards: any[], artifacts: any[], items: any[], limits: any) {
  const selections = { cards: [] as number[], artifacts: [] as number[], items: [] as number[] };
  const activeRun = readRunState(__STAT__);
  const isShop = activeRun?.phase === 'in_node' && activeRun.currentNode?.kind === 'shop';

  const idFor = (type: 'cards' | 'artifacts' | 'items', part: 'options' | 'selected') => {
    if (type === 'cards') return `card-${part}`;
    if (type === 'artifacts') return `artifact-${part}`;
    return `item-${part}`;
  };

  function setupOne(type: 'cards' | 'artifacts' | 'items', max: number) {
    const listEl = document.getElementById(idFor(type, 'options')) as HTMLElement | null;
    const selEl = document.getElementById(idFor(type, 'selected')) as HTMLElement | null;
    if (!listEl) return;

    // 所有奖励统一使用checkbox；当 max===1 时，点击新项自动替换旧项
    listEl.querySelectorAll('input[type="checkbox"]').forEach(inp => {
      inp.addEventListener('change', ev => {
        const t = ev.target as HTMLInputElement;
        const idx = parseInt(t.value);
        const arr = selections[type];

        if (t.checked) {
          if (max === 1) {
            // 单选：若已有旧选择且不同，则取消旧选择
            if (arr.length === 1 && arr[0] !== idx) {
              const prevIdx = arr[0];
              const prevInput = listEl.querySelector(
                `input[type="checkbox"][value="${prevIdx}"]`,
              ) as HTMLInputElement | null;
              if (prevInput) prevInput.checked = false;
              arr.length = 0;
            }
            if (arr.indexOf(idx) === -1) arr.push(idx);
          } else if (arr.indexOf(idx) === -1) {
            if (arr.length < max) arr.push(idx);
            else t.checked = false;
          }
        } else {
          const i = arr.indexOf(idx);
          if (i !== -1) arr.splice(i, 1);
        }

        if (selEl) selEl.textContent = String(selections[type].length);
        updateConfirmButtonState(selections, cards, artifacts, items, limits);
      });
    });
  }

  setupOne('cards', limits.cards);
  setupOne('artifacts', limits.artifacts);
  setupOne('items', limits.items);

  // 初始状态更新（允许0选择时启用按钮）
  updateConfirmButtonState(selections, cards, artifacts, items, limits);

  // 设置确认按钮事件（避免重复监听，先用克隆替换）
  const oldBtn = document.getElementById('confirm-btn') as HTMLButtonElement | null;
  if (oldBtn) {
    const confirmBtn = oldBtn.cloneNode(true) as HTMLButtonElement;
    oldBtn.parentNode?.replaceChild(confirmBtn, oldBtn);
    confirmBtn.textContent = isShop ? '结算并离开' : '确认领取';

    confirmBtn.addEventListener('click', async () => {
      if (__isMutating) return;

      // 未选满上限时进行二次确认（仅对存在可选项的类别生效）
      const needConfirm =
        (cards.length > 0 && selections.cards.length < Math.min(limits.cards, cards.length)) ||
        (artifacts.length > 0 && selections.artifacts.length < Math.min(limits.artifacts, artifacts.length)) ||
        (items.length > 0 && selections.items.length < Math.min(limits.items, items.length));
      if (needConfirm) {
        // 内联确认条（采用统一风格，并隐藏原按钮）
        let bar = document.getElementById('inline-confirm-bar') as HTMLElement | null;
        if (!bar) {
          // 隐藏原按钮
          (confirmBtn as HTMLElement).style.display = 'none';

          bar = document.createElement('div');
          bar.id = 'inline-confirm-bar';
          bar.style.cssText = [
            'margin-top:8px',
            'padding:12px',
            'border:1px solid #ffd666',
            'background:#fff7e6',
            'border-radius:8px',
            'box-shadow:0 1px 4px rgba(0,0,0,0.06)',
          ].join(';');
          bar.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
              <span style="color:#ad6800;">您尚未选满所有奖励上限，是否以当前选择继续领取？</span>
              <div style="display:flex;gap:8px;">
                <button id="inline-confirm-yes" class="option-btn">继续领取</button>
                <button id="inline-confirm-no" class="option-btn" style="background:#f0f0f0;color:#333;">取消</button>
              </div>
            </div>
          `;
          confirmBtn.parentElement?.appendChild(bar);
          const yes = document.getElementById('inline-confirm-yes') as HTMLButtonElement | null;
          const no = document.getElementById('inline-confirm-no') as HTMLButtonElement | null;
          yes?.addEventListener('click', async () => {
            bar!.remove();
            (confirmBtn as HTMLElement).style.display = '';
            await doConfirm();
          });
          no?.addEventListener('click', () => {
            bar!.remove();
            (confirmBtn as HTMLElement).style.display = '';
          });
        }
        return;
      }

      await doConfirm();

      async function doConfirm() {
        try {
          __isMutating = true;
          confirmBtn.disabled = true;
          document.getElementById('reward-error')?.remove();
          const selectedRewardCount = selections.cards.length + selections.artifacts.length + selections.items.length;

          // 先隐藏选择模块
          const choiceOverlay = document.getElementById('choice-container');
          if (choiceOverlay) choiceOverlay.style.display = 'none';

          await applyRewardSelectionsInline(selections);

          // 立即重新渲染通知模块以显示用户操作（不要立刻刷新，避免闪烁）
          renderNotifyModule();

          if (typeof toastr !== 'undefined') {
            if (isShop) {
              if (selectedRewardCount > 0) toastr.success('交易已完成！', '商店结算');
              else toastr.info('未购买任何商品。', '已离开商店');
            } else if (selectedRewardCount > 0) {
              toastr.success('奖励已成功领取！', '恭喜！');
            } else {
              toastr.info('已跳过本次奖励。', '继续远征');
            }
          }
          // 领取奖励后需要刷新页面数据
          setTimeout(() => void loadGameData(), 200);
        } catch (e) {
          console.error('确认领取失败', e);
          const message = e instanceof Error ? e.message : '领取奖励失败，请重试';
          const choiceOverlay = document.getElementById('choice-container');
          if (choiceOverlay) choiceOverlay.style.display = 'flex';
          confirmBtn.disabled = false;

          const error = document.createElement('div');
          error.id = 'reward-error';
          error.className = 'reward-error';
          error.setAttribute('role', 'alert');
          error.textContent = message;
          confirmBtn.parentElement?.appendChild(error);
          if (typeof toastr !== 'undefined') toastr.error(message, '奖励领取失败');
        } finally {
          __isMutating = false;
        }
      }
    });
  }
}

// 更新确认按钮状态
function updateConfirmButtonState(selections: any, cards: any[], artifacts: any[], items: any[], limits: any) {
  const confirmBtn = document.getElementById('confirm-btn') as HTMLButtonElement | null;
  if (!confirmBtn) return;

  // 允许跳过（0 选择），仅在写入时禁用按钮
  confirmBtn.disabled = __isMutating;
}

// 主渲染函数
function renderRewardInline(optionsContainer: HTMLElement) {
  if (__isMutating) return; // 防抖

  // 可选奖励存在时，隐藏选项文本和自定义行动，但保留奖励选择界面
  const selectable = hasSelectableRewards(__STAT__);

  if (selectable) {
    // 隐藏选项文本容器
    optionsContainer.style.display = 'none';
    // 隐藏自定义行动
    const customAction = document.querySelector('.custom-action') as HTMLElement;
    if (customAction) customAction.style.display = 'none';
  } else {
    // 显示选项文本容器和自定义行动
    optionsContainer.style.display = '';
    const customAction = document.querySelector('.custom-action') as HTMLElement;
    if (customAction) customAction.style.display = '';
  }
  // 注意：不隐藏整个选项区域，保留奖励选择界面的显示

  // 渲染通知模块
  renderNotifyModule();

  // 渲染选择模块
  renderChoiceModule();

  // 绑定自定义行动（确保在元素渲染后绑定）
  bindCustomActionControls();

  // 设置通知模块的关闭事件
  const notifyDismissBtn = document.getElementById('notify-dismiss-btn');
  if (notifyDismissBtn) {
    notifyDismissBtn.addEventListener('click', () => {
      const notifySection = document.getElementById('notify-section');
      if (notifySection) notifySection.style.display = 'none';
    });
  }

  // 绑定自定义行动发送（统一在独立函数中，避免重复绑定）
  bindCustomActionControls();
}

function applyHistoricalReadOnlyMode(): boolean {
  const isLatest = isCurrentMessageLatest();
  const root = document.querySelector('.mwg-statusbar');
  root?.classList.toggle('is-history', !isLatest);
  if (isLatest) return false;

  const actionSection = document.querySelector('.action-section') as HTMLElement | null;
  if (actionSection) actionSection.style.display = 'none';
  const runActions = document.getElementById('run-actions');
  if (runActions) runActions.replaceChildren();
  const runCurrent = document.getElementById('run-current');
  if (runCurrent && !runCurrent.textContent?.startsWith('历史记录')) {
    runCurrent.textContent = `历史记录 · ${runCurrent.textContent || '远征状态'}`;
  }
  const deleteToggle = document.getElementById('delete-mode-toggle') as HTMLButtonElement | null;
  if (deleteToggle) {
    deleteToggle.disabled = true;
    deleteToggle.title = '历史记录只读';
  }
  document.querySelectorAll<HTMLButtonElement>('.card-delete-btn').forEach(button => {
    button.disabled = true;
    button.style.display = 'none';
  });
  return true;
}

function startLatestMessageGuard(): void {
  if (__stopLatestMessageGuard !== null || !isCurrentMessageWithinDepth(2)) return;
  __stopLatestMessageGuard = watchCurrentMessageDepth(
    {
      onHistorical: () => applyHistoricalReadOnlyMode(),
      onOutOfRange: () => {
        void rerenderHistoricalMessageForDepth().catch(error => {
          console.warn('[MagicGirlWorld] 超出最近三层后卸载状态栏失败，保留只读兜底', error);
        });
        __stopLatestMessageGuard = null;
      },
    },
    2,
  );
}

function contentDescriptionStatusNames(content?: Record<string, any>): Record<string, string> {
  const names: Record<string, string> = {};
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const status = value as Record<string, unknown>;
    if (typeof status.id === 'string' && typeof status.name === 'string' && status.name.trim()) {
      names[status.id] = status.name.trim();
    }
  };
  visit(__STAT__?.battle?.statuses);
  visit(content?.status);
  return names;
}

function contentRuleDescription(content: Record<string, any>, fallback = ''): string {
  return (
    (typeof content?.description === 'string' ? content.description.trim() : '') ||
    describeCompactContent(content, { statusNames: contentDescriptionStatusNames(content) }) ||
    fallback
  );
}

// 翻译卡牌类型
function translateCardType(type: string): string {
  const typeMap: { [key: string]: string } = {
    Attack: '攻击',
    Skill: '技能',
    Power: '能力',
    Event: '事件',
    Curse: '诅咒',
  };
  return typeMap[type] || type;
}

// 初始化UI
function initializeUI() {
  document.getElementById('delete-mode-toggle')?.addEventListener('click', toggleDeleteMode);
  document.querySelector('.battle-book-btn')?.addEventListener('click', toggleBattleBook);
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('#run-repair-btn')) return;
    event.preventDefault();
    const readiness = currentInitialContentReadiness();
    if (readiness && !readiness.ok) void requestInitialContentRepair(readiness);
  });
}

function pendingRunText(): string {
  return [__PENDING_REWARD_SUMMARY, __PENDING_RUN_SUMMARY].filter(Boolean).join('\n\n');
}

function routePrompt(node: RunNodeChoice): string {
  const activeRun = readRunState(__STAT__);
  // Events and rest nodes already have their creative direction in the route
  // marker; avoid rebuilding the full content pack unless budgets are needed.
  const needsBuildContext = isBattleRunNode(node.kind) || node.kind === 'shop';
  const buildContext = needsBuildContext ? currentBuildContext() : null;
  return formatRoutePrompt({
    node,
    runSeed: activeRun?.seed ?? 0,
    run: activeRun,
    // Existing status variables are already injected on ordinary turns. The
    // bounded continuity line is most useful when an event needs story facts.
    worldContinuity: node.kind === 'event' ? formatWorldContinuityHint(__STAT__) : null,
    buildBudget: buildBudgetPrompt(buildContext),
    enemyBudget:
      node.kind === 'battle' || node.kind === 'elite' || node.kind === 'boss'
        ? buildEnemyBudgetPrompt(node, buildContext)
        : null,
    pending: pendingRunText(),
    shopBudget:
      node.kind === 'shop'
        ? `[商店预算] ${formatShopBudget(recommendShopBudget(createRunPacingContext(node, activeRun)))}`
        : null,
    buildGuidance: node.kind === 'shop' ? buildGuidancePrompt(buildContext) : null,
  });
}

function setRunButtonsDisabled(disabled: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('[data-run-action]').forEach(button => {
    button.disabled = disabled;
  });
}

function showRunError(error: unknown, fallback: string): void {
  __RUN_ERROR = error instanceof Error ? error.message : fallback;
  for (const id of ['run-error', 'run-opt-in-error']) {
    const errorEl = document.getElementById(id);
    if (!errorEl) continue;
    errorEl.textContent = __RUN_ERROR;
    errorEl.style.display = '';
  }
  if (typeof toastr !== 'undefined') toastr.error(__RUN_ERROR);
}

async function sendEnteredRunNode(node: RunNodeChoice): Promise<void> {
  if (__IS_SENDING_OPTION) return;
  setSendingState(true);
  setRunButtonsDisabled(true);
  try {
    await runActionHost.enterRunNode(node, routePrompt(node));
    __PENDING_REWARD_SUMMARY = null;
    __PENDING_RUN_SUMMARY = null;
  } catch (error) {
    showRunError(error, '路线进入失败');
    setRunButtonsDisabled(false);
  } finally {
    setSendingState(false);
  }
}

async function retryActiveRunNode(node: RunNodeChoice): Promise<void> {
  if (__IS_SENDING_OPTION) return;
  setSendingState(true);
  setRunButtonsDisabled(true);
  try {
    await runActionHost.retryRunNode(node, routePrompt(node));
    __RUN_ERROR = null;
  } catch (error) {
    showRunError(error, '节点重试失败');
    setRunButtonsDisabled(false);
  } finally {
    setSendingState(false);
  }
}

async function requestInitialContentRepair(readiness: PlayerContentReadiness): Promise<void> {
  if (__IS_SENDING_OPTION || readiness.ok) return;
  const prompt = formatPlayerContentRepairPrompt(readiness);
  if (!prompt) return;
  setSendingState(true);
  setRunButtonsDisabled(true);
  try {
    await commonActionHost.continueWithPrompt({ prompt });
    __RUN_ERROR = null;
  } catch (error) {
    showRunError(error, '请求修复初始战斗内容失败');
    setRunButtonsDisabled(false);
  } finally {
    setSendingState(false);
  }
}

async function requestRestUpgrade(node: RunNodeChoice, card: Record<string, any>): Promise<void> {
  if (__IS_SENDING_OPTION) return;
  setSendingState(true);
  setRunButtonsDisabled(true);
  try {
    await runActionHost.requestRestUpgrade(node, card);
    __RUN_ERROR = null;
  } catch (error) {
    showRunError(error, '升级请求失败');
    setRunButtonsDisabled(false);
  } finally {
    setSendingState(false);
  }
}

async function healAtRest(): Promise<void> {
  try {
    const result = await runActionHost.healAtRest();
    __USER_MUTATION_PILLS.push(`营火恢复：${result.healed}生命`);
    __PENDING_RUN_SUMMARY = `{{user}}在营火恢复了${result.healed}点生命`;
    __RUN_ERROR = null;
    await loadGameData();
  } catch (error) {
    showRunError(error, '营火恢复失败');
  }
}

async function leaveCurrentShop(): Promise<void> {
  try {
    await runActionHost.leaveShop();
    __PENDING_RUN_SUMMARY = '{{user}}离开了商店';
    __RUN_ERROR = null;
    await loadGameData();
  } catch (error) {
    showRunError(error, '离开商店失败');
  }
}

async function restartCurrentRun(): Promise<void> {
  try {
    await runActionHost.restartRun();
    __PENDING_RUN_SUMMARY = '{{user}}开始了一次新的远征';
    __RUN_ERROR = null;
    await loadGameData();
  } catch (error) {
    showRunError(error, '新远征初始化失败');
  }
}

function renderRunData(stat: any): void {
  const section = document.getElementById('run-section');
  const currentEl = document.getElementById('run-current');
  const actions = document.getElementById('run-actions');
  const errorEl = document.getElementById('run-error');
  const optIn = document.getElementById('run-opt-in');
  const repairButton = document.getElementById('run-repair-btn') as HTMLButtonElement | null;
  const optInError = document.getElementById('run-opt-in-error');
  const actionSection = document.querySelector('.action-section') as HTMLElement | null;
  const run = readRunState(stat);
  if (!section || !currentEl || !actions || !errorEl) {
    if (section) section.style.display = 'none';
    return;
  }

  if (!run) {
    section.style.display = 'none';
    const isLatest = isCurrentMessageLatest();
    const expeditionMode = selectedGameMode(stat) === 'expedition';
    if (optIn) optIn.style.display = isLatest && expeditionMode ? '' : 'none';
    if (!isLatest) return;
    const readiness = currentInitialContentReadiness();
    if (repairButton) repairButton.style.display = readiness && !readiness.ok ? '' : 'none';
    if (optInError) {
      optInError.textContent = readiness && !readiness.ok ? formatPlayerContentReadiness(readiness) : '';
      optInError.style.display = readiness && !readiness.ok ? '' : 'none';
    }
    return;
  }

  if (optIn) optIn.style.display = 'none';
  section.style.display = '';
  const isLatest = isCurrentMessageLatest();
  const actEl = document.getElementById('run-act');
  const floorEl = document.getElementById('run-floor');
  const goldEl = document.getElementById('run-gold');
  if (actEl) actEl.textContent = `${run.act}/${run.actCount}`;
  if (floorEl) floorEl.textContent = `${run.floor}/${run.floorsPerAct}`;
  if (goldEl) goldEl.textContent = String(run.gold);

  errorEl.textContent = __RUN_ERROR || '';
  errorEl.style.display = __RUN_ERROR ? '' : 'none';
  actions.innerHTML = '';
  const hasRewards = hasSelectableRewards(stat);
  const needsStoryChoice = run.phase === 'in_node' && run.currentNode?.kind === 'event';
  if (actionSection) actionSection.style.display = isLatest && (hasRewards || needsStoryChoice) ? '' : 'none';

  const addButton = (text: string, className: string, handler: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.runAction = '1';
    button.textContent = text;
    button.addEventListener('click', handler);
    actions.appendChild(button);
  };

  if (!isLatest) {
    currentEl.textContent =
      run.phase === 'awaiting_choice'
        ? `历史记录 · Act ${run.act} 第 ${run.floor + 1} 层前`
        : run.currentNode
          ? `历史记录 · ${runNodeSummary(run.currentNode)}`
          : `历史记录 · ${run.phase === 'won' ? '远征完成' : '远征失败'}`;
    return;
  }

  // Validate the complete first-response content before exposing any route.
  // Later deck-building choices stay creative; reward and upgrade transactions
  // already validate every new persistent definition before committing it.
  const needsInitialContentGate = run.floor === 0 && run.phase === 'awaiting_choice' && !hasRewards;
  const readiness = needsInitialContentGate ? currentInitialContentReadiness() : null;
  if (readiness && !readiness.ok && !needsStoryChoice) {
    currentEl.textContent = readiness.deck.deckQuantity === 0 ? '等待有效起始牌组' : '起始战斗内容需要修复';
    errorEl.textContent = formatPlayerContentReadiness(readiness);
    errorEl.style.display = '';
    addButton('请求 AI 修复', 'run-choice run-repair', () => void requestInitialContentRepair(readiness));
    return;
  }

  if (hasRewards) {
    currentEl.textContent = run.currentNode?.kind === 'shop' ? '商店结算' : '先完成本次奖励结算';
    return;
  }
  if (run.phase === 'awaiting_choice') {
    currentEl.textContent = `Act ${run.act} · 选择第 ${run.floor + 1} 层路线`;
    run.choices.forEach(choice => {
      const label = RUN_NODE_LABELS[choice.kind];
      addButton(
        `${label.icon} ${label.name}${choice.danger ? ` · 危险${choice.danger}` : ''}`,
        `run-choice run-${choice.kind}`,
        () => void sendEnteredRunNode(choice),
      );
    });
    return;
  }
  if (run.phase === 'won' || run.phase === 'lost') {
    currentEl.textContent = run.phase === 'won' ? '远征完成' : '远征失败';
    addButton('开始新远征', 'run-choice', () => void restartCurrentRun());
    return;
  }

  const node = run.currentNode!;
  currentEl.textContent = runNodeSummary(node);
  if (node.kind === 'rest') {
    addButton('恢复 30% 最大生命', 'run-choice run-rest', () => void healAtRest());
    const cards = normalizeOptionsList<Record<string, any>>(stat?.battle?.cards).filter(
      card => Number(card.upgrade_level || 0) < 1,
    );
    cards.forEach(card =>
      addButton(
        `升级 · ${String(card.name || card.id)}`,
        'run-choice run-upgrade',
        () => void requestRestUpgrade(node, card),
      ),
    );
    if (cards.length === 0) currentEl.textContent += ' · 没有可升级卡牌';
    return;
  }
  if (node.kind === 'shop') {
    currentEl.textContent += ' · 未生成商品';
    addButton('重新生成商店', 'run-choice', () => void retryActiveRunNode(node));
    addButton('离开商店', 'run-choice', () => void leaveCurrentShop());
    return;
  }
  if (node.kind === 'event') {
    currentEl.textContent += __RUN_ERROR ? ' · 结果未结算' : ' · 等待事件结果';
    addButton('重新生成事件', 'run-choice', () => void retryActiveRunNode(node));
    return;
  }
  currentEl.textContent += ' · 等待战斗结束';
  addButton('重新进入战斗', 'run-choice', () => void retryActiveRunNode(node));
}

// 基于经验的升级结算：经验阈值为 100 + 50×(当前等级-1)，每到偶数级发放一次删卡次数。
async function settleLevelByExp(): Promise<ProgressionSettlement | null> {
  if (!isCurrentMessageLatest()) return null;
  if (!needsProgressionSettlement(__STAT__?.battle)) return null;
  let settlement: ProgressionSettlement | null = null;
  try {
    await commonActionHost.updateVariablesWith((variables: any) => {
      const statRoot = getStatRootRef(variables) || {};
      const battle = statRoot?.battle;
      if (!battle || typeof battle !== 'object') return variables;
      settlement = settleBattleProgression(battle);
      return variables;
    });
  } catch (e) {
    console.warn('结算升级失败：', e);
  }
  return settlement;
}

function selectedGameMode(stat: any): 'story' | 'expedition' {
  const context = [getRelativeChatMessageText(-1), getRelativeChatMessageText(-2), getCurrentChatMessageText()].join('\n');
  if (context.includes('[远征模式]')) return 'expedition';
  return stat?.game_mode === 'expedition' ? 'expedition' : 'story';
}

async function synchronizeSelectedGameMode(): Promise<void> {
  if (!isCurrentMessageLatest()) return;
  const mode = selectedGameMode(__STAT__);
  if (__STAT__?.game_mode !== mode) {
    await commonActionHost.updateVariablesWith((variables: any) => {
      const stat = getStatRootRef(variables) || {};
      stat.game_mode = mode;
      return variables;
    });
    __STAT__.game_mode = mode;
  }
  if (mode !== 'expedition' || readRunState(__STAT__)) return;
  const readiness = currentInitialContentReadiness();
  if (!readiness?.ok) return;
  await runActionHost.startRun();
  __PENDING_RUN_SUMMARY = '{{user}}选择了远征模式';
}

// 加载游戏数据
async function loadGameData() {
  try {
    // 获取当前变量数据
    let variables = null;
    let rpgData = {};

    try {
      variables = getCurrentMessageVariables();
      __STAT__ = getStatRootRef(variables) || {};
      __DELTA__ = variables?.delta_data || variables?.delta || {};
      rpgData = __STAT__;

    } catch (msgError) {
      console.warn('获取变量失败：', msgError);
      return;
    }

    try {
      await synchronizeSelectedGameMode();
      variables = getCurrentMessageVariables();
      __STAT__ = getStatRootRef(variables) || {};
      __DELTA__ = variables?.delta_data || variables?.delta || {};
      rpgData = __STAT__;
    } catch (error) {
      console.warn('同步游戏模式失败：', error);
    }

    // 剧情模式不触发远征事务；远征模式仅在开始页选择后由程序初始化。
    if (readRunState(__STAT__)) {
      await ensureAndConsumeRunState();
      try {
        variables = getCurrentMessageVariables();
        __STAT__ = getStatRootRef(variables) || {};
        __DELTA__ = variables?.delta_data || variables?.delta || {};
        rpgData = __STAT__;
      } catch (e) {
        console.warn('远征结算后重新获取变量失败：', e);
      }
    }

    // 先结算基于经验的升级（AI只会增加 exp）
    try {
      await settleLevelByExp();
    } catch (e) {
      console.warn('结算升级异常:', e);
    }

    // 结算后重新获取最新变量快照
    try {
      variables = getCurrentMessageVariables();
      __STAT__ = getStatRootRef(variables) || {};
      __DELTA__ = variables?.delta_data || variables?.delta || {};
      rpgData = __STAT__;
    } catch (e) {
      console.warn('结算后重新获取变量失败：', e);
    }

    // 渲染各模块数据
    renderStatusData(rpgData);
    renderBattleData(rpgData);
    renderNPCData(rpgData);
    renderFactionData(rpgData);

    // 渲染选项/通知
    if (!applyHistoricalReadOnlyMode()) renderOptions();
    renderRunData(rpgData);
    startLatestMessageGuard();
  } catch (error) {
    console.error('加载游戏数据失败:', error);
  }
}

// 渲染状态数据
function renderStatusData(rpgData: any) {
  const status = rpgData.status || {};

  // HP和欲望值已移至战斗页面显示，状态栏不再显示这些战斗属性

  const elements = [
    { id: 'status-time', value: status?.time },
    { id: 'status-location', value: readStatusLocation(status) },
  ];

  elements.forEach(({ id, value }) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value || '未知';
    }
  });

  // 职业拆分显示
  const jobNameEl = document.getElementById('status-job-name');
  const jobAbilityEl = document.getElementById('status-job-ability');
  if (jobNameEl || jobAbilityEl) {
    const { name, ability } = readStatusProfession(status);
    if (jobNameEl) jobNameEl.textContent = name || '未知';
    if (jobAbilityEl) jobAbilityEl.textContent = ability || '未知';
  }

  // 服装信息 - 适配新的英文字段名
  const clothing = status.clothing || {};
  const clothingElements = [
    { id: 'clothing-head', path: 'head' },
    { id: 'clothing-neck', path: 'neck' },
    { id: 'clothing-hands', path: 'hands' },
    { id: 'clothing-top', path: 'upper_body' },
    { id: 'clothing-bottom', path: 'lower_body' },
    { id: 'clothing-underwear', path: 'underwear' },
    { id: 'clothing-legs', path: 'legs' },
    { id: 'clothing-feet', path: 'feet' },
  ];

  clothingElements.forEach(({ id, path }) => {
    const element = document.getElementById(id);
    if (element) {
      // 新的数据结构直接存储字符串值
      element.textContent = clothing?.[path] || '未穿戴';
    }
  });

  // 携带物品 - 新的数据结构中持有物是直接的字符串数组
  let items: string[] = status?.['inventory'] || [];
  items = items.filter((item: string) => item !== null && item !== undefined && item !== '');

  const itemsContainer = document.getElementById('carried-items');
  if (itemsContainer) {
    if (items.length > 0) {
      itemsContainer.innerHTML = items
        .map(item => `<div class="info-item"><span class="value">${escapeHtml(item)}</span></div>`)
        .join('');
    } else {
      itemsContainer.innerHTML = '<div class="info-item"><span class="value">无</span></div>';
    }
  }

  // 状态效果 - 支持字符串数组或对象数组格式
  let permanentStatus: any[] = status?.['permanent_status'] || [];
  let temporaryStatus: any[] = status?.['temporary_status'] || [];

  // 过滤空值
  permanentStatus = permanentStatus.filter((item: any) => item !== null && item !== undefined && item !== '');
  temporaryStatus = temporaryStatus.filter((item: any) => item !== null && item !== undefined && item !== '');

  // 渲染永久性状态 - 显示为可点击的标签
  const permanentElement = document.getElementById('permanent-status');
  if (permanentElement) {
    if (permanentStatus.length > 0) {
      permanentElement.innerHTML = permanentStatus
        .map((item: any, index: number) => {
          if (typeof item === 'string') {
            // 字符串格式：只显示标签，无详情
            return `<span class="status-tag status-permanent">${escapeHtml(item)}</span>`;
          } else if (item && typeof item === 'object') {
            const name = item.name || '未知状态';
            const desc = item.description || '';
            const uniqueId = `permanent-status-${index}`;

            if (desc) {
              // 有详情：可点击展开
              return `
                <div class="status-tag-wrapper">
                  <button type="button" class="status-tag status-permanent clickable" data-status-detail-id="${uniqueId}">
                    ${escapeHtml(name)} <span class="expand-icon">▼</span>
                  </button>
                  <div class="status-detail" id="${uniqueId}" style="display: none;">
                    ${escapeHtml(desc)}
                  </div>
                </div>
              `;
            } else {
              // 无详情：只显示标签
              return `<span class="status-tag status-permanent">${escapeHtml(name)}</span>`;
            }
          }
          return `<span class="status-tag status-permanent">${escapeHtml(String(item))}</span>`;
        })
        .join('');
      permanentElement.querySelectorAll<HTMLButtonElement>('[data-status-detail-id]').forEach(button => {
        button.addEventListener('click', () => toggleStatusDetail(button.dataset.statusDetailId || ''));
      });
    } else {
      permanentElement.innerHTML = '<span class="status-tag status-empty">无</span>';
    }
  }

  // 渲染临时状态 - 显示为不可点击的标签
  const temporaryElement = document.getElementById('temporary-status');
  if (temporaryElement) {
    if (temporaryStatus.length > 0) {
      temporaryElement.innerHTML = temporaryStatus
        .map((item: any) => {
          if (typeof item === 'string') {
            return `<span class="status-tag status-temporary">${escapeHtml(item)}</span>`;
          } else if (item && typeof item === 'object') {
            const name = item.name || '未知状态';
            return `<span class="status-tag status-temporary">${escapeHtml(name)}</span>`;
          }
          return `<span class="status-tag status-temporary">${escapeHtml(String(item))}</span>`;
        })
        .join('');
    } else {
      temporaryElement.innerHTML = '<span class="status-tag status-empty">无</span>';
    }
  }
}

// 渲染战斗数据
function renderBattleData(rpgData: any) {
  const battle = rpgData.battle || {};
  const core = battle.core || {};
  const cards = normalizeOptionsList<any>(battle.cards);
  const artifacts = normalizeOptionsList<any>(battle.artifacts);
  const items = normalizeOptionsList<any>(battle.items);

  // 渲染核心属性 - 适配新的数据结构
  const battleHpElement = document.getElementById('battle-hp');
  if (battleHpElement) {
    const hp = core?.hp || 0;
    const maxHp = core?.max_hp || 100;
    battleHpElement.textContent = `${hp}/${maxHp}`;
  }

  const battleDesireElement = document.getElementById('battle-desire');
  if (battleDesireElement) {
    const lust = core?.lust || 0;
    const maxLust = core?.max_lust || 100;
    battleDesireElement.textContent = `${lust}/${maxLust}`;
  }

  const battleLevelElement = document.getElementById('battle-level');
  if (battleLevelElement) {
    // 新的数据结构中等级直接存储在battle中
    const level = battle?.level || 1;
    battleLevelElement.textContent = `LV ${level}`;
  }

  const battleExpElement = document.getElementById('battle-exp');
  if (battleExpElement) {
    // 新的数据结构中经验值直接存储在battle中
    const exp = Number(battle?.exp) || 0;
    const level = Number(battle?.level) || 1;
    const need = requiredExperienceForLevel(level);
    battleExpElement.textContent = `${exp}/${need}`;
  }

  // 更新删除次数显示
  const deleteCountElement = document.getElementById('delete-count');
  if (deleteCountElement) {
    const cardRemove = core?.card_removal_count || 0;
    deleteCountElement.textContent = cardRemove.toString();
  }

  // 同步资源概览中的删卡次数。
  const battleCardRemoveElement = document.getElementById('battle-card-remove');
  if (battleCardRemoveElement) {
    const cardRemove = core?.card_removal_count || 0;
    battleCardRemoveElement.textContent = cardRemove.toString();
  }

  // 修正容器ID以匹配HTML
  const deckContainer = document.getElementById('battle-deck');
  const artifactsContainer = document.getElementById('battle-artifacts');
  const itemsContainer = document.getElementById('battle-items');

  // 渲染牌库 - 简化显示，不显示详细效果
  if (deckContainer) {
    const deck = flattenMvuArray(cards, { objectsOnly: true });

    if (deck.length > 0) {
      // 创建简化的卡牌内容
      const cardsHtml = deck
        .map(
          (card: any) => `
          <div class="card" data-card-id="${escapeHtml(card.id || '')}">
            <button type="button" class="card-delete-btn" data-card-id="${escapeHtml(card.id || '')}" title="删除一张" style="display: none;">
              🗑️
            </button>
            <div class="card-name">${escapeHtml(card.emoji || '🃏')} ${escapeHtml(card.name || '未知')}</div>
            <div class="card-cost">消耗: ${escapeHtml(card.cost ?? 0)}</div>
            <div class="card-type">${escapeHtml(translateCardType(card.type || 'Skill'))}</div>
            <div class="card-quantity">数量: ${escapeHtml(card.quantity || 1)}</div>
          </div>`,
        )
        .join('');

      deckContainer.innerHTML = cardsHtml;
      deckContainer.querySelectorAll<HTMLButtonElement>('.card-delete-btn').forEach(button => {
        button.addEventListener('click', () => void removeCard(button.dataset.cardId || ''));
      });
    } else {
      deckContainer.innerHTML = '<div class="value">牌库为空</div>';
    }
  }

  // 渲染遗物
  if (artifactsContainer) {
    const filteredArtifacts = flattenMvuArray(artifacts, { objectsOnly: true });
    if (filteredArtifacts.length > 0) {
      artifactsContainer.innerHTML = filteredArtifacts
        .map(
          (artifact: any) => `
          <div class="info-item">
            <span class="value">${escapeHtml(artifact.emoji || '💎')} ${escapeHtml(artifact.name || '未知')}: ${escapeHtml(contentRuleDescription(artifact, '效果见规则'))}</span>
          </div>`,
        )
        .join('');
    } else {
      artifactsContainer.innerHTML = '<div class="value">无遗物</div>';
    }
  }

  // 渲染道具 - 简化显示，不提供使用功能
  if (itemsContainer) {
    const filteredItems = flattenMvuArray(items, { objectsOnly: true });
    if (filteredItems.length > 0) {
      itemsContainer.innerHTML = filteredItems
        .map(
          (item: any) => `
          <div class="info-item">
            <span class="value">${escapeHtml(item.emoji || '🧪')} ${escapeHtml(item.name || '未知')} x${escapeHtml(item.count || 1)}</span>
            <div class="item-description">${escapeHtml(contentRuleDescription(item, '效果见规则'))}</div>
          </div>`,
        )
        .join('');
    } else {
      itemsContainer.innerHTML = '<div class="value">无道具</div>';
    }
  }

  // 战斗之书数据准备（不立即渲染，等用户点击时再渲染）
  __BATTLE_BOOK_DATA = {
    playerStatusEffects: battle.player_status_effects || [],
    statuses: battle.statuses || [],
  };
}

// 渲染NPC数据
function renderNPCData(rpgData: any) {
  const npcs = rpgData.npcs || {};
  const relationsContainer = document.getElementById('npc-relations');
  if (relationsContainer) {
    // 过滤掉元数据和非对象条目，根据initvar.json中NPC的实际结构
    const npcEntries = Object.entries(npcs).filter(
      ([key, npc]: [string, any]) =>
        key !== '$meta' && npc && typeof npc === 'object' && !Array.isArray(npc) && (npc.name || npc.NPC姓名),
    );

    if (npcEntries.length > 0) {
      relationsContainer.innerHTML = npcEntries
        .map(([npcId, npc]: [string, any]) => {
          const name = npc?.name ?? npcId;
          const tracking = npc?.tracking ?? false;
          const currentAction = npc?.current_action ?? '无动作';
          const affection = npc?.affection ?? 0;
          const affectionLevel = npc?.affection_level ?? '未知';
          const alignment = npc?.alignment ?? '未知阵营';
          const relationship = npc?.relationship ?? '未知关系';
          const otherNpcRelations = npc?.other_npc_relations ?? '无';
          const level = npc?.level ?? 1;
          const appearance = npc?.appearance ?? '无描述';
          const abilities = npc?.abilities ?? '无';
          const battleStyle = npc?.battle_style ?? '无';

          return `<div class="info-card">
            <h3 class="card-title">${escapeHtml(name)}</h3>
            <div class="info-item">
              <span class="label">追踪状态:</span>
              <span class="value">${tracking ? '追踪中' : '未追踪'}</span>
            </div>
            ${
              tracking
                ? `<div class="info-item">
              <span class="label">当前行动:</span>
              <span class="value">${escapeHtml(currentAction)}</span>
            </div>`
                : ''
            }
            <div class="info-item">
              <span class="label">好感度:</span>
              <span class="value">${escapeHtml(affection)} ${affectionLevel ? `(${escapeHtml(affectionLevel)})` : ''}</span>
            </div>
            <div class="info-item">
              <span class="label">阵营:</span>
              <span class="value">${escapeHtml(alignment)}</span>
            </div>
            <div class="info-item">
              <span class="label">对主角的看法/关系:</span>
              <span class="value">${escapeHtml(relationship)}</span>
            </div>
            <div class="info-item">
              <span class="label">与其他NPC关系:</span>
              <span class="value">${escapeHtml(otherNpcRelations)}</span>
            </div>
            <div class="info-item">
              <span class="label">等级:</span>
              <span class="value">LV ${escapeHtml(level)}</span>
            </div>
            <div class="info-item">
              <span class="label">外貌描述:</span>
              <span class="value">${escapeHtml(appearance)}</span>
            </div>
            <div class="info-item">
              <span class="label">能力描述:</span>
              <span class="value">${escapeHtml(abilities)}</span>
            </div>
            <div class="info-item">
              <span class="label">战斗风格描述:</span>
              <span class="value">${escapeHtml(battleStyle)}</span>
            </div>
          </div>`;
        })
        .join('');
    } else {
      relationsContainer.innerHTML = '<div class="info-card"><h3>暂无NPC关系</h3></div>';
    }
  }

}

// 解析并渲染选项按钮（统一处理普通选项和战斗选项）
function renderOptions() {
  const optionsContainer = document.querySelector('.options-text') as HTMLElement | null;
  if (!optionsContainer) return;

  // 每次渲染新选项时，重置发送锁，并确保自定义行动控件已绑定
  setSendingState(false);
  bindCustomActionControls();

  // 重置整个选项区域的显示状态（确保领取奖励后能正确显示）
  const optionsSection = optionsContainer.closest('.section') as HTMLElement;

  // 先显示整个选项区域，后续根据实际情况调整
  if (optionsSection) {
    optionsSection.style.display = '';
  }

  // 重置选项渲染标记
  optionsContainer.removeAttribute('data-options-rendered');

  // The regex only inserts this shell. Read the owning floor directly so the
  // regex does not capture or transport the full AI response through HTML.
  const messageText = getCurrentChatMessageText();
  const optionsBlock = messageText.match(/<Options\b[^>]*>[\s\S]*?<\/Options>/i)?.[0] || '';
  const rewardMarkers = messageText.match(/<REWARD\b[^>]*>/gi)?.join('\n') || '';
  let raw = [optionsBlock, rewardMarkers].filter(Boolean).join('\n').trim();
  if (!raw) raw = optionsContainer.innerHTML.trim();
  // 如果HTML内容中没有标签，则获取文本内容
  if (!hasOptionTagMarkup(raw)) {
    raw = optionsContainer.textContent || optionsContainer.innerText || raw;
  }

  // 预处理：奖励内联
  const hasRewardTag = /<REWARD\b[^>]*>/i.test(raw);
  const _optionsRawWithoutReward = raw.replace(/<REWARD\b[^>]*>/gi, '').trim();

  // 获取最新变量，用于"无标签但有 reward.*"的情况
  try {
    if (!__STAT__) {
      const v = getCurrentMessageVariables();
      __STAT__ = getStatRootRef(v) || {};
      __DELTA__ = v?.delta_data || v?.delta || {};
    }
  } catch (e) {
    console.warn('获取变量失败（奖励预处理）', e);
  }

  // 奖励处理：
  // - 如果有可选奖励：先渲染奖励并返回（领取或跳过后刷新再渲染选项）
  // - 如果仅有通知标签：渲染通知但不阻塞选项
  // 每次进来先确保选项容器可见，后续如有奖励会临时隐藏
  (optionsContainer as HTMLElement).style.display = '';

  const hasSelectable = hasSelectableRewards(__STAT__);

  // 计算是否存在通知（本次变化/经验等级变化）
  const tmpPills = computeChangePillsByDelta(__DELTA__ || {}, __STAT__ || {});
  const expDispCheck = __DELTA__?.battle?.exp;
  const levelDispCheck = __DELTA__?.battle?.level;
  const hasNotify =
    tmpPills.length > 0 ||
    (typeof expDispCheck === 'string' && expDispCheck.includes('->')) ||
    (typeof levelDispCheck === 'string' && levelDispCheck.includes('->'));

  if (hasSelectable) {
    renderRewardInline(optionsContainer);
    return;
  }
  if (hasRewardTag || hasNotify) {
    renderRewardInline(optionsContainer);
    // 继续渲染选项（不return）
  }

  // 注意：已在函数开头重置了渲染标记，所以这里不需要检查

  // 清空原内容
  optionsContainer.innerHTML = '';

  // 如果没有内容，隐藏选项区域并返回
  if (!raw.trim()) {
    const optionsSectionForHiding = optionsContainer.closest('.section') as HTMLElement;
    if (optionsSectionForHiding) optionsSectionForHiding.style.display = 'none';
    return;
  }

  // 如果内容仍然包含外层Options标签，提取其内容

  let processedRaw = raw;
  const optionsMatch = raw.match(/<Options[^>]*>([\s\S]*?)<\/Options>/i);
  if (optionsMatch) processedRaw = optionsMatch[1].trim();

  // <template> 会按 HTML 规范把 Option/BattleOption 标签转为小写。
  // 统一解析规范化前后的大小写，避免多个选项被拼成一个按钮。
  const taggedOptions = parseOptionTags(processedRaw);
  let hasMatches = false;

  for (const taggedOption of taggedOptions) {
    hasMatches = true;
    const optionType = taggedOption.kind;
    const optionText = taggedOption.text;

    if (optionText) {
      const btn = document.createElement('button');

      // 根据选项类型设置不同的样式和处理函数
      if (optionType === 'battle-option') {
        btn.className = 'battle-option-btn';
        btn.addEventListener('click', () => handleBattleOption(optionText));
      } else {
        btn.className = 'option-btn';
        btn.addEventListener('click', () => handleOption(optionText));
      }

      btn.textContent = optionText;
      optionsContainer.appendChild(btn);

    }
  }
  optionsContainer.setAttribute('data-options-rendered', '1');

  if (!hasMatches) {
    // 优先使用按行解析（最通用的方法）
    const lines = processedRaw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('<') && !l.endsWith('>'));

    if (lines.length > 0) {
      // 按行解析选项
      lines.forEach(line => {
        const cleaned = line.replace(/^\d+[.、)]?\s*/, '').trim();
        if (cleaned) {
          const btn = document.createElement('button');

          // 检查是否是战斗选项（包含战斗相关emoji或关键词）
          const isBattleOption = /[\u2694\u26A1]|战斗|攻击|迎击|冲击/u.test(cleaned);

          const clickOnce = async () => {
            if (isBattleOption) {
              await handleBattleOption(cleaned);
            } else {
              await handleOption(cleaned);
            }
          };

          if (isBattleOption) {
            btn.className = 'battle-option-btn';
            btn.addEventListener('click', clickOnce);
          } else {
            btn.className = 'option-btn';
            btn.addEventListener('click', clickOnce);
          }

          btn.textContent = cleaned;
          optionsContainer.appendChild(btn);
          hasMatches = true;
        }
      });
    } else {
      // 如果按行解析失败，尝试按引号分割（用于特殊格式）
      // 支持中英文引号
      const quotedOptions = processedRaw.match(/["”][^"”]+["”]|"[^"]+"/g);

      if (quotedOptions && quotedOptions.length > 1) {
        quotedOptions.forEach(quotedOption => {
          const optionText = quotedOption
            .replace(/^[""]|[""]$/g, '')
            .replace(/^"|"$/g, '')
            .trim();
          if (optionText) {
            const btn = document.createElement('button');

            // 检查是否是战斗选项
            const isBattleOption = /[\u2694\u26A1]|战斗|攻击|迎击|冲击|来陪|玩玩|碾碎/u.test(optionText);

            if (isBattleOption) {
              btn.className = 'battle-option-btn';
              btn.addEventListener('click', () => handleBattleOption(optionText));
            } else {
              btn.className = 'option-btn';
              btn.addEventListener('click', () => handleOption(optionText));
            }

            btn.textContent = optionText;
            optionsContainer.appendChild(btn);
            hasMatches = true;
          }
        });
      }
    }
  }

  // 统一管理整个选项区域的显示/隐藏：只有在有选项时才显示整个区域
  const optionsSectionForHiding = optionsContainer.closest('.section') as HTMLElement;
  if (optionsSectionForHiding) {
    if (hasMatches) {
      optionsSectionForHiding.style.display = '';
    } else {
      // 无论有没有奖励或通知，没有选项就隐藏整个区域
      optionsSectionForHiding.style.display = 'none';
    }
  }
}

// 添加全局标记防止重复发送
let __IS_SENDING_OPTION = false;

function setSendingState(value: boolean) {
  __IS_SENDING_OPTION = value;
}

// 处理战斗选项点击
async function handleBattleOption(optionText: string) {
  // 防止重复点击
  if (__IS_SENDING_OPTION) return;

  setSendingState(true);

  // 禁用所有选项按钮
  const allButtons = document.querySelectorAll('.option-btn, .battle-option-btn');
  allButtons.forEach(btn => {
    (btn as HTMLButtonElement).disabled = true;
    btn.classList.add('disabled');
  });

  try {
    // 构造战斗触发消息 - 激活战斗系统世界书，并附加奖励摘要
    const activeRun = readRunState(__STAT__);
    const battleTriggerMessage = formatOptionPrompt({
      optionText,
      battle: true,
      node: activeRun?.phase === 'in_node' ? activeRun.currentNode : null,
      pending: pendingRunText(),
      buildBudget: buildBudgetPrompt(currentBuildContext()),
    });

    await commonActionHost.continueWithPrompt({ prompt: battleTriggerMessage });

  } catch (error) {
    console.error('❌ 触发战斗失败:', error);
    alert('触发战斗失败，请重试');

    // 出错时重新启用按钮
    setSendingState(false);
    allButtons.forEach(btn => {
      (btn as HTMLButtonElement).disabled = false;
      btn.classList.remove('disabled');
    });
  } finally {
    // 清空已使用的奖励摘要
    __PENDING_REWARD_SUMMARY = null;
    __PENDING_RUN_SUMMARY = null;
    // 无论成功还是失败，都重置发送状态（成功后由页面刷新处理按钮状态）
    setSendingState(false);
  }
}

// 处理选项点击
async function handleOption(optionText: string) {
  // 防止重复点击
  if (__IS_SENDING_OPTION) return;

  setSendingState(true);

  // 禁用所有选项按钮和自定义输入
  const allButtons = document.querySelectorAll('.option-btn, .battle-option-btn');
  const customInput = document.getElementById('custom-action-input') as HTMLInputElement;
  const customSendBtn = document.getElementById('custom-action-send') as HTMLButtonElement;

  allButtons.forEach(btn => {
    (btn as HTMLButtonElement).disabled = true;
    btn.classList.add('disabled');
  });

  if (customInput) customInput.disabled = true;
  if (customSendBtn) customSendBtn.disabled = true;

  try {
    // 将奖励摘要绑定到本次发送（若有）
    const activeRun = readRunState(__STAT__);
    const message = formatOptionPrompt({
      optionText,
      battle: false,
      node: activeRun?.phase === 'in_node' ? activeRun.currentNode : null,
      pending: pendingRunText(),
    });
    await commonActionHost.continueWithPrompt({ prompt: message });
  } catch (error) {
    console.error('发送选项失败', error);
    alert('发送选项失败，请重试');

    // 出错时重新启用按钮
    setSendingState(false);
    allButtons.forEach(btn => {
      (btn as HTMLButtonElement).disabled = false;
      btn.classList.remove('disabled');
    });
    if (customInput) customInput.disabled = false;
    if (customSendBtn) customSendBtn.disabled = false;
  } finally {
    // 清空已使用的奖励摘要
    __PENDING_REWARD_SUMMARY = null;
    __PENDING_RUN_SUMMARY = null;
    // 无论成功还是失败，都重置发送状态（成功后由页面刷新处理按钮状态）
    setSendingState(false);
  }
}

// 渲染九宫格阵营
function renderAlignmentGrid(currentAlignment: string) {
  const grid = document.getElementById('alignment-grid');
  if (!grid) return;

  const alignments: string[] = [
    '守序善良',
    '中立善良',
    '混乱善良',
    '守序中立',
    '绝对中立',
    '混乱中立',
    '守序邪恶',
    '中立邪恶',
    '混乱邪恶',
  ];
  grid.innerHTML = '';
  alignments.forEach(al => {
    const cell = document.createElement('div');
    cell.className = 'alignment-cell' + (al === currentAlignment ? ' active' : '');
    cell.textContent = al;
    grid.appendChild(cell);
  });
}

// 渲染势力数据
function renderFactionData(gameData: any) {
  const factions = gameData.factions || {};
  const playerAlignment = factions?.player_alignment ?? '绝对中立';
  const relationsRaw = factions.relations || [];
  const relations = flattenMvuArray<Record<string, any>>(relationsRaw, { objectsOnly: true });

  // 渲染九宫格阵营
  renderAlignmentGrid(playerAlignment);

  // 渲染入侵强度徽章与颜色
  const intensityBadge = document.getElementById('invasion-intensity-badge');
  const intensityRow = document.getElementById('invasion-intensity-row');
  const intensityValRaw = factions?.invasion;
  const intensity = Number(intensityValRaw);
  if (intensityBadge) {
    if (Number.isFinite(intensity)) {
      intensityBadge.textContent = String(intensity);
      // 颜色从白 -> 红 -> 黑，按强度加深
      // 计算红色分量与亮度：0→白(#fff)、1-5→不同深度红、6-7→接近黑
      let bg = '#ffffff';
      let color = '#333333';
      if (intensity <= 0) {
        bg = '#ffffff';
        color = '#333333';
      } else if (intensity <= 5) {
        const step = intensity / 5; // 0-1
        // 从#fff过渡到#ff0000的浅色系
        const r = 255;
        const g = Math.round(255 * (1 - step));
        const b = Math.round(255 * (1 - step));
        bg = `rgb(${r}, ${g}, ${b})`;
        color = step > 0.6 ? '#ffffff' : '#662222';
      } else if (intensity === 6) {
        bg = '#7a0000';
        color = '#ffffff';
      } else {
        // 7：绝望，接近黑
        bg = '#111111';
        color = '#ffffff';
      }
      // 行整背景强调
      if (intensityRow) {
        (intensityRow as HTMLElement).style.backgroundColor = bg;
        (intensityRow as HTMLElement).style.color = color;
        (intensityRow as HTMLElement).style.borderRadius = '6px';
        (intensityRow as HTMLElement).style.padding = '6px 10px';
      }
      (intensityBadge as HTMLElement).style.backgroundColor = 'transparent';
      (intensityBadge as HTMLElement).style.color = color;
      (intensityBadge as HTMLElement).style.padding = '2px 8px';
      (intensityBadge as HTMLElement).style.borderRadius = '6px';
      (intensityBadge as HTMLElement).style.border = '1px dashed var(--notebook-border)';
    } else {
      intensityBadge.textContent = '未知';
      if (intensityRow) {
        (intensityRow as HTMLElement).style.backgroundColor = 'transparent';
        (intensityRow as HTMLElement).style.color = 'var(--text-primary)';
      }
      (intensityBadge as HTMLElement).style.backgroundColor = 'transparent';
      (intensityBadge as HTMLElement).style.color = 'var(--text-secondary)';
    }
  }

  // 修正容器ID以匹配HTML
  const container = document.getElementById('faction-relations');

  if (container) {
    if (relations.length > 0) {
      container.innerHTML = relations
        .map((faction: any) => {
          const name = faction.name ?? '未知势力';
          const status = faction.status ?? '中立';
          const reputation = faction.reputation ?? 0;
          const note = faction.note ?? '无';

          return `
        <div class="info-card">
          <h3>${escapeHtml(name)}</h3>
          <div class="info-item">
            <span class="label">状态:</span>
            <span class="value faction-status">${escapeHtml(status)}</span>
          </div>
          <div class="info-item">
            <span class="label">声望:</span>
            <span class="value">${escapeHtml(reputation)}</span>
          </div>
          <div class="info-item">
            <span class="label">备注:</span>
            <span class="value">${escapeHtml(note)}</span>
          </div>
        </div>
      `;
        })
        .join('');
    } else {
      container.innerHTML = '<div class="info-card"><h3>暂无势力关系</h3></div>';
    }
  }
}

// 删除卡牌函数
async function removeCard(cardId: string): Promise<void> {
  try {
    await runActionHost.removeCard(cardId);
    if (typeof toastr !== 'undefined') toastr.success('已删除所选卡牌');
    // 刷新显示，但不影响奖励区域
    try {
      await loadGameData();
    } catch (e) {
      console.warn('刷新数据失败:', e);
    }
  } catch (e) {
    console.error('删除卡牌失败:', e);
    if (typeof toastr !== 'undefined') toastr.error(e instanceof Error ? e.message : '删除卡牌失败，请重试');
  }
}

// 战斗之书切换函数
function toggleBattleBook(): void {
  const content = document.getElementById('battle-book-content');
  const btn = document.querySelector('.battle-book-btn') as HTMLButtonElement;

  if (!content || !btn) return;

  if (content.style.display === 'none') {
    // 显示战斗之书
    content.style.display = 'block';
    btn.textContent = '📖 隐藏状态效果';
    renderBattleBookContent();
  } else {
    // 隐藏战斗之书
    content.style.display = 'none';
    btn.textContent = '📖 查看状态效果';
  }
}

// 渲染战斗之书内容
function renderBattleBookContent() {
  const content = document.getElementById('battle-book-content');
  if (!content) return;

  const data = __BATTLE_BOOK_DATA;
  if (!data) {
    content.innerHTML = '<div class="value">无战斗数据</div>';
    return;
  }

  const playerStatusEffects = flattenMvuArray<Record<string, any>>(data.playerStatusEffects, { objectsOnly: true });
  const allStatuses = flattenMvuArray<Record<string, any>>(data.statuses, { objectsOnly: true });
  const statusNames: Record<string, string> = Object.fromEntries(
    allStatuses
      .filter((status: any) => typeof status?.id === 'string' && typeof status?.name === 'string' && status.name.trim())
      .map((status: any) => [status.id, status.name.trim()]),
  );
  const statusDefinitions = new Map(
    allStatuses
      .filter((status: any) => typeof status?.id === 'string')
      .map((status: any) => {
        const generated = canGenerateCompactStatusDescription(status)
          ? describeCompactStatus(status, { statusNames })
          : '';
        return [
          status.id,
          {
            ...status,
            description: (typeof status.description === 'string' && status.description.trim()) || generated,
          },
        ];
      }),
  );

  let html = '';

  // 当前状态效果
  if (playerStatusEffects.length > 0) {
    html += '<div class="battle-book-section"><h4>🔥 当前状态效果</h4>';
    playerStatusEffects.forEach((status: any) => {
      const definition = statusDefinitions.get(status.id) as Record<string, any> | undefined;
      const name = status.name || definition?.name || status.id || '未知状态';
      const description = status.description || definition?.description || '无描述';
      html += `
        <div class="status-effect-item">
          <div class="status-header">
            <span class="status-icon">${escapeHtml(status.emoji || definition?.emoji || '✨')}</span>
            <span class="status-name">${escapeHtml(name)}</span>
            <span class="status-stacks">${escapeHtml(status.stacks || 1)}</span>
            ${status.duration ? `<span class="status-duration">(${escapeHtml(status.duration)}回合)</span>` : ''}
          </div>
          <div class="status-description">${escapeHtml(description)}</div>
        </div>
      `;
    });
    html += '</div>';
  }

  // 所有已知状态效果
  if (allStatuses.length > 0) {
    html += '<div class="battle-book-section"><h4>📚 状态效果图鉴</h4>';
    allStatuses.forEach((status: any) => {
      const statusType = status.type === 'buff' || status.type === 'debuff' ? status.type : 'neutral';
      const description =
        (typeof status.description === 'string' && status.description.trim()) ||
        (canGenerateCompactStatusDescription(status) ? describeCompactStatus(status, { statusNames }) : '') ||
        '无描述';
      html += `
        <div class="status-effect-item">
          <div class="status-header">
            <span class="status-icon">${escapeHtml(status.emoji || '✨')}</span>
            <span class="status-name">${escapeHtml(status.name || '未知状态')}</span>
            <span class="status-type ${statusType}">${statusType === 'buff' ? 'BUFF' : statusType === 'debuff' ? 'DEBUFF' : 'NEUTRAL'}</span>
          </div>
          <div class="status-description">${escapeHtml(description)}</div>
        </div>
      `;
    });
    html += '</div>';
  }

  if (html === '') {
    html = '<div class="value">暂无状态效果数据</div>';
  }

  content.innerHTML = html;
}

// 切换删除模式函数
function toggleDeleteMode(): void {
  if (!isCurrentMessageLatest()) return;
  const deckContainer = document.getElementById('battle-deck');
  const toggleBtn = document.getElementById('delete-mode-toggle');

  if (!deckContainer || !toggleBtn) return;

  // 检查删卡次数，如果为0则禁用删除模式
  const variables = getCurrentMessageVariables();
  const battle = variables?.stat_data?.battle;
  const cardRemovalCount = Number(battle?.core?.card_removal_count) || 0;

  if (cardRemovalCount <= 0) {
    if (typeof toastr !== 'undefined') toastr.warning('删卡次数不足，无法进入删除模式');
    return;
  }

  const isDeleteMode = deckContainer.classList.contains('delete-mode');

  if (isDeleteMode) {
    // 退出删除模式
    deckContainer.classList.remove('delete-mode');
    toggleBtn.style.backgroundColor = '#ff6b6b';

    // 隐藏所有删除按钮
    const deleteButtons = deckContainer.querySelectorAll('.card-delete-btn');
    deleteButtons.forEach(btn => {
      (btn as HTMLElement).style.display = 'none';
    });
  } else {
    // 进入删除模式
    deckContainer.classList.add('delete-mode');
    toggleBtn.style.backgroundColor = '#51cf66';

    // 显示所有删除按钮
    const deleteButtons = deckContainer.querySelectorAll('.card-delete-btn');
    deleteButtons.forEach(btn => {
      (btn as HTMLElement).style.display = 'block';
    });
  }
}

// 切换状态详情显示
function toggleStatusDetail(detailId: string): void {
  const detailEl = document.getElementById(detailId);
  if (!detailEl) return;

  const isVisible = detailEl.style.display !== 'none';
  detailEl.style.display = isVisible ? 'none' : 'block';

  // 切换箭头方向
  const wrapper = detailEl.closest('.status-tag-wrapper');
  if (wrapper) {
    const icon = wrapper.querySelector('.expand-icon');
    if (icon) {
      icon.textContent = isVisible ? '▼' : '▲';
    }
  }
}

let __commonViewInitialized = false;

function initializeCommonView(): void {
  if (__commonViewInitialized) return;
  __commonViewInitialized = true;
  setSendingState(false);
  initializeUI();
  void loadGameData();
}

// The runtime injects this script after the complete view body. Native DOM
// readiness keeps initialization deterministic in Tavern Helper and also
// supports direct builds without relying on a particular jQuery instance.
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCommonView, { once: true });
  } else {
    initializeCommonView();
  }

  window.addEventListener(
    'pagehide',
    () => {
      __stopLatestMessageGuard?.();
      __stopLatestMessageGuard = null;
    },
    { once: true },
  );
}
