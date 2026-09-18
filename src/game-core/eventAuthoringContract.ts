import { BATTLE_EVENT_KINDS, BATTLE_EVENT_PHASES, DAMAGE_KINDS, EVENT_SOURCE_KINDS } from './battleEventJournal';

/** Public filter vocabulary; worldbook and request prompts must not maintain copies. */
export function eventFilterVocabularyContract(): string {
  return [
    `事件筛选枚举：trigger.event 与 history.event 使用 ${BATTLE_EVENT_KINDS.join('/')}，不是 trigger.on 的触发名。`,
    `phase：${BATTLE_EVENT_PHASES.join('/')}；source_kind：${EVENT_SOURCE_KINDS.join('/')}；damage_type：${DAMAGE_KINDS.join('/')}。`,
    '这些是可筛选的记录值，不代表每个记录都有同名公开触发器；trigger 的 event/phase 必须与 on 对应，history 按实际记录筛选。',
  ].join('\n');
}
