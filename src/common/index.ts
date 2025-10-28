// RPG UI - 动态版本入口文件
import './index.scss';

// ============== 文本高亮功能 ==============
/**
 * 轻量级文本高亮实现
 * 只处理文本节点，不修改HTML结构
 */

// 高亮配置：定义需要高亮的模式和对应的CSS类
// 顺序从长标记到短标记，避免短标记抢占匹配
const HIGHLIGHT_PATTERNS = [
  // 先处理最外层常见容器：双引号/单引号
  { start: '“', end: '”', className: 'highlight-quote' }, // 中文双引号
  { start: '"', end: '"', className: 'highlight-quote' }, // 英文双引号
  { start: '‘', end: '’', className: 'highlight-quote' }, // 中文单引号
  // 再处理内部内容：书名号/括号
  { start: '《', end: '》', className: 'highlight-book' },
  { start: '【', end: '】', className: 'highlight-bracket' },
  { start: '[', end: ']', className: 'highlight-bracket' },
  // 最后处理强调
  { start: '**', end: '**', className: 'highlight-emphasis' },
];

/**
 * 在一个文本节点内，按单一模式进行就地分割与包裹（可重复与嵌套）
 */
function processTextNodeWithPattern(textNode: Text, pattern: { start: string; end: string; className: string }): void {
  let current: Text | null = textNode;
  while (current) {
    const content = current.textContent || '';
    if (!content || content.length < pattern.start.length + pattern.end.length + 1) return;

    const startIdx = content.indexOf(pattern.start);
    if (startIdx === -1) return;
    let endIdx = content.indexOf(pattern.end, startIdx + pattern.start.length);
    if (endIdx === -1) return;

    // 避免 ** ** 空内容
    if (pattern.start === '**' && endIdx === startIdx + pattern.start.length) {
      endIdx = content.indexOf(pattern.end, endIdx + pattern.end.length);
      if (endIdx === -1) return;
    }

    const parent = current.parentNode as Node | null;
    if (!parent) return;

    const before = document.createTextNode(content.slice(0, startIdx));
    const innerText = content.slice(startIdx + pattern.start.length, endIdx);
    const after = document.createTextNode(content.slice(endIdx + pattern.end.length));

    const wrapper = document.createElement('span');
    wrapper.className = pattern.className;
    // 仅包裹内部文本，不包含分隔符，便于嵌套匹配
    wrapper.textContent = innerText;

    parent.insertBefore(before, current);
    parent.insertBefore(document.createTextNode(pattern.start), current);
    parent.insertBefore(wrapper, current);
    parent.insertBefore(document.createTextNode(pattern.end), current);
    parent.insertBefore(after, current);
    parent.removeChild(current);

    // 继续在 wrapper 内部（允许下一轮模式匹配其内容）以及 after 上匹配
    // 先在 wrapper 内部应用同一模式（处理同类嵌套情况极少见，通常跳过）
    current = after;
  }
}

/**
 * 递归处理元素的所有文本节点
 */
