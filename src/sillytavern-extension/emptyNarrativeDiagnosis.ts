import type { NarrativeDeliveryMetadata } from './narrativeDeliveryObservation';

/** Describe evidence, not provider/model guesses. Never treat reasoning as story. */
export function describeEmptyNarrative(delivery?: NarrativeDeliveryMetadata): string {
  const wire = delivery?.wire;
  if (!wire) return '未取得接口流证据，暂不能判断空正文来源';
  const counts = `接口正文 ${wire.bodyCharacters} 字符，思考 ${wire.reasoningCharacters} 字符`;
  if (wire.failure) return `流内返回接口错误；${counts}`;
  if (wire.bodyCharacters > 0) return `接口含正文，但酒馆助手未交付正文，需检查提取或过滤；${counts}`;
  if (!wire.complete || wire.truncated || wire.readFailed) return `接口流观察不完整，不能认定上游没有正文；${counts}`;
  const ending = wire.finishReasons.includes('length') ? '；接口报告长度限制' : '';
  return `${wire.reasoningCharacters > 0 ? '接口流只有思考，没有可识别正文' : '接口流未返回可识别正文'}${ending}；${counts}`;
}
