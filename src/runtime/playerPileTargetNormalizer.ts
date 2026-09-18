import { compactEffectOperationKeys } from '../game-core/compactEffectContract';
import { compileCompactEffectList } from '../game-core/compactEffectDsl';

const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// These commands have no entity target: the runtime operates on the player's
// card zones. copy/add_card/ensure_card are deliberately absent: their `to` is
// a card-zone destination, not a redundant entity receiver.
const PLAYER_PILE_OPERATIONS = new Set([
  'draw', 'scry', 'seek', 'discard', 'exhaust', 'recover', 'reduce_cost',
  'modify_card', 'patch_card', 'attach_card', 'upgrade_card', 'double',
]);
const OWNER_FIELDS = ['cards', 'card', 'artifacts', 'artifact', 'items', 'item', 'player_abilities', 'player_lust_effect'];
const CONTAINER_FIELDS = ['player', 'opening', 'choices', 'outcome', 'reward', 'rewards'];
const SCHEDULE_FIELDS = new Set(['schedule', 'phase', 'priority', 'repeat_every', 'repeats', 'effects', 'when']);
const CHOICE_FIELDS = new Set(['choose', 'options', 'when', 'on']);

/** Canonicalize ONLY in already-cloned, explicitly player-owned content.
 * No broad object walk: status libraries, enemies, summons, stances, orbs and
 * unknown effect wrappers have different/unknown execution owners and remain
 * untouched. The raw shared authoring normalizer must not call this function.
 * This is representation normalization, not an AI/content repair request.
 */
export function canonicalizePlayerPileSelfTargets(value: unknown): void {
  let visits = 0;
  const seen = new WeakSet<object>();
  const enter = (node: unknown, depth: number): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (++visits > 40000 || depth > 64) throw new Error('玩家牌区效果规范化超过安全上限');
    if (seen.has(node)) return false;
    seen.add(node);
    return true;
  };
  const effects = (node: unknown, depth: number): void => {
    if (!enter(node, depth)) return;
    if (Array.isArray(node)) { node.forEach(entry => effects(entry, depth + 1)); return; }
    if (!isRecord(node)) return;
    const operations = compactEffectOperationKeys(node);
    // A shared `to` on a multi-operation bundle may belong to another effect.
    // Do not guess: the existing bundle projection/validator owns that case.
    if (operations.length !== 1) return;
    const operation = operations[0];
    if (PLAYER_PILE_OPERATIONS.has(operation) && node.to === 'self') {
      const candidate = { ...node };
      delete candidate.to;
      // All other authored fields, amounts, conditions, selectors and timing
      // must form an already-valid compact command. Unknown/conflicting fields
      // stay visible; never make a malformed command pass by stripping them.
      if (compileCompactEffectList(candidate).ok) delete node.to;
    } else if (operation === 'schedule' && Object.keys(node).every(key => SCHEDULE_FIELDS.has(key))) {
      // Scheduling retains the exact current actor; it is not actor rebinding.
      effects(node.effects, depth + 1);
    } else if (operation === 'choose' && Object.keys(node).every(key => CHOICE_FIELDS.has(key)) && Array.isArray(node.options)) {
      for (const option of node.options) {
        if (isRecord(option) && Object.keys(option).every(key => ['id', 'label', 'effects'].includes(key))) {
          effects(option.effects, depth + 1);
        }
      }
    }
  };
  const owner = (node: unknown, depth: number): void => {
    if (!enter(node, depth)) return;
    if (Array.isArray(node)) { node.forEach(entry => owner(entry, depth + 1)); return; }
    if (!isRecord(node)) return;
    effects(node.effects, depth + 1);
    effects(node.discard_effects, depth + 1);
    // Named player abilities/relic events keep the player's execution owner.
    // Arbitrary registration/actor-target fields are not aliases for this path.
    for (const event of [node.trigger, ...(Array.isArray(node.events) ? node.events : [])]) {
      if (isRecord(event) && event.to === undefined && event.targets === undefined) effects(event.effects, depth + 1);
    }
    // A local generated-card template always becomes a player card. Shared
    // registry definitions are only visited after compilation binds them here.
    owner(node.creates, depth + 1);
  };
  const container = (node: unknown, depth: number): void => {
    if (!enter(node, depth)) return;
    if (Array.isArray(node)) { node.forEach(entry => container(entry, depth + 1)); return; }
    if (!isRecord(node)) return;
    for (const key of OWNER_FIELDS) owner(node[key], depth + 1);
    for (const key of CONTAINER_FIELDS) container(node[key], depth + 1);
  };
  // The entry point also accepts a single player card/item/ability/reward owner.
  if (isRecord(value) && typeof value.name === 'string'
    && ['effects', 'discard_effects', 'trigger', 'events', 'creates'].some(key => Object.hasOwn(value, key))) {
    owner(value, 0);
  } else container(value, 0);
}
