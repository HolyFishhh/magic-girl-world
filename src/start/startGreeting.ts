export interface StartGreetingPorts {
  isLatest(): boolean;
  messageId(): number;
  read(messageId: number): { swipes: string[] } | undefined;
  select(messageId: number, swipeId: number): Promise<void>;
}

/** Select the actual alternate greeting so Tavern owns its variables and routing. */
export async function selectStartGreeting(mode: 'story' | 'tower', ports: StartGreetingPorts): Promise<void> {
  if (!ports.isLatest()) throw new Error('请在最新开场页选择模式。');
  const messageId = ports.messageId();
  if (messageId !== 0) throw new Error('请在第一页选择游戏模式。');
  const marker = `[${mode === 'tower' ? '爬塔' : '剧情'}模式开场]`;
  const swipeId = ports.read(messageId)?.swipes.findIndex(text => text.includes(marker)) ?? -1;
  if (swipeId < 1) throw new Error('没有找到对应开场页，请更新角色卡后重试。');
  await ports.select(messageId, swipeId);
}
