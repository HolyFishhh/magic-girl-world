/**
 * 统一的效果分析器（轻量推断）
 * - 从效果字符串推断意图类型与数值
 * - 同时兼容两类来源：
 *   1) 旧的 key:value 片段（如 "damage:10", "lust_damage:5", "block:8"）
 *   2) 新的统一表达式（如 "OP.hp - 10", "ME.block + 8"）
 */

import { UnifiedEffectParser } from '../combat/unifiedEffectParser';

export type IntentType = 'attack' | 'lust_attack' | 'defend' | 'heal' | 'buff' | 'debuff' | 'special' | 'unknown';

export interface IntentSummary {
  type: IntentType;
  damage?: number;
  lustDamage?: number;
  block?: number;
}

const parser = UnifiedEffectParser.getInstance();

export function inferIntentFromEffect(effect: string): IntentSummary {
  if (!effect || typeof effect !== 'string') return { type: 'unknown' };

  // 1) 兼容 key:value 旧格式（优先，因不少敌人行动仍使用该形式）
  const keyValue = inferFromKeyValue(effect);
  if (keyValue.type !== 'unknown') return keyValue;

  // 2) 新表达式推断：解析后根据目标与属性
  const expressions = parser.parseEffectString(effect);
  let damage = 0;
  let lustDamage = 0;
  let block = 0;

  for (const e of expressions) {
    if (!e.isValid) continue;
    // 攻击类：对方(OP) hp - X / lust - X
    if (e.target === 'OP' && e.operator === '-' && typeof e.value !== 'object') {
      if (e.attribute === 'hp') {
        const v = safeNumber(e.value);
        if (v > 0) damage += v;
      } else if (e.attribute === 'lust') {
        const v = safeNumber(e.value);
        if (v > 0) lustDamage += v;
      }
    }
    // 防御：己方(ME) block + X
    if (e.target === 'ME' && e.attribute === 'block' && e.operator === '+' && typeof e.value !== 'object') {
      const v = safeNumber(e.value);
      if (v > 0) block += v;
    }
  }

  if (damage > 0) return { type: 'attack', damage };
  if (lustDamage > 0) return { type: 'lust_attack', lustDamage };
  if (block > 0) return { type: 'defend', block };

  return { type: 'special' };
}

function safeNumber(v: any): number {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function inferFromKeyValue(effect: string): IntentSummary {
  // 支持多个片段，用第一个命中的主类型
  // damage:10, lust_damage:5, block:8, heal:6, apply_status:player:weak
  const mDamage = effect.match(/\bdamage:(\d+)\b/);
  if (mDamage) return { type: 'attack', damage: parseInt(mDamage[1], 10) };

  const mLust = effect.match(/\blust_damage:(\d+)\b/);
  if (mLust) return { type: 'lust_attack', lustDamage: parseInt(mLust[1], 10) };

  const mBlock = effect.match(/\bblock:(\d+)\b/);
  if (mBlock) return { type: 'defend', block: parseInt(mBlock[1], 10) };

  if (/\bheal:(\d+)\b/.test(effect)) return { type: 'heal' };
  if (/\bapply_status:player:/.test(effect)) return { type: 'debuff' };
  if (/\bapply_status:enemy:/.test(effect)) return { type: 'buff' };

  return { type: 'unknown' };
}

