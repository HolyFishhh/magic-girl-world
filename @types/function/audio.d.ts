/**
 * 切换音频播放模式
 */
async function audioMode(args: { type: string; mode: string }): Promise<void>;

/**
 * 切换播放器开关状态
 */
async function audioEnable(args: { type: string; state?: string }): Promise<void>;

/**
 * 切换播放/暂停状态
 */
async function audioPlay(args: { type: string; play?: string }): Promise<void>;

/**
 * 导入音频链接
 */
async function audioImport(args: { type: string; play?: string }, url: string): Promise<void>;

/**
 * 选择并播放音频
 */
async function audioSelect(args: { type: string }, url: string): Promise<void>;
