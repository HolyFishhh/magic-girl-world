interface LorebookSettings {
  selected_global_lorebooks: string[];
  scan_depth: number;
  context_percentage: number;
  budget_cap: number;
  min_activations: number;
  max_depth: number;
  max_recursion_steps: number;
  insertion_strategy: 'evenly' | 'character_first' | 'global_first';
  include_names: boolean;
  recursive: boolean;
  case_sensitive: boolean;
  match_whole_words: boolean;
  use_group_scoring: boolean;
  overflow_alert: boolean;
}

interface GetCharLorebooksOption {
  name?: string;
  type?: 'all' | 'primary' | 'additional';
}

/**
 * 获取当前的世界书全局设置
 *
 * @returns 当前的世界书全局设置
 *
 * @example
 * // 获取全局启用的世界书
 * const settings = getLorebookSettings();
 * alert(settings.selected_global_lorebooks);
 */
function getLorebookSettings(): LorebookSettings;

/**
 * 修改世界书全局设置
 *
 * @returns 修改世界书全局设置
 *
 * @example
 * // 修改上下文百分比为 100%, 启用递归扫描
 * await setLorebookSettings({context_percentage: 100, recursive: true});
 *
 * @example
 * // setLorebookSettings 因为酒馆问题很慢, 建议先 getLorebookSetting, 进行比较, 再 setLorebookSettings
 * const expected_settings = { 预期设置 };
 * const settings = getLorebookSettings();
 * if (_.isEqual(_.merge({}, settings, expected_settings), settings)) {
 *   setLorebookSettings(expected_settings);
 * }
 */
function setLorebookSettings(settings: Partial<LorebookSettings>): void;

/**
 * 获取世界书列表
 *
 * @returns 世界书名称列表
 */
function getLorebooks(): string[];

/**
 * 删除世界书
 *
 * @param lorebook 世界书名称
 * @returns 是否成功删除, 可能因世界书不存在等原因而失败
 */
async function deleteLorebook(lorebook: string): Promise<boolean>;

/**
 * 新建世界书
 *
 * @param lorebook 世界书名称
 *
 * @returns 是否成功创建, 如果已经存在同名世界书会失败
 */
async function createLorebook(lorebook: string): Promise<boolean>;

interface CharLorebooks {
  primary: string | null;
  additional: string[];
}

/**
 * 获取角色卡绑定的世界书
 *
 * @param option 可选选项
 *   - `name?:string`: 要查询的角色卡名称; 默认为当前角色卡
 *   - `type?:'all'|'primary'|'additional'`: 按角色世界书的绑定类型筛选世界书; 默认为 `'all'`
 *
 * @returns 一个 CharLorebook 数组
 */
function getCharLorebooks({ name, type }?: GetCharLorebooksOption): CharLorebooks;

/**
 * 获取当前角色卡绑定的主要世界书
 *
 * @returns 如果当前角色卡有绑定并使用世界书 (地球图标呈绿色), 返回该世界书的名称; 否则返回 `null`
 */
function getCurrentCharPrimaryLorebook(): string | null;

/**
 * 设置当前角色卡绑定的世界书
 *
 * @param lorebooks 要设置的世界书信息
 *    - `primary: string | null;`: 主要世界书名称，设为null或空字符串表示移除
 *    - `additional: string[];`: 附加世界书名称数组，设为空数组表示移除所有附加世界书
 */
async function setCurrentCharLorebooks(lorebooks: Partial<CharLorebooks>): Promise<void>;

/**
 * 获取当前聊天绑定的世界书
 *
 * @returns 当前聊天绑定的世界书名称, 或 null 表示没有绑定世界书
 */
async function getChatLorebook(): Promise<string | null>;

/**
 * 设置当前聊天绑定的世界书
 *
 * @param lorebook 世界书名称, 或 null 表示移除世界书
 */
async function setChatLorebook(lorebook: string | null): Promise<void>;

/**
 * 获取或创建当前聊天绑定的世界书
 *
 * @param lorebook 可选参数, 指定世界书名称; 如果未指定, 则根据聊天文件名自动生成一个世界书名称
 *
 * @returns 聊天世界书的名称
 */
async function getOrCreateChatLorebook(lorebook?: string): Promise<string>;
