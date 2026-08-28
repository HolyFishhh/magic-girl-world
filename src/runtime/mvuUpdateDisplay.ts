export type MvuUpdateOperation = 'set' | 'assign' | 'remove' | 'add';

export type MvuUpdateSectionId =
  | 'character'
  | 'battle-core'
  | 'cards'
  | 'artifacts'
  | 'items'
  | 'combat'
  | 'enemy'
  | 'relations'
  | 'rewards'
  | 'other';

export interface MvuUpdateCommand {
  operation: MvuUpdateOperation;
  path: string;
  label: string;
  section: MvuUpdateSectionId;
  oldValue?: unknown;
  value?: unknown;
  itemKey?: unknown;
}

export interface MvuUpdateSection {
  id: MvuUpdateSectionId;
  label: string;
  icon: string;
  commands: MvuUpdateCommand[];
}

const SECTION_META: Readonly<Record<MvuUpdateSectionId, { label: string; icon: string; order: number }>> = {
  character: { label: '角色与剧情', icon: '✨', order: 0 },
  'battle-core': { label: '战斗核心', icon: '❤️', order: 1 },
  cards: { label: '卡牌', icon: '🃏', order: 2 },
  artifacts: { label: '遗物', icon: '🔮', order: 3 },
  items: { label: '道具', icon: '🎒', order: 4 },
  combat: { label: '能力与状态', icon: '⚡', order: 5 },
  enemy: { label: '敌人', icon: '👾', order: 6 },
  relations: { label: '人物与势力', icon: '👥', order: 7 },
  rewards: { label: '奖励', icon: '🎁', order: 8 },
  other: { label: '其他变化', icon: '📌', order: 9 },
};

const PATH_LABELS: Readonly<Record<string, string>> = {
  'status.time': '当前时间',
  'status.location': '当前地点',
  'status.profession': '职业',
  'status.profession.name': '职业名称',
  'status.profession.ability': '职业能力',
  'status.outfit': '服装',
  'status.clothing': '服装',
  'status.inventory': '剧情物品',
  'status.permanent_status': '永久状态',
  'status.temporary_status': '临时状态',
  'battle.core': '玩家核心',
  'battle.core.emoji': '玩家形象',
  'battle.core.hp': '生命',
  'battle.core.max_hp': '生命上限',
  'battle.core.lust': '欲望',
  'battle.core.max_lust': '欲望上限',
  'battle.core.card_removal_count': '删卡次数',
  'battle.level': '等级',
  'battle.exp': '经验',
  'battle.cards': '卡牌',
  'battle.artifacts': '遗物',
  'battle.items': '战斗道具',
  'battle.statuses': '状态定义',
  'battle.player_abilities': '玩家能力',
  'battle.player_status_effects': '玩家战斗状态',
  'battle.player_lust_effect': '玩家欲望效果',
  'battle.enemy': '当前敌人',
  'battle.enemy.lust_effect': '敌人欲望效果',
  'factions.player_alignment': '玩家立场',
  'factions.invasion': '入侵度',
  'factions.relations': '势力关系',
  factions: '势力信息',
  npcs: '人物记录',
  'reward.card': '卡牌奖励',
  'reward.artifact': '遗物奖励',
  'reward.item': '道具奖励',
  'reward.limits': '奖励选择上限',
};

const INTERNAL_PATHS = new Set(['reward.request', 'game_mode', 'run']);

export function extractLastMvuUpdateBlock(message: string): string {
  const matches = [
    ...String(message || '').matchAll(
      /<(?:UpdateVariable|VariableUpdate|Update)>[\s\S]*?<\/(?:UpdateVariable|VariableUpdate|Update)>/gi,
    ),
  ];
  return matches.at(-1)?.[0] || '';
}

