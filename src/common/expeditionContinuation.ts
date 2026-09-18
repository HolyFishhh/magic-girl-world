import { readGameMode } from '../game-core/towerMode';
import { TavernCommonActionHost } from './commonActionHost';

/** Only a completed expedition may release its mode lock. Keep all character data. */
export function finishExpeditionIntoStory(stat: Record<string, any>): void {
  if (readGameMode(stat) !== 'tower' || !['won', 'lost'].includes(stat.run?.phase))
    throw new Error('只有远征结束后才能转入剧情模式');
  stat.completed_expedition = { run: stat.run, node: stat.run_node ?? null };
  stat.game_mode = 'story';
  stat.game_mode_lock = { schemaVersion: 1, mode: 'story' };
  stat.run = null;
  // These belong to the finished route, not to the continuing character.
  for (const key of ['run_node', 'run_result', 'run_event', 'run_event_state', 'run_reward', 'run_shop']) delete stat[key];
}

export async function continueExpeditionStory(input: string): Promise<void> {
  if (!input.trim()) throw new Error('请先输入想继续的剧情');
  const host = TavernCommonActionHost.getInstance();
  await host.continueWithPrompt<Record<string, any>>({
    prompt: `本次远征已结束，接下来转入普通剧情模式。沿用已有角色、卡组、道具、资源和状态，按现有结果与我的行动继续；不重建初始角色，不补注册无关变量，不再推进旧远征路线。后续仍可按剧情战斗和成长。\n\n我的行动：${input.trim()}`,
    prepare: async () => {
      let before: Record<string, any> = {};
      await host.updateVariablesWith(variables => {
        before = structuredClone(variables.stat_data);
        finishExpeditionIntoStory(variables.stat_data);
        return variables;
      });
      return before;
    },
    rollbackBeforeSend: before => host.updateVariablesWith(variables => {
      variables.stat_data = before;
      return variables;
    }).then(() => undefined),
  });
}