function applyHighlightsForPattern(element: Element, pattern: { start: string; end: string; className: string }): void {
  // 只处理文本节点，跳过脚本、样式；允许在不同类型高亮内部继续处理（仅跳过相同类型）
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const parent = (node.parentNode as Element) || null;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (['SCRIPT', 'STYLE', 'CODE', 'PRE'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest && parent.closest('.' + pattern.className)) return NodeFilter.FILTER_REJECT;
      const txt = node.textContent || '';
      if (txt.length < pattern.start.length + pattern.end.length + 1) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  nodes.forEach(tn => {
    try {
      processTextNodeWithPattern(tn, pattern);
    } catch {}
  });
}

/**
 * 应用文本高亮
 */
function applyTextHighlight() {
  try {
    // 只在剧情文本区域应用高亮
    const storyElements = document.querySelectorAll('.story-text');

    storyElements.forEach(element => {
      if (element.getAttribute('data-highlighted') === 'true') return;
      try {
        // 按模式顺序逐一处理，允许不同模式在不同轮次包裹，避免互斥
        HIGHLIGHT_PATTERNS.forEach(p => applyHighlightsForPattern(element as Element, p));
        element.setAttribute('data-highlighted', 'true');
      } catch (err) {
        console.warn('处理元素失败:', err);
      }
    });

    console.log('✅ 文本高亮已应用');
  } catch (error) {
    console.error('文本高亮失败:', error);
  }
}

// ============== 主题切换功能 ==============
const THEME_STORAGE_KEY = 'rpg-ui-theme';

// 获取当前主题
function getCurrentTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;

  // 检测系统主题偏好
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

// 应用主题
function applyTheme(theme: 'light' | 'dark') {
  const root = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = themeToggle?.querySelector('.theme-icon');

  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
    if (themeIcon) themeIcon.textContent = '☀️';
  } else {
    root.removeAttribute('data-theme');
    if (themeIcon) themeIcon.textContent = '🌙';
  }

  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

// 切换主题
function toggleTheme() {
  const current = getCurrentTheme();
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
}

// 初始化主题
function initializeTheme() {
  const theme = getCurrentTheme();
  applyTheme(theme);

  // 绑定主题切换按钮
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  console.log('✅ 主题系统已初始化，当前主题:', theme);
}

// 监听系统主题变化
if (window.matchMedia) {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  darkModeQuery.addEventListener('change', e => {
    // 只有在用户没有手动设置主题时才自动切换
    if (!localStorage.getItem(THEME_STORAGE_KEY)) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

// ---------------- 奖励内联渲染：状态与工具 ----------------
let __STAT__: any = null;
let __DELTA__: any = null;
// 记录本轮玩家领取奖励的汇总文本，供下一次选项发送时拼接
let __PENDING_REWARD_SUMMARY: string | null = null;
// 结算前的战斗等级/经验快照（用于通知显示前后对比）
let __PRE_SETTLE_BATTLE: { level: number; exp: number } | null = null;

// 防重复发送标志已移至下方统一定义
// 兼容两种变量根：有些环境将数据放在 variables.stat_data，有些直接放在 variables 顶层
function getStatRootRef(variables: any): any {
  if (variables && typeof variables === 'object') {
    if (variables.stat_data && typeof variables.stat_data === 'object') return variables.stat_data;
    return variables;
  }
  return {};
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
  console.log('[自定义行动] 已绑定');
}

const __PERSIST_PILLS: string[] = [];
// 取消基于上一轮快照的对比，改为直接读取 delta_data

// ---- 注入辅助：将文本注入到下一次 generate()/generateRaw() 调用 ----
const __PENDING_INJECTS: any[] = [];
function enqueueInject(
  text: string,
  opts?: {
    position?: 'before_prompt' | 'in_chat' | 'after_prompt' | 'none';
    depth?: number;
    should_scan?: boolean;
    role?: 'system' | 'assistant' | 'user';
  },
) {
  __PENDING_INJECTS.push({
    role: opts?.role ?? 'system',
    content: text,
    position: opts?.position ?? 'after_prompt',
    depth: typeof opts?.depth === 'number' ? opts.depth : 0,
    should_scan: !!opts?.should_scan,
  });
}
(function wrapGenerateOnce() {
  const w: any = window as any;
  if (w.__AUGMENT_INJECT_WRAPPED) return;
  const wrapOne = (fname: 'generate' | 'generateRaw') => {
    const orig = w[fname];
    if (typeof orig !== 'function') return;
    w[fname] = async (config?: any) => {
      const injects = Array.isArray(config?.injects) ? [...config.injects] : [];
      if (__PENDING_INJECTS.length) injects.push(...__PENDING_INJECTS.splice(0));
      const merged = config && typeof config === 'object' ? { ...config, injects } : { injects };
      return await orig.call(w, merged);
    };
  };
  wrapOne('generate');
  wrapOne('generateRaw');
  w.__AUGMENT_INJECT_WRAPPED = true;
})();

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
  if (Array.isArray(value)) {
    // 统一扁平化：支持 [值]、[[值]]、[值, 描述]、混合形态 [[值], 单个对象, ...]
    const out: any[] = [];
    value.forEach((el: any, idx: number) => {
      if (Array.isArray(el)) out.push(...filterMetadata(el));
      else if (el !== '$__META_EXTENSIBLE__$' && el != null && el !== '') out.push(el);
    });
    return filterMetadata(out);
  }
  if (typeof value === 'object') return [value as T];
  return [];
}

function resolveRewardRoot(stat: any): any {
  const r = stat?.reward;
  if (!r) return null;
  return Array.isArray(r) ? r[0] : r;
}

function hasSelectableRewards(stat: any): boolean {
  const r = resolveRewardRoot(stat);
  if (!r) return false;
  const cards = normalizeOptionsList(r.card);
  const arts = normalizeOptionsList(r.artifact);
  const items = normalizeOptionsList(r.item);
  return cards.length > 0 || arts.length > 0 || items.length > 0;
}

function getRewardLimits(stat: any): { cards: number; artifacts: number; items: number } {
  const r = resolveRewardRoot(stat) || {};
  return {
    cards: r?.limits?.cards || 1,
    artifacts: r?.limits?.artifacts || 1,
    items: r?.limits?.items || 1,
  };
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

    console.log('🔍 解析箭头对:', text);

    const parts = text.split('->');
    if (parts.length < 2) return null;

    const left = parts[0].trim();
    const right = parts.slice(1).join('->').trim();

    console.log('🔍 左侧:', left);
    console.log('🔍 右侧:', right);

    const oldVal = tryParseJson(left);
    const newVal = tryParseJson(right);

    console.log('🔍 解析结果:', { oldVal, newVal });

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
  if (typeof prof === 'string' && prof.includes('->')) pills.push('职业：' + prof);
  else if (prof && typeof prof === 'object') {
    const nameDelta = prof.name;
    const abilityDelta = prof.ability;
    if (typeof nameDelta === 'string' && nameDelta.includes('->')) pills.push('职业名：' + nameDelta);
    if (typeof abilityDelta === 'string' && abilityDelta.includes('->')) pills.push('职业能力：' + abilityDelta);
  }

  // 服装变更（逐字段）
  const clothingDelta = delta?.status?.clothing;
  const clothingKeys = ['head', 'neck', 'hands', 'upper_body', 'lower_body', 'underwear', 'legs', 'feet'];

  console.log('🔍 服装 delta:', clothingDelta);

  if (typeof clothingDelta === 'string' && clothingDelta.includes('->') && clothingDelta.includes('{')) {
    const pair = parseArrowJsonPair(clothingDelta);
    console.log('🔍 解析的服装对:', pair);
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
  // 永久状态、持有物：只显示“新增”类文本；兼容字符串或数组
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

    console.log(`🔍 ${label} delta:`, root);

    const arr = Array.isArray(root) ? root : typeof root === 'string' ? [root] : [];
    arr.forEach((entry: any) => {
      const s = String(entry);
      console.log(`🔍 ${label} 条目:`, s);

      if (s.includes('[') || s.includes('{')) {
        // 可扩展变量：解析包含 JSON 数组片段的变化文本（ASSIGNED/ADDED/等）
        const parsed = parseAssignedArrayFromText(s);
        console.log(`🔍 ${label} 解析结果:`, parsed);

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

async function applyRewardSelectionsInline(selections: { cards: number[]; artifacts: number[]; items: number[] }) {
  await updateVariablesWith(
    (variables: any) => {
      if (!variables.stat_data) throw new Error('stat_data不存在');
      const rewardRoot = variables.stat_data.reward;
      if (!rewardRoot) throw new Error('reward数据不存在');

      // 兼容MVU数组格式与直接对象格式
      const r = Array.isArray(rewardRoot) ? rewardRoot[0] || {} : rewardRoot;

      const pickCards = normalizeOptionsList<any>(r.card);
      const pickArtifacts = normalizeOptionsList<any>(r.artifact);
      const pickItems = normalizeOptionsList<any>(r.item);

      const battle = variables.stat_data.battle;
      const getAppendTarget = (key: 'cards' | 'artifacts' | 'items'): any[] | null => {
        // 仅在目标已经存在且为数组的情况下返回可写入的“值数组”；否则返回 null，避免破坏可扩展模式
        const cur = battle[key];
        if (Array.isArray(cur)) {
          if (cur.length >= 2 && Array.isArray(cur[0]) && typeof cur[1] === 'string') return cur[0];
          if (cur.length >= 1 && Array.isArray(cur[0])) return cur[0];
          return cur;
        }
        console.warn(`[MVU] 目标 ${key} 不存在或非数组，跳过写入以避免破坏可扩展结构`);
        return null;
      };
      const mergeCardInto = (listRef: any[], card: any): void => {
        if (!card || typeof card !== 'object') {
          listRef.push(card);
          return;
        }
        const id = card.id || card.name;
        if (!id) {
          listRef.push(card);
          return;
        }
        // 在现有列表中查找同id的卡，跳过元数据标记
        const existing = listRef.find((x: any) => x && typeof x === 'object' && (x.id || x.name) === id);
        if (existing) {
          const addQty = Math.max(1, Number(card.quantity || 1));
          existing.quantity = Math.max(0, Number(existing.quantity || 1)) + addQty;
        } else {
          // 确保至少有数量1
          if (card.quantity == null) card.quantity = 1;
          listRef.push(card);
        }
      };
      const pushList = (key: 'cards' | 'artifacts' | 'items', dataList: any[], idxList: number[]) => {
        const listRef = getAppendTarget(key);
        if (!Array.isArray(listRef)) {
          console.warn(`[MVU] 追加 ${key} 失败：目标不可写（不存在或非数组）`);
          return;
        }
        idxList.forEach(i => {
          const data = dataList[i];
          if (data == null) return;
          if (Array.isArray(data)) {
            data.forEach(entry => {
              if (entry == null) return;
              if (key === 'cards') mergeCardInto(listRef, entry);
              else listRef.push(entry);
            });
          } else if (key === 'cards') mergeCardInto(listRef, data);
          else listRef.push(data);
        });
      };

      // 收集选择的物品名称，用于注入上下文
      const selectedNames: { cards: string[]; artifacts: string[]; items: string[] } = {
        cards: [],
        artifacts: [],
        items: [],
      };

      if (selections.cards.length) {
        pushList('cards', pickCards, selections.cards);
        selections.cards.forEach(i => {
          const c = pickCards[i];
          if (c) {
            const name = c.name || c.id || '未知';
            const qty = c.quantity ? ` x${c.quantity}` : '';
            __USER_MUTATION_PILLS.push(`新增卡牌：${name}${qty}`);
            selectedNames.cards.push(name + qty);
          }
        });
      }
      if (selections.artifacts.length) {
        pushList('artifacts', pickArtifacts, selections.artifacts);
        selections.artifacts.forEach(i => {
          const a = pickArtifacts[i];
          if (a) {
            const name = a.name || a.id || '未知';
            const qty = (a as any).quantity ? ` x${(a as any).quantity}` : '';
            __USER_MUTATION_PILLS.push(`新增遗物：${name}${qty}`);
            selectedNames.artifacts.push(name + qty);
          }
        });
      }
      if (selections.items.length) {
        pushList('items', pickItems, selections.items);
        selections.items.forEach(i => {
          const it = pickItems[i];
          if (it) {
            const name = it.name || it.id || '未知';
            const qty = (it as any).count
              ? ` x${(it as any).count}`
              : (it as any).quantity
                ? ` x${(it as any).quantity}`
                : '';
            __USER_MUTATION_PILLS.push(`新增道具：${name}${qty}`);
            selectedNames.items.push(name + qty);
          }
        });
      }

      // 不再注入到 generate；领取摘要将绑定到下一次选项发送的消息中
      try {
        const hasSelections =
          selectedNames.cards.length + selectedNames.artifacts.length + selectedNames.items.length > 0;
        if (hasSelections) {
          const parts: string[] = [];
          if (selectedNames.cards.length) parts.push(`卡牌[${selectedNames.cards.join('，')}]`);
          if (selectedNames.artifacts.length) parts.push(`遗物[${selectedNames.artifacts.join('，')}]`);
          if (selectedNames.items.length) parts.push(`道具[${selectedNames.items.join('，')}]`);
          __PENDING_REWARD_SUMMARY = `本轮玩家领取奖励：${parts.join(' ')}`;
          console.log('🎯 已生成领取摘要（待绑定至选项发送）：', __PENDING_REWARD_SUMMARY);
        }
      } catch (e) {
        console.warn('生成领取摘要失败:', e);
      }

      // 清空临时 reward
      r.card = [];
      r.artifact = [];
      r.item = [];
      r.limits = {};
      if (Array.isArray(rewardRoot)) variables.stat_data.reward[0] = r;

      return variables;
    },
    { type: 'message' },
  );
}

// 每升两级发放一次删卡次数（基于本次level的delta，且带去重标记）
async function grantCardRemovalOnLevelUp(oldLevel: number, newLevel: number) {
  if (!Number.isFinite(oldLevel) || !Number.isFinite(newLevel) || newLevel <= oldLevel) return;
  try {
    await updateVariablesWith(
      (variables: any) => {
        const battle = (variables?.stat_data?.battle || variables?.battle) as any;
        if (!battle) return variables;
        if (!battle.core) battle.core = {};
        const lastProcessed = Number(battle.core.last_level_award) || 0;
        const start = Math.max(lastProcessed, oldLevel);
        // 1) 计算步数
        let steps = 0;
        for (let L = start + 1; L <= newLevel; L++) steps++;

        // 2) 每到偶数等级 +1 删卡
        let addRemoval = 0;
        for (let L = start + 1; L <= newLevel; L++) {
          if (L % 2 === 0) addRemoval++;
        }
        if (addRemoval > 0) {
          const prev = Number(battle.core.card_removal_count) || 0;
          battle.core.card_removal_count = prev + addRemoval;
        }

        // 3) 每升一级，下次升级所需经验 +50
        if (steps > 0) {
          const nextExpPrev = Number(battle.next_exp) || 100;
          battle.next_exp = nextExpPrev + steps * 50;
        }

        // 记录已处理到的新等级，避免重复发放
        battle.core.last_level_award = newLevel;
        return variables;
      },
      { type: 'message' },
    );
    console.log(
      `🎯 处理等级奖励：从 Lv.${oldLevel} 到 Lv.${newLevel}，发放删卡次数 +${Math.floor((newLevel - Math.max(oldLevel, 0)) / 2)}（按去重计算）`,
    );
  } catch (e) {
    console.warn('处理等级奖励失败：', e);
  }
}

// 渲染通知模块（插入在正文和选项之间）
function renderNotifyModule() {
  const stat = __STAT__ || {};
  const delta = __DELTA__ || {};

  console.log('📢 渲染通知模块 - stat:', stat);
  console.log('📢 渲染通知模块 - delta:', delta);
  console.log('📢 渲染通知模块 - 用户操作 pills:', __USER_MUTATION_PILLS);

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

  console.log('📢 渲染通知模块 - 最终 pills:', __PERSIST_PILLS);

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
    changesList.innerHTML = __PERSIST_PILLS.map((p: string) => `<span class="pill">${p}</span>`).join('');
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

      // 升级前状态：从当前结算后的状态反推
      const currentLevel = Number(stat?.battle?.level ?? 1);
      const currentExp = Number(stat?.battle?.exp ?? 0);

      // 计算升级前的等级和经验（基于delta的变化量反推）
      const expGain = newExpFromDelta - oldExp;
      let beforeLevel = currentLevel;
      let beforeExp = currentExp;

      // 反向计算：从当前状态减去获得的经验，得到升级前状态
      let remainingToSubtract = expGain;
      while (remainingToSubtract > 0 && beforeLevel > 1) {
        if (beforeExp >= remainingToSubtract) {
          beforeExp -= remainingToSubtract;
          remainingToSubtract = 0;
        } else {
          remainingToSubtract -= beforeExp;
          beforeLevel--;
          beforeExp = Math.max(50 * beforeLevel, 50) - 1; // 上一级的最大经验
        }
      }

      // 如果还有剩余，说明是从更低等级开始的
      if (remainingToSubtract > 0) {
        beforeExp = oldExp;
        beforeLevel = 1;
        let tempExp = beforeExp;
        while (tempExp >= 50 * beforeLevel) {
          tempExp -= 50 * beforeLevel;
          beforeLevel++;
        }
        beforeExp = tempExp;
      }

      const beforeNeed = Math.max(50 * beforeLevel, 50);
      const afterNeed = Math.max(50 * currentLevel, 50);

      // 只有等级真正变化时才显示等级变化
      if (beforeLevel !== currentLevel) {
        lines.push(`等级：LV ${beforeLevel} -> LV ${currentLevel}`);
      }
      lines.push(`经验值：${beforeExp}/${beforeNeed} -> ${currentExp}/${afterNeed}`);
    } else {
      // 如果没有exp变化，只显示当前状态
      const levelNow = Number(stat?.battle?.level ?? 1);
      const expNow = Number(stat?.battle?.exp ?? 0);
      const needNow = Math.max(50 * levelNow, 50);

      lines.push(`等级：LV ${levelNow}`);
      lines.push(`经验值：${expNow}/${needNow}`);
    }

    expDisplay.innerHTML = lines
      .map(t => `<div class="exp-item"><span class="exp-icon">✨</span><span class="exp-text">${t}</span></div>`)
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
  const reward = resolveRewardRoot(stat) || {};
  const limits = getRewardLimits(stat);

  const cards = normalizeOptionsList<any>(reward.card);
  const artifacts = normalizeOptionsList<any>(reward.artifact);
  const items = normalizeOptionsList<any>(reward.item);

  const choiceOverlay = document.getElementById('choice-container');
  const cardSection = document.getElementById('card-rewards-section');
  const artifactSection = document.getElementById('artifact-rewards-section');
  const itemSection = document.getElementById('item-rewards-section');

  if (!choiceOverlay || !cardSection || !artifactSection || !itemSection) return;

  // 渲染卡牌选项
  if (cards.length > 0) {
    cardSection.style.display = 'block';
    const cardOptions = document.getElementById('card-options');
    const cardCount = document.getElementById('card-selection-count');
    const cardSelected = document.getElementById('card-selected');
    const cardMax = document.getElementById('card-max');

    if (cardOptions && cardCount && cardSelected && cardMax) {
      cardCount.textContent = `${cards.length}选${limits.cards}`;
      cardMax.textContent = String(limits.cards);

      const inputType = 'checkbox';
      const inputName = '';

      cardOptions.innerHTML = cards
        .map((card, idx) => {
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

          return `
        <label class="option">
          <input type="${inputType}" ${inputName ? `name="${inputName}"` : ''} value="${idx}" />
          <span class="icon">${card.emoji || '🃏'}</span>
          <span class="text">
            <div class="name">${card.name || '未知'}</div>
            ${costDisplay ? `<div class="cost">${costDisplay}</div>` : ''}
            <div class="desc">${card.description || '无描述'}</div>
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
      artifactCount.textContent = `${artifacts.length}选${limits.artifacts}`;
      artifactMax.textContent = String(limits.artifacts);

      const inputType = 'checkbox';
      const inputName = '';

      artifactOptions.innerHTML = artifacts
        .map(
          (artifact, idx) => `
        <label class="option">
          <input type="${inputType}" ${inputName ? `name="${inputName}"` : ''} value="${idx}" />
          <span class="icon">${artifact.emoji || '💎'}</span>
          <span class="text">
            <div class="name">${artifact.name || '未知'}</div>
            <div class="desc">${artifact.description || '无描述'}</div>
          </span>
        </label>
      `,
        )
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
      itemCount.textContent = `${items.length}选${limits.items}`;
      itemMax.textContent = String(limits.items);

      const inputType = 'checkbox';
      const inputName = '';

      itemOptions.innerHTML = items
        .map(
          (item, idx) => `
        <label class="option">
          <input type="${inputType}" ${inputName ? `name="${inputName}"` : ''} value="${idx}" />
          <span class="icon">${item.emoji || '🧪'}</span>
          <span class="text">
            <div class="name">${item.name || '未知'}</div>
            <div class="desc">${item.description || '无描述'}</div>
          </span>
        </label>
      `,
        )
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
    setupChoiceEvents(cards, artifacts, items, limits);
  }
}

// 设置选择事件
function setupChoiceEvents(cards: any[], artifacts: any[], items: any[], limits: any) {
  const selections = { cards: [] as number[], artifacts: [] as number[], items: [] as number[] };

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

          // 先隐藏选择模块
          const choiceOverlay = document.getElementById('choice-container');
          if (choiceOverlay) choiceOverlay.style.display = 'none';

          await applyRewardSelectionsInline(selections);

          // 向聊天末尾插入一条用户消息，告知本轮领取的奖励（当前阶段不隐藏，便于测试观察）
          try {
            const parts: string[] = [];
            // 从当前可选项中按索引取名称，构造汇总文本
            if (selections.cards.length) {
              const names = selections.cards
                .map(
                  i =>
                    (cards[i]?.name || cards[i]?.id || '未知') + (cards[i]?.quantity ? ` x${cards[i]?.quantity}` : ''),
                )
                .filter(Boolean);
              if (names.length) parts.push(`卡牌[${names.join('，')}]`);
            }
            if (selections.artifacts.length) {
              const names = selections.artifacts
                .map(
                  i =>
                    (artifacts[i]?.name || artifacts[i]?.id || '未知') +
                    (artifacts[i]?.quantity ? ` x${artifacts[i]?.quantity}` : ''),
                )
                .filter(Boolean);
              if (names.length) parts.push(`遗物[${names.join('，')}]`);
            }
            if (selections.items.length) {
              const names = selections.items
                .map(
                  i =>
                    (items[i]?.name || items[i]?.id || '未知') +
                    (items[i]?.count ? ` x${items[i]?.count}` : items[i]?.quantity ? ` x${items[i]?.quantity}` : ''),
                )
                .filter(Boolean);
              if (names.length) parts.push(`道具[${names.join('，')}]`);
            }

            // 不再插入对话：改为缓存汇总文本，待用户下一次发送选项时一并附带
            __PENDING_REWARD_SUMMARY = parts.length ? `{{user}}已获得：${parts.join(' ')}` : '{{user}}没有领取奖励';
            console.log('✅ 已缓存本轮奖励选择摘要（将附带到下一次选项发送中）:', __PENDING_REWARD_SUMMARY);
          } catch (err) {
            console.warn('插入玩家奖励选择消息失败:', err);
          }

          // 立即重新渲染通知模块以显示用户操作（不要立刻刷新，避免闪烁）
          renderNotifyModule();

          if (typeof toastr !== 'undefined') toastr.success('奖励已成功领取！', '恭喜！');
          // 领取奖励后需要刷新页面数据
          setTimeout(() => (window as any).refreshData(), 200);
        } catch (e) {
          console.error('确认领取失败', e);
          if (typeof toastr !== 'undefined') toastr.error('领取奖励失败，请重试', '错误');
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

  console.log('🎁 渲染奖励内联 - 开始');
  console.log('🎁 渲染奖励内联 - 可选奖励:', hasSelectableRewards(__STAT__));

  // 可选奖励存在时，隐藏选项文本和自定义行动，但保留奖励选择界面
  const selectable = hasSelectableRewards(__STAT__);

  if (selectable) {
    // 隐藏选项文本容器
    optionsContainer.style.display = 'none';
    // 隐藏自定义行动
    const customAction = document.querySelector('.custom-action') as HTMLElement;
    if (customAction) customAction.style.display = 'none';
    console.log('🎁 有可选奖励，隐藏选项文本和自定义行动');
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

// 过滤掉数组中的元数据标记
function filterMetadata(arr: any[]): any[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    item => item !== '$__META_EXTENSIBLE__$' && item !== '[]' && item !== undefined && item !== null && item !== '',
  );
}

// 清除临时奖励变量
async function clearRewardTemps() {
  // 遵循只读策略：不再主动清理 reward 变量，由上游脚本或AI决定何时移除
  console.group('[奖励系统] 跳过清理临时奖励变量（只读策略）');
  console.groupEnd();
}

// 翻译卡牌类型
function translateCardType(type: string): string {
  const typeMap: { [key: string]: string } = {
    Attack: '攻击',
    Skill: '技能',
    Power: '能力',
    Event: '事件',
    Corrupt: '腐化',
  };
  return typeMap[type] || type;
}

// 安全获取变量值的函数
function safeGetValue(obj: any, path: string, defaultValue: any = '未知'): any {
  try {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return defaultValue;
      }
    }

    // 如果是数组格式 [value, description]，取第一个元素（忽略元数据占位）
    if (Array.isArray(current) && current.length > 0) {
      let value = current[0];
      if (value === '$__META_EXTENSIBLE__$' || value === '[]') {
        for (let i = 1; i < current.length; i++) {
          if (current[i] !== '$__META_EXTENSIBLE__$' && current[i] !== '[]') {
            value = current[i];
            break;
          }
        }
        if (value === '$__META_EXTENSIBLE__$' || value === '[]') return defaultValue;
      }
      return value;
    }

    return current === null || current === undefined ? defaultValue : current;
  } catch (error) {
    console.warn('获取变量值失败:', path, error);
    return defaultValue;
  }
}

// 安全获取完整数组的函数（用于持有物、状态等直接的字符串数组）
function safeGetArray(obj: any, path: string, defaultValue: any[] = []): any[] {
  try {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return defaultValue;
      }
    }
    if (Array.isArray(current))
      return current.filter(
        (item: any) =>
          item !== '$__META_EXTENSIBLE__$' && item !== '[]' && item !== undefined && item !== null && item !== '',
      );
    return defaultValue;
  } catch (error) {
    console.warn('获取数组失败:', path, error);
    return defaultValue;
  }
}

// 初始化UI
function initializeUI() {
  console.log('初始化RPG UI界面');
  // renderOptions() 将在 loadGameData() 中调用，避免重复渲染
}

// 设置标签切换功能
function setupTabSwitching() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const moduleContents = document.querySelectorAll('.module-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', function (this: HTMLElement) {
      const targetModule = this.getAttribute('data-module');

      // 移除所有活动状态
      tabButtons.forEach(btn => btn.classList.remove('active'));
      moduleContents.forEach(content => ((content as HTMLElement).style.display = 'none'));

      // 设置当前活动状态
      this.classList.add('active');
      const targetContent = document.getElementById(targetModule + '-content');
      if (targetContent) {
        targetContent.style.display = 'block';
      }
    });
  });
}

// 基于经验的升级结算：按 50×当前等级 结算多级升级，并在每个偶数级发放一次删卡次数
async function settleLevelByExp(): Promise<void> {
  try {
    await updateVariablesWith(
      async (variables: any) => {
        const statRoot = getStatRootRef(variables) || {};
        const battle = statRoot?.battle || variables?.battle;
        if (!battle) return variables;
        if (!battle.core) battle.core = {};

        let level = Number(battle.level) || 1;
        let exp = Number(battle.exp) || 0;
        let promotions = 0;

        const required = (lv: number) => Math.max(50 * lv, 50);
        while (exp >= required(level)) {
          exp -= required(level);
          level += 1;
          promotions += 1;
          if (level % 2 === 0) {
            const prev = Number(battle.core.card_removal_count) || 0;
            battle.core.card_removal_count = prev + 1;
          }
        }

        if (promotions > 0) {
          battle.level = level;
          battle.exp = exp;
        }
        return variables;
      },
      { type: 'message' },
    );
  } catch (e) {
    console.warn('结算升级失败：', e);
  }
}

// 加载游戏数据
async function loadGameData() {
  try {
    // 获取当前变量数据
    let variables = null;
    let rpgData = {};

    try {
      variables = getVariables({ type: 'message' });
      __STAT__ = getStatRootRef(variables) || {};
      __DELTA__ = variables?.delta_data || variables?.delta || {};
      rpgData = __STAT__;

      console.log('🔄 加载游戏数据 - 变量:', variables);
      console.log('🔄 加载游戏数据 - stat_data:', __STAT__);
      console.log('🔄 加载游戏数据 - delta_data:', __DELTA__);

      // 第一次加载时，__PREV_ROUND_STAT 为空，这样第一轮不会显示任何变化
      // 在渲染完成后会更新为当前状态，供下一轮使用
    } catch (msgError) {
      console.warn('获取变量失败：', msgError);
      return;
    }

    // 先结算基于经验的升级（AI只会增加exp）
    try {
      await settleLevelByExp();
    } catch (e) {
      console.warn('结算升级异常:', e);
    }

    // 结算后重新获取最新变量快照
    try {
      variables = getVariables({ type: 'message' });
      __STAT__ = getStatRootRef(variables) || {};
      __DELTA__ = variables?.delta_data || variables?.delta || {};
      rpgData = __STAT__;
      // 保存本轮结算前的快照（用于通知显示前后对比）
      __PRE_SETTLE_BATTLE = {
        level: Number(__STAT__?.battle?.level ?? 1),
        exp: Number(__STAT__?.battle?.exp ?? 0),
      };
    } catch (e) {
      console.warn('结算后重新获取变量失败：', e);
    }

    // 渲染各模块数据
    renderStatusData(rpgData);
    renderBattleData(rpgData);
    renderNPCData(rpgData);
    renderFactionData(rpgData);

    // 渲染选项/通知
    console.log('🔄 加载游戏数据 - 开始渲染选项');
    renderOptions();
    console.log('🔄 加载游戏数据 - 渲染选项完成');

    // 应用文本高亮（新的轻量级实现）
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        setTimeout(() => applyTextHighlight(), 50);
      });
    } else {
      setTimeout(() => applyTextHighlight(), 100);
    }
  } catch (error) {
    console.error('加载游戏数据失败:', error);
  }
}

// 渲染状态数据
function renderStatusData(rpgData: any) {
  const status = rpgData.status || {};

  // HP和欲望值已移至战斗页面显示，状态栏不再显示这些战斗属性

  const elements = [
    { id: 'status-time', path: 'time' },
    { id: 'status-location', path: 'location' },
  ];

  elements.forEach(({ id, path }) => {
    const element = document.getElementById(id);
    if (element) {
      // 新的数据结构直接存储字符串值，不再是[值, 描述]格式
      element.textContent = status?.[path] || '未知';
    }
  });

  // 职业拆分显示
  const jobNameEl = document.getElementById('status-job-name');
  const jobAbilityEl = document.getElementById('status-job-ability');
  if (jobNameEl || jobAbilityEl) {
    const prof = status?.profession || {};
    const name = prof && typeof prof === 'object' && 'name' in prof ? (prof as any).name : '';
    const ability = prof && typeof prof === 'object' && 'ability' in prof ? (prof as any).ability : '';
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
        .map(item => `<div class="info-item"><span class="value">${item}</span></div>`)
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
            return `<span class="status-tag status-permanent">${item}</span>`;
          } else if (item && typeof item === 'object') {
            const name = item.name || '未知状态';
            const desc = item.description || '';
            const uniqueId = `permanent-status-${index}`;

            if (desc) {
              // 有详情：可点击展开
              return `
                <div class="status-tag-wrapper">
                  <span class="status-tag status-permanent clickable" onclick="toggleStatusDetail('${uniqueId}')">
                    ${name} <span class="expand-icon">▼</span>
                  </span>
                  <div class="status-detail" id="${uniqueId}" style="display: none;">
                    ${desc}
                  </div>
                </div>
              `;
            } else {
              // 无详情：只显示标签
              return `<span class="status-tag status-permanent">${name}</span>`;
            }
          }
          return `<span class="status-tag status-permanent">${String(item)}</span>`;
        })
        .join('');
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
            return `<span class="status-tag status-temporary">${item}</span>`;
          } else if (item && typeof item === 'object') {
            const name = item.name || '未知状态';
            return `<span class="status-tag status-temporary">${name}</span>`;
          }
          return `<span class="status-tag status-temporary">${String(item)}</span>`;
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
    const need = Math.max(50 * level, 50);
    battleExpElement.textContent = `${exp}/${need}`;
  }

  // 更新删除次数显示
  const deleteCountElement = document.getElementById('delete-count');
  if (deleteCountElement) {
    const cardRemove = core?.card_removal_count || 0;
    deleteCountElement.textContent = cardRemove.toString();
  }

  // 更新旧的删除次数显示元素
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
    const deck = filterMetadata(cards || []);

    if (deck.length > 0) {
      // 创建简化的卡牌内容
      const cardsHtml = deck
        .map(
          (card: any) => `
          <div class="card" data-card-id="${card.id}">
            <div class="card-delete-btn" onclick="removeCard('${card.id}')" style="display: none;">
              🗑️
            </div>
            <div class="card-name">${card.emoji || '🃏'} ${card.name}</div>
            <div class="card-cost">消耗: ${card.cost || 0}</div>
            <div class="card-type">${translateCardType(card.type || 'Skill')}</div>
            <div class="card-quantity">数量: ${card.quantity || 1}</div>
          </div>`,
        )
        .join('');

      deckContainer.innerHTML = cardsHtml;
    } else {
      deckContainer.innerHTML = '<div class="value">牌库为空</div>';
    }
  }

  // 渲染遗物
  if (artifactsContainer) {
    const filteredArtifacts = filterMetadata(artifacts);
    if (filteredArtifacts.length > 0) {
      artifactsContainer.innerHTML = filteredArtifacts
        .map(
          (artifact: any) => `
          <div class="info-item">
            <span class="value">${artifact.emoji || '💎'} ${artifact.name}: ${artifact.description}</span>
          </div>`,
        )
        .join('');
    } else {
      artifactsContainer.innerHTML = '<div class="value">无遗物</div>';
    }
  }

  // 渲染道具 - 简化显示，不提供使用功能
  if (itemsContainer) {
    const filteredItems = filterMetadata(items);
    if (filteredItems.length > 0) {
      itemsContainer.innerHTML = filteredItems
        .map(
          (item: any) => `
          <div class="info-item">
            <span class="value">${item.emoji || '🧪'} ${item.name} x${item.count || 1}</span>
            <div class="item-description">${item.description || '无描述'}</div>
          </div>`,
        )
        .join('');
    } else {
      itemsContainer.innerHTML = '<div class="value">无道具</div>';
    }
  }

  // 战斗之书数据准备（不立即渲染，等用户点击时再渲染）
  (window as any).battleBookData = {
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
          // 兼容MVU格式 [值, 描述] 和直接值格式
          const getValue = (field: any, defaultVal: any = '未知') => {
            if (Array.isArray(field) && field.length > 0) {
              return field[0]; // MVU格式取第一个元素
            }
            return field || defaultVal;
          };

          const name = getValue(npc?.name, npcId);
          const tracking = getValue(npc?.tracking, false);
          const currentAction = getValue(npc?.current_action, '无动作');
          const affection = getValue(npc?.affection, 0);
          const affectionLevel = getValue(npc?.affection_level, '未知');
          const alignment = getValue(npc?.alignment, '未知阵营');
          const relationship = getValue(npc?.relationship, '未知关系');
          const otherNpcRelations = getValue(npc?.other_npc_relations, '无');
          const level = getValue(npc?.level, 1);
          const appearance = getValue(npc?.appearance, '无描述');
          const abilities = getValue(npc?.abilities, '无');
          const battleStyle = getValue(npc?.battle_style, '无');

          return `<div class="info-card">
            <h3 class="card-title">${name}</h3>
            <div class="info-item">
              <span class="label">追踪状态:</span>
              <span class="value">${tracking ? '追踪中' : '未追踪'}</span>
              <button class="tracking-btn ${tracking ? 'tracking-on' : 'tracking-off'}"
                      onclick="toggleNPCTracking('${npcId}', ${!tracking})">
                ${tracking ? '🔴 停止追踪' : '🟢 开始追踪'}
              </button>
            </div>
            ${
              tracking
                ? `<div class="info-item">
              <span class="label">当前行动:</span>
              <span class="value">${currentAction}</span>
            </div>`
                : ''
            }
            <div class="info-item">
              <span class="label">好感度:</span>
              <span class="value">${affection} ${affectionLevel ? `(${affectionLevel})` : ''}</span>
            </div>
            <div class="info-item">
              <span class="label">阵营:</span>
              <span class="value">${alignment}</span>
            </div>
            <div class="info-item">
              <span class="label">对主角的看法/关系:</span>
              <span class="value">${relationship}</span>
            </div>
            <div class="info-item">
              <span class="label">与其他NPC关系:</span>
              <span class="value">${otherNpcRelations}</span>
            </div>
            <div class="info-item">
              <span class="label">等级:</span>
              <span class="value">LV ${level}</span>
            </div>
            <div class="info-item">
              <span class="label">外貌描述:</span>
              <span class="value">${appearance}</span>
            </div>
            <div class="info-item">
              <span class="label">能力描述:</span>
              <span class="value">${abilities}</span>
            </div>
            <div class="info-item">
              <span class="label">战斗风格描述:</span>
              <span class="value">${battleStyle}</span>
            </div>
          </div>`;
        })
        .join('');
    } else {
      relationsContainer.innerHTML = '<div class="info-card"><h3>暂无NPC关系</h3></div>';
    }
  }

  // 移除互动记录功能
}

// 解析并渲染选项按钮（统一处理普通选项和战斗选项）
function renderOptions() {
  console.log('🚀 renderOptions() 被调用，当前发送状态:', __IS_SENDING_OPTION);
  const optionsContainer = document.querySelector('.options-text') as HTMLElement | null;
  if (!optionsContainer) {
    console.log('❌ 找不到 .options-text 容器');
    return;
  }

  // 每次渲染新选项时，重置发送锁，并确保自定义行动控件已绑定
  console.log('🔄 重置发送状态从', __IS_SENDING_OPTION, '到 false');
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

  // 优先从template标签获取原始内容（防止XML标签被浏览器过滤）
  let raw = '';
  const templateId = optionsContainer.getAttribute('data-source');
  if (templateId) {
    const templateEl = document.getElementById(templateId) as HTMLTemplateElement | null;
    if (templateEl && templateEl.content) {
      // 从template中提取文本内容
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(templateEl.content.cloneNode(true));
      raw = tempDiv.innerHTML.trim();
      console.log('📋 从template获取内容:', raw);
    }
  }

  // 如果template为空或不存在，回退到直接读取
  if (!raw) {
    raw = optionsContainer.innerHTML.trim();
    console.log('📋 从innerHTML获取内容:', raw);
  }

  console.log('🔍 Options调试信息:', {
    原始长度: raw.length,
    前100字符: raw.substring(0, 100),
    包含Option标签: raw.includes('<Option'),
    包含BattleOption标签: raw.includes('<BattleOption'),
    包含Options外层标签: raw.includes('<Options'),
  });

  // 如果HTML内容中没有标签，则获取文本内容
  if (!raw.includes('<Option') && !raw.includes('<BattleOption') && !raw.includes('<Options')) {
    // 尝试从template获取纯文本
    if (templateId) {
      const templateEl = document.getElementById(templateId) as HTMLTemplateElement | null;
      if (templateEl) {
        const tempDiv = document.createElement('div');
        tempDiv.appendChild(templateEl.content.cloneNode(true));
        raw = tempDiv.textContent || tempDiv.innerText || '';
      }
    }
    // 如果还是空的，从容器获取
    if (!raw) {
      raw = optionsContainer.textContent || optionsContainer.innerText || '';
    }
    console.log('🔄 使用文本内容:', raw);
  }

  // 预处理：奖励内联
  const hasRewardTag = raw.includes('<REWARD>');
  const _optionsRawWithoutReward = raw.replace(/<REWARD>/g, '').trim();

  // 获取最新变量，用于"无标签但有 reward.*"的情况
  try {
    if (!__STAT__) {
      const v = getVariables({ type: 'message' });
      __STAT__ = getStatRootRef(v) || {};
      __DELTA__ = v?.delta_data || v?.delta || {};
    }
  } catch (e) {
    console.warn('获取变量失败（奖励预处理）', e);
  }

  // 调试：打印当前 delta 和 stat 状态
  console.log('🔍 当前 delta_data:', __DELTA__);
  console.log(' 当前 stat_data:', __STAT__);
  try {
    console.log('📦 完整 stat_data JSON:', JSON.stringify(__STAT__, null, 2));
  } catch (e) {
    console.warn('stat_data 序列化失败:', e);
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

  // 调试：打印通知状态
  console.log('🔍 通知 pills:', tmpPills);
  console.log('🔍 经验变化:', expDispCheck);
  console.log('🔍 等级变化:', levelDispCheck);
  console.log('🔍 有通知:', hasNotify);

  console.log('🎯 渲染选项 - 有可选奖励:', hasSelectable);
  console.log('🎯 渲染选项 - 有奖励标签:', hasRewardTag);
  console.log('🎯 渲染选项 - 有通知:', hasNotify);

  if (hasSelectable) {
    console.log('🎯 渲染选项 - 渲染奖励内联（有可选奖励）');
    renderRewardInline(optionsContainer);
    return;
  }
  if (hasRewardTag || hasNotify) {
    console.log('🎯 渲染选项 - 渲染奖励内联（有奖励标签或通知）');
    renderRewardInline(optionsContainer);
    // 继续渲染选项（不return）
  }

  // 注意：已在函数开头重置了渲染标记，所以这里不需要检查

  // 清空原内容
  optionsContainer.innerHTML = '';

  // 如果没有内容，隐藏选项区域并返回
  if (!raw.trim()) {
    const optionsSectionForHiding = optionsContainer.closest('.section') as HTMLElement;
    if (optionsSectionForHiding) {
      optionsSectionForHiding.style.display = 'none';
      console.log('❌ 无原始内容，隐藏整个选项区域');
    }
    return;
  }

  // 如果内容仍然包含外层Options标签，提取其内容

  let processedRaw = raw;
  if (raw.includes('<Options')) {
    const optionsMatch = raw.match(/<Options[^>]*>([\s\S]*?)<\/Options>/i);
    if (optionsMatch) {
      processedRaw = optionsMatch[1].trim();
      console.log('🔧 提取Options内层内容:', processedRaw);
    }
  }

  // 使用正则表达式匹配Option和BattleOption标签
  const optionRegex = /<(Option|BattleOption)[^>]*>([\s\S]*?)<\/\1>/g;
  let match;
  let hasMatches = false;

  console.log('🎯 开始匹配选项标签:', {
    原始内容: raw,
    处理后内容: processedRaw,
    正则表达式: optionRegex.toString(),
  });

  while ((match = optionRegex.exec(processedRaw)) !== null) {
    hasMatches = true;
    const optionType = match[1]; // 'Option' 或 'BattleOption'
    const optionText = match[2].trim();

    console.log('匹配到选项:', optionType, optionText); // 调试日志

    if (optionText) {
      const btn = document.createElement('button');

      // 根据选项类型设置不同的样式和处理函数
      if (optionType === 'BattleOption') {
        btn.className = 'battle-option-btn';
        btn.addEventListener('click', () => {
          console.log('🎯 标准战斗选项被点击:', optionText);
          handleBattleOption(optionText);
        });
        console.log('创建战斗选项按钮:', optionText, 'className:', btn.className);
      } else {
        btn.className = 'option-btn';
        btn.addEventListener('click', () => {
          console.log('🎯 标准普通选项被点击:', optionText);
          handleOption(optionText);
        });
        console.log('创建普通选项按钮:', optionText, 'className:', btn.className);
      }

      btn.textContent = optionText;
      optionsContainer.appendChild(btn);

      // 验证按钮是否正确添加到DOM
      console.log('按钮已添加到DOM，最终className:', btn.className);
    }
  }
  optionsContainer.setAttribute('data-options-rendered', '1');

  // 不再维护上一轮快照

  if (!hasMatches) {
    console.log('没有匹配到任何选项，尝试智能解析'); // 调试日志

    // 优先使用按行解析（最通用的方法）
    const lines = processedRaw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('<') && !l.endsWith('>'));

    console.log('🔍 检测到的行数:', lines.length, '内容:', lines);

    if (lines.length > 0) {
      // 按行解析选项
      lines.forEach(line => {
        const cleaned = line.replace(/^\d+[.、)]?\s*/, '').trim();
        if (cleaned) {
          const btn = document.createElement('button');

          // 检查是否是战斗选项（包含战斗相关emoji或关键词）
          const isBattleOption = /[\u2694\u26A1]|战斗|攻击|迎击|冲击/u.test(cleaned);

          const clickOnce = async () => {
            console.log('🎯 按行解析按钮被点击:', cleaned);
            if (isBattleOption) {
              await handleBattleOption(cleaned);
            } else {
              await handleOption(cleaned);
            }
          };

          if (isBattleOption) {
            btn.className = 'battle-option-btn';
            btn.addEventListener('click', clickOnce);
            console.log('✅ 创建战斗选项按钮:', cleaned);
          } else {
            btn.className = 'option-btn';
            btn.addEventListener('click', clickOnce);
            console.log('✅ 创建普通选项按钮:', cleaned);
          }

          btn.textContent = cleaned;
          optionsContainer.appendChild(btn);
          hasMatches = true;
        }
      });
    } else {
      // 如果按行解析失败，尝试按引号分割（用于特殊格式）
      // 支持中英文引号
      const quotedOptions = processedRaw.match(/[""][^""]+[""]|"[^"]+"/g);

      if (quotedOptions && quotedOptions.length > 1) {
        console.log('🔍 检测到引号分割的选项:', quotedOptions);
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
              btn.addEventListener('click', () => {
                console.log('🎯 智能解析战斗选项被点击:', optionText);
                handleBattleOption(optionText);
              });
              console.log('✅ 创建智能解析战斗选项:', optionText);
            } else {
              btn.className = 'option-btn';
              btn.addEventListener('click', () => {
                console.log('🎯 智能解析普通选项被点击:', optionText);
                handleOption(optionText);
              });
              console.log('✅ 创建智能解析普通选项:', optionText);
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
      console.log('✅ 有选项，显示整个选项区域');
    } else {
      // 无论有没有奖励或通知，没有选项就隐藏整个区域
      optionsSectionForHiding.style.display = 'none';
      console.log('❌ 无选项，隐藏整个选项区域');
    }
  }
}

// 添加全局标记防止重复发送
let __IS_SENDING_OPTION = false;

// 创建一个代理来监听状态变化
const sendingStateProxy = {
  _value: false,
  get value() {
    return this._value;
  },
  set value(newValue) {
    console.log('📊 发送状态变化:', this._value, '->', newValue, '调用栈:', new Error().stack?.split('\n')[2]?.trim());
    this._value = newValue;
    __IS_SENDING_OPTION = newValue;
  },
};

// 重写所有设置 __IS_SENDING_OPTION 的地方使用代理
function setSendingState(value: boolean) {
  sendingStateProxy.value = value;
}

// 处理战斗选项点击
async function handleBattleOption(optionText: string) {
  // 防止重复点击
  if (__IS_SENDING_OPTION) {
    console.log('⏳ 正在处理中，请稍候...');
    return;
  }

  setSendingState(true);

  // 禁用所有选项按钮
  const allButtons = document.querySelectorAll('.option-btn, .battle-option-btn');
  allButtons.forEach(btn => {
    (btn as HTMLButtonElement).disabled = true;
    btn.classList.add('disabled');
  });
  console.log('🔥 战斗选项被点击:', optionText);

  try {
    // 构造战斗触发消息 - 激活战斗系统世界书，并附加奖励摘要
    const extra = __PENDING_REWARD_SUMMARY ? `\n\n${__PENDING_REWARD_SUMMARY}` : '';
    const battleTriggerMessage = `用户选择了战斗选项：${optionText}${extra}\n\n[开始战斗]`;

    // 发送消息并触发AI生成
    await triggerSlash(`/send ${battleTriggerMessage}`);
    await triggerSlash('/trigger');

    console.log('✅ 战斗触发消息已发送，等待AI生成战斗内容');
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
    // 无论成功还是失败，都重置发送状态（成功后由页面刷新处理按钮状态）
    setSendingState(false);
  }
}

// 处理选项点击
async function handleOption(optionText: string) {
  console.log('🎯 handleOption 被调用，选项:', optionText, '当前发送状态:', __IS_SENDING_OPTION);
  // 防止重复点击
  if (__IS_SENDING_OPTION) {
    console.log('⏳ 正在处理中，请稍候...（状态已被设置为true）');
    return;
  }

  console.log('🔄 设置发送状态为 true');
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

  console.log('🎯 普通选项被点击:', optionText);
  try {
    // 将奖励摘要绑定到本次发送（若有）
    const extra = __PENDING_REWARD_SUMMARY ? `\n\n${__PENDING_REWARD_SUMMARY}` : '';
    const message = `用户的选择是：${optionText}${extra}`;
    // 发送并触发
    await triggerSlash(`/send ${message}`);
    await triggerSlash('/trigger');
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
  // 兼容MVU格式的getValue函数
  const getValue = (field: any, defaultVal: any = '未知') => {
    if (Array.isArray(field) && field.length > 0) {
      return field[0]; // MVU格式取第一个元素
    }
    return field || defaultVal;
  };

  // 兼容MVU格式和直接值格式
  const playerAlignment = getValue(factions?.player_alignment, '绝对中立');
  const relationsRaw = factions.relations || [];
  const relations = Array.isArray(relationsRaw) ? filterMetadata(relationsRaw) : [];

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
          // 兼容MVU格式处理每个势力对象的字段
          const name = getValue(faction.name, '未知势力');
          const status = getValue(faction.status, '中立');
          const reputation = getValue(faction.reputation, 0);
          const note = getValue(faction.note, '无');

          return `
        <div class="info-card">
          <h3>${name}</h3>
          <div class="info-item">
            <span class="label">状态:</span>
            <span class="value faction-status ${status.toLowerCase() || 'neutral'}">${status}</span>
          </div>
          <div class="info-item">
            <span class="label">声望:</span>
            <span class="value">${reputation}</span>
          </div>
          <div class="info-item">
            <span class="label">备注:</span>
            <span class="value">${note}</span>
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

// 调试函数 - 暴露到全局作用域
(window as any).refreshData = async function () {
  console.log('刷新游戏数据');
  await loadGameData();
  // 应用文本高亮（新的轻量级实现）
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      setTimeout(() => applyTextHighlight(), 50);
    });
  } else {
    setTimeout(() => applyTextHighlight(), 100);
  }
};

// 调试函数 - 检查发送状态
(window as any).checkSendingState = function () {
  console.log('当前发送状态:', __IS_SENDING_OPTION);
  const allButtons = document.querySelectorAll('.option-btn, .battle-option-btn');
  console.log('找到的按钮数量:', allButtons.length);
  allButtons.forEach((btn, index) => {
    console.log(`按钮 ${index}:`, {
      text: btn.textContent,
      disabled: (btn as HTMLButtonElement).disabled,
      className: btn.className,
    });
  });
  return __IS_SENDING_OPTION;
};

// 调试函数 - 重置发送状态
(window as any).resetSendingState = function () {
  console.log('重置发送状态，当前状态:', __IS_SENDING_OPTION);
  __IS_SENDING_OPTION = false;

  // 重新启用所有按钮
  const allButtons = document.querySelectorAll('.option-btn, .battle-option-btn');
  const customInput = document.getElementById('custom-action-input') as HTMLInputElement;
  const customSendBtn = document.getElementById('custom-action-send') as HTMLButtonElement;

  allButtons.forEach(btn => {
    (btn as HTMLButtonElement).disabled = false;
    btn.classList.remove('disabled');
  });

  if (customInput) customInput.disabled = false;
  if (customSendBtn) {
    customSendBtn.disabled = false;
    customSendBtn.classList.remove('disabled');
  }

  console.log('发送状态已重置，所有按钮已重新启用');
};

// 删除卡牌函数
(window as any).removeCard = async function (cardId: string) {
  try {
    if (!cardId) {
      console.warn('无效的卡牌ID');
      return;
    }
    await updateVariablesWith(
      (variables: any) => {
        const battle = (variables?.stat_data?.battle || variables?.battle) as any;
        if (!battle) throw new Error('未找到 battle 变量');

        const processCardArray = (arr: any[]) => {
          let removed = 0;
          const processed = (arr || [])
            .map((c: any) => {
              if (c && c.id === cardId) {
                const currentQuantity = Number(c.quantity) || 1;
                if (currentQuantity > 1) {
                  // 数量>1时减1
                  removed++;
                  return { ...c, quantity: currentQuantity - 1 };
                } else {
                  // 数量=1时删除整张卡
                  removed++;
                  return null;
                }
              }
              return c;
            })
            .filter(c => c !== null);
          return { processed, removed };
        };

        let removed = 0;
        if (Array.isArray(battle.cards)) {
          // 兼容MVU可扩展数组结构：[valueArray, description] 或 [[...]] 或 直接数组
          if (battle.cards.length >= 2 && Array.isArray(battle.cards[0]) && typeof battle.cards[1] === 'string') {
            const res = processCardArray(battle.cards[0]);
            battle.cards[0] = res.processed;
            removed += res.removed;
          } else if (battle.cards.length >= 1 && Array.isArray(battle.cards[0])) {
            const res = processCardArray(battle.cards[0]);
            battle.cards[0] = res.processed;
            removed += res.removed;
          } else {
            const res = processCardArray(battle.cards);
            battle.cards = res.processed;
            removed += res.removed;
          }
        }

        // 更新删卡次数（删除成功时-1）
        if (!battle.core) battle.core = {};
        const prev = Number(battle.core.card_removal_count) || 0;
        if (removed > 0) battle.core.card_removal_count = Math.max(0, prev - 1);

        return variables; // 提交更新
      },
      { type: 'message' },
    );
    if (typeof toastr !== 'undefined') toastr.success('已删除所选卡牌');
    // 刷新显示，但不影响奖励区域
    try {
      await loadGameData();
    } catch (e) {
      console.warn('刷新数据失败:', e);
    }
  } catch (e) {
    console.error('删除卡牌失败:', e);
    if (typeof toastr !== 'undefined') toastr.error('删除卡牌失败，请重试');
  }
};

// 注意：道具使用功能已移除，应在fish战斗模块中处理

// 战斗之书切换函数
(window as any).toggleBattleBook = function () {
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
};

// 渲染战斗之书内容
function renderBattleBookContent() {
  const content = document.getElementById('battle-book-content');
  if (!content) return;

  const data = (window as any).battleBookData;
  if (!data) {
    content.innerHTML = '<div class="value">无战斗数据</div>';
    return;
  }

  const playerStatusEffects = filterMetadata(data.playerStatusEffects);
  const allStatuses = filterMetadata(data.statuses);

  let html = '';

  // 当前状态效果
  if (playerStatusEffects.length > 0) {
    html += '<div class="battle-book-section"><h4>🔥 当前状态效果</h4>';
    playerStatusEffects.forEach((status: any) => {
      html += `
        <div class="status-effect-item">
          <div class="status-header">
            <span class="status-icon">${status.emoji || '✨'}</span>
            <span class="status-name">${status.name}</span>
            <span class="status-stacks">${status.stacks || 1}</span>
            ${status.duration ? `<span class="status-duration">(${status.duration}回合)</span>` : ''}
          </div>
          <div class="status-description">${status.description || '无描述'}</div>
        </div>
      `;
    });
    html += '</div>';
  }

  // 所有已知状态效果
  if (allStatuses.length > 0) {
    html += '<div class="battle-book-section"><h4>📚 状态效果图鉴</h4>';
    allStatuses.forEach((status: any) => {
      html += `
        <div class="status-effect-item">
          <div class="status-header">
            <span class="status-icon">${status.emoji || '✨'}</span>
            <span class="status-name">${status.name}</span>
            <span class="status-type ${status.type}">${status.type === 'buff' ? 'BUFF' : 'DEBUFF'}</span>
          </div>
          <div class="status-description">${status.description || '无描述'}</div>
          ${status.triggers ? `<div class="status-triggers">触发: ${JSON.stringify(status.triggers)}</div>` : ''}
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

// NPC追踪切换函数
(window as any).toggleNPCTracking = async function (npcId: string, newTrackingState: boolean) {
  console.warn('[只读模式] common 页面不修改 NPC 追踪状态。');
  return;
};

// 获得经验的测试函数
(window as any).gainExperience = async function (expAmount: number = 160) {
  console.warn('[只读模式] common 页面不在此处直接写入经验。');
  return;
};

// 经验升级处理函数
async function processLevelUp() {
  console.warn('[只读模式] common 页面不在此处直接处理升级。');
  return;
}

// 切换删除模式函数
(window as any).toggleDeleteMode = function () {
  const deckContainer = document.getElementById('battle-deck');
  const toggleBtn = document.getElementById('delete-mode-toggle');

  if (!deckContainer || !toggleBtn) return;

  // 检查删卡次数，如果为0则禁用删除模式
  const variables = (window as any).getVariables?.({ type: 'message' }) || {};
  const battle = variables?.stat_data?.battle || variables?.battle;
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
};

// 调试函数 - 检查数据结构
(window as any).debugData = function () {
  try {
    const data = getVariables({ type: 'message' });
    console.log('=== 完整数据结构 ===');
    console.log(data);

    if (data?.stat_data) {
      console.log('=== stat_data 结构 ===');
      console.log(data.stat_data);

      if (data.stat_data.status) {
        console.log('=== 状态数据详细分析 ===');
        const status = data.stat_data.status;

        // 检查每个字段的类型和内容
        Object.keys(status).forEach(key => {
          const value = status[key];
          console.log(`${key}:`, {
            type: typeof value,
            isArray: Array.isArray(value),
            value: value,
            length: Array.isArray(value) ? value.length : 'N/A',
          });
        });

        console.log('=== 重点检查数组字段 ===');
        console.log('持有物:', status['inventory']);
        console.log('永久性状态:', status['permanent_status']);
        console.log('临时状态:', status['temporary_status']);
      }

      if (data.stat_data.battle) {
        console.log('=== 战斗数据 ===');
        console.log('battle.items:', data.stat_data.battle.items);
        console.log('battle.artifacts:', data.stat_data.battle.artifacts);
      }

      if (data.stat_data.npcs) {
        console.log('=== NPC数据 ===');
        console.log('npcs:', data.stat_data.npcs);
      }
    }

    alert('数据结构已输出到控制台，请查看');
  } catch (error: any) {
    console.error('调试失败:', error);
    alert('调试失败: ' + (error?.message || '未知错误'));
  }
};

// 测试变量操作函数
(window as any).testVariableOperations = async function () {
  console.warn('[只读模式] 已禁用本页面的测试变量写入操作。');
  return;
};

(window as any).switchToStory = function () {
  const storyButton = document.querySelector('.tab-button[data-module="story"]') as HTMLElement;
  if (storyButton) {
    storyButton.click();
  }
};

// 移除了战斗开始标签检测功能
// 战斗触发现在完全由用户点击选项按钮和世界书处理

// 移除了loadBattleFromVariables函数
// 战斗触发现在完全由用户点击选项按钮和世界书处理

// 移除了validateBattleData和replaceToBattlePage函数
// 这些功能现在由用户点击选项按钮和世界书处理

// 切换状态详情显示
(window as any).toggleStatusDetail = function (detailId: string) {
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
};

// 页面加载完成后的初始化
if (typeof window !== 'undefined') {
  // 尽早初始化主题，避免闪烁
  if (document.readyState === 'loading') {
    const theme = getCurrentTheme();
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  }

  const w: any = window as any;
  const $jq = w.$ || w.jQuery;
  if ($jq) {
    $jq(() => {
      console.log('RPG UI 静态模板已加载 - 使用酒馆变量宏系统');
      initializeTheme();
      setSendingState(false);
      initializeUI();
      setupTabSwitching();
      loadGameData().then(() => console.log('✅ Common模块完全初始化完成'));
    });
    $jq(w).on('pagehide', () => {
      console.log('🧹 页面卸载：清理临时状态');
      // 目前仅记录日志，核心状态由上游管理
    });
  }
}