function splitArguments(source: string): string[] {
  const values: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{' || char === '[' || char === '(') depth += 1;
    else if (char === '}' || char === ']' || char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      values.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  values.push(source.slice(start).trim());
  return values;
}

function parseLiteral(source: string): unknown {
  const value = source.trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value);
      } catch {
        // Fall back to the same small string escape set accepted by MVU commands.
      }
    }
    return value
      .slice(1, -1)
      .replace(/\\([\\'"nrt])/g, (_match, token: string) => ({ n: '\n', r: '\r', t: '\t' })[token] || token);
  }
  if (value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function mvuUpdatePathLabel(path: string): string {
  if (PATH_LABELS[path]) return PATH_LABELS[path];
  if (path.startsWith('status.outfit.') || path.startsWith('status.clothing.')) {
    return `服装·${mvuUpdateFieldLabel(path.split('.').at(-1) || '')}`;
  }
  if (path.startsWith('battle.enemy.')) return `敌人·${mvuUpdateFieldLabel(path.split('.').at(-1) || '')}`;
  return path;
}

export function mvuUpdateFieldLabel(field: string): string {
  const labels: Readonly<Record<string, string>> = {
    name: '名称',
    ability: '能力',
    emoji: '形象',
    description: '说明',
    head: '头部',
    neck: '颈部',
    hands: '手部',
    upper_body: '上身',
    lower_body: '下身',
    underwear: '内衣',
    legs: '腿部',
    feet: '脚部',
    hp: '生命',
    max_hp: '生命上限',
    lust: '欲望',
    max_lust: '欲望上限',
    card_removal_count: '删卡次数',
    cost: '费用',
    quantity: '数量',
    count: '数量',
    type: '类型',
    rarity: '稀有度',
    role: '身份',
    race: '种族',
    relation: '关系',
    notes: '记录',
  };
  return labels[field] || field;
}

function sectionForPath(path: string): MvuUpdateSectionId {
  if (path.startsWith('status.')) return 'character';
  if (path === 'battle.cards' || path.startsWith('battle.cards.')) return 'cards';
  if (path === 'battle.artifacts' || path.startsWith('battle.artifacts.')) return 'artifacts';
  if (path === 'battle.items' || path.startsWith('battle.items.')) return 'items';
  if (path === 'battle.enemy' || path.startsWith('battle.enemy.')) return 'enemy';
  if (path === 'battle.core' || path.startsWith('battle.core.') || path === 'battle.level' || path === 'battle.exp') {
    return 'battle-core';
  }
  if (path.startsWith('battle.')) return 'combat';
  if (path === 'npcs' || path.startsWith('npcs.') || path === 'factions' || path.startsWith('factions.')) {
    return 'relations';
  }
  if (path.startsWith('reward.')) return 'rewards';
  return 'other';
}

export function parseMvuUpdateCommands(message: string): MvuUpdateCommand[] {
  const source = extractLastMvuUpdateBlock(message) || String(message || '');
  const commands: MvuUpdateCommand[] = [];
  const startPattern = /_\.(set|assign|remove|add)\s*\(/g;
  for (let match = startPattern.exec(source); match; match = startPattern.exec(source)) {
    const operation = match[1] as MvuUpdateOperation;
    const argumentsStart = startPattern.lastIndex;
    let depth = 1;
    let quote = '';
    let escaped = false;
    let argumentsEnd = -1;
    for (let index = argumentsStart; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          argumentsEnd = index;
          break;
        }
      }
    }
    if (argumentsEnd < 0) break;
    startPattern.lastIndex = argumentsEnd + 1;
    const args = splitArguments(source.slice(argumentsStart, argumentsEnd));
    const path = String(parseLiteral(args[0] || '') || '未知字段');
    if (INTERNAL_PATHS.has(path)) continue;
    const command: MvuUpdateCommand = {
      operation,
      path,
      label: mvuUpdatePathLabel(path),
      section: sectionForPath(path),
    };
    if (operation === 'set') {
      if (args.length >= 3) command.oldValue = parseLiteral(args[1]);
      command.value = parseLiteral(args.at(-1) || '');
    } else if (operation === 'assign') {
      if (args.length >= 3) command.itemKey = parseLiteral(args[1]);
      command.value = parseLiteral(args.at(-1) || '');
    } else {
      command.value = parseLiteral(args[1] || '');
    }
    commands.push(command);
  }
  return commands;
}

export function groupMvuUpdateCommands(commands: readonly MvuUpdateCommand[]): MvuUpdateSection[] {
  const groups = new Map<MvuUpdateSectionId, MvuUpdateCommand[]>();
  for (const command of commands) {
    const group = groups.get(command.section) || [];
    group.push(command);
    groups.set(command.section, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => SECTION_META[left].order - SECTION_META[right].order)
    .map(([id, entries]) => ({ id, ...SECTION_META[id], commands: entries }));
}
