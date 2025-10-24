interface LorebookEntry {
  /** uid 是相对于世界书内部的, 不要跨世界书使用 */
  uid: number;
  /** 酒馆中将排序设置为 "自定义" 时的显示顺序 */
  display_index: number;

  comment: string;
  enabled: boolean;
  type: 'constant' | 'selective' | 'vectorized';
  position:
    | 'before_character_definition'
    | 'after_character_definition'
    | 'before_example_messages'
    | 'after_example_messages'
    | 'before_author_note'
    | 'after_author_note'
    | 'at_depth_as_system'
    | 'at_depth_as_assistant'
    | 'at_depth_as_user';

  /** 仅对于 `position === 'at_depth_as_???'` 有意义; 其他情况为 null */
  depth: number | null;
  order: number;
  probability: number;

  keys: string[];
  logic: 'and_any' | 'and_all' | 'not_all' | 'not_any';
  filters: string[];

  scan_depth: 'same_as_global' | number;
  case_sensitive: 'same_as_global' | boolean;
  match_whole_words: 'same_as_global' | boolean;
  use_group_scoring: 'same_as_global' | boolean;
  automation_id: string | null;

  exclude_recursion: boolean;
  prevent_recursion: boolean;
  /** 启用则是 true, 如果设置了具体的 Recursion Level 则是数字 (具体参考酒馆中勾选这个选项后的变化) */
  delay_until_recursion: boolean | number;

  content: string;

  group: string;
  group_prioritized: boolean;
  group_weight: number;
  sticky: number | null;
  cooldown: number | null;
  delay: number | null;
}

interface GetLorebookEntriesOption {
  /** 按照指定字段值筛选条目, 如 `{position: 'at_depth_as_system'}` 表示仅获取处于 @D⚙ 的条目; 默认为不进行筛选. 由于实现限制, 只能做到这样的简单筛选; 如果需要更复杂的筛选, 请获取所有条目然后自己筛选. */
  filter?: 'none' | Partial<LorebookEntry>;
}

/**
 * 获取世界书中的条目信息
 *
 * @param lorebook 世界书名称
 *
 * @returns 一个数组, 元素是各条目信息
 *
 * @example
 * // 获取世界书中所有条目的所有信息
 * const entries = await getLorebookEntries("eramgt少女歌剧");
 */
async function getLorebookEntries(lorebook: string): Promise<LorebookEntry[]>;

/**
 * 完全替换世界书 `lorebook` 的所有条目为 `entries`
 *
 * @param lorebook 世界书名称
 * @param entries 要用于替换的世界书条目数组. 如果 `uid` 没有设置或有重复则会新设置 `uid`; 如果某些字段没设置, 则会使用酒馆默认会设置的值.
 *
 * @example
 * // 禁止所有条目递归, 保持其他设置不变
 * const entries = await getLorebookEntries("eramgt少女歌剧");
 * await replaceLorebookEntries("eramgt少女歌剧", entries.map(entry => ({ ...entry, prevent_recursion: true })));
 *
 * @example
 * // 删除所有名字中包含 `神乐光` 的条目
 * const entries = await getLorebookEntries("eramgt少女歌剧");
 * _.remove(entries, entry => entry.comment.includes('神乐光'));
 * await replaceLorebookEntries("eramgt少女歌剧", entries);
 */
async function replaceLorebookEntries(lorebook: string, entries: Partial<LorebookEntry>[]): Promise<void>;

type LorebookEntriesUpdater =
  | ((entries: LorebookEntry[]) => Partial<LorebookEntry>[])
  | ((entries: LorebookEntry[]) => Promise<Partial<LorebookEntry>[]>);

/**
 * 用 `updater` 函数更新世界书 `lorebook`
 *
 * @param updater 用于更新世界书的函数. 它应该接收世界书条目作为参数, 并返回更新后的世界书条目.
 *
 * @returns 更新后的世界书条目
 *
 * @example
 * // 删除所有名字中包含 `神乐光` 的条目
 * await updateLorebookEntriesWith("eramgt少女歌剧", entries => entries.filter(entry => entry.comment.includes('神乐光')))
 */
async function updateLorebookEntriesWith(lorebook: string, updater: LorebookEntriesUpdater): Promise<LorebookEntry[]>;

/**
 * 将条目信息修改回对应的世界书中, 如果某个字段不存在, 则该字段采用原来的值.
 *
 * 这只是修改信息, 不能创建新的条目, 因此要求条目必须已经在世界书中.
 *
 * @param lorebook 条目所在的世界书名称
 * @param entries 一个数组, 元素是各条目信息. 其中必须有 "uid", 而其他字段可选.
 *
 * @returns 更新后的世界书条目
 */
async function setLorebookEntries(
  lorebook: string,
  entries: Array<Pick<LorebookEntry, 'uid'> & Partial<LorebookEntry>>,
): Promise<LorebookEntry[]>;

/**
 * 向世界书中新增条目
 *
 * @param lorebook 世界书名称
 * @param entries 要对新条目设置的字段值, 如果不设置则采用酒馆给的默认值. **不能设置 `uid`**.
 *
 * @returns 更新后的世界书条目, 以及新条目的 uid
 */
async function createLorebookEntries(
  lorebook: string,
  entries: Partial<LorebookEntry>[],
): Promise<{ entries: LorebookEntry[]; new_uids: number[] }>;

/**
 * 删除世界书中的某个条目
 *
 * @param lorebook 世界书名称
 * @param uids 要删除的所有条目 uid
 *
 * @returns 更新后的世界书条目, 以及是否有发生删除
 */
async function deleteLorebookEntries(
  lorebook: string,
  uids: number[],
): Promise<{ entries: LorebookEntry[]; delete_occurred: boolean }>;

//----------------------------------------------------------------------------------------------------------------------
/** @deprecated 请使用 `createLorebookEntries` 代替 */
async function createLorebookEntry(lorebook: string, field_values: Partial<LorebookEntry>): Promise<number>;

/** @deprecated 请使用 `deleteLorebookEntries` 代替 */
async function deleteLorebookEntry(lorebook: string, lorebook_uid: number): Promise<boolean>;
