/** Mechanism predicates inspect related executable fields on the same node. */
export interface FoundationEvidence {
  kind: string; text: string; operations: Set<string>; triggers: Set<string>;
}
type RecordValue = Record<string, any>;
const record = (v: any): v is RecordValue => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
function objects(v: any): RecordValue[] {
  if (Array.isArray(v)) return v.flatMap(objects);
  if (!record(v)) return [];
  return [v, ...Object.entries(v).filter(([k]) => !['name','description','emoji','id','metadata','flavor'].includes(k)).flatMap(([,x]) => objects(x))];
}
const owns = (v: RecordValue, key: string) => Object.hasOwn(v,key);
const nonempty = (v: any) => Array.isArray(v) ? v.length > 0 : record(v) && Object.keys(v).length > 0;
const positive = (v: any) => typeof v === 'number' ? v > 0 : typeof v === 'string' ? v.trim() !== '' && (!Number.isFinite(Number(v)) || Number(v) > 0) : record(v);
const op = (v: RecordValue, compact: string, compiled = compact) => v.op ? v.op === compiled : owns(v,compact);
const payload = (v: RecordValue,key: string) => record(v[key]) ? v[key] : v;
const formulaText = (v: any) => JSON.stringify(v) || '';
const parsedEvidence = new WeakMap<FoundationEvidence, {root: RecordValue; nodes: RecordValue[]}>();

export function matchTowerFoundation(id: string, entry: FoundationEvidence): boolean | undefined {
  let parsed = parsedEvidence.get(entry);
  if (!parsed) { const root = JSON.parse(entry.text || '{}'); parsed = {root,nodes:objects(root)}; parsedEvidence.set(entry,parsed); }
  const {root,nodes} = parsed;
  const any = (fn: (v: RecordValue) => boolean) => nodes.some(fn);
  const operation = (compact: string, compiled = compact) => any(v => op(v,compact,compiled));
  const rule = (...kinds: string[]) => any(v => kinds.includes(v.op === 'card_play_rule' ? v.rule : v.card_rule));
  const damage = (fn: (v: RecordValue) => boolean) => any(v => op(v,'damage') && fn(v));
  const growth = (stat?: string, summon?: boolean) => any(v => {
    if (!op(v,'persistent_growth')) return false;
    const p=payload(v,'persistent_growth');
    return (!stat || p.stat === stat) && (summon === undefined || Boolean(p.summonTemplateId || p.summon_template_id) === summon);
  });
  const trigger = (...names: string[]) => any(v => names.includes(typeof v.trigger === 'string' ? v.trigger : v.trigger?.on) || names.includes(v.on) || record(v.triggers) && names.some(name=>nonempty(v.triggers[name])));
  const query = (fn: (v: RecordValue) => boolean) => any(v => record(v.eventQuery) && fn(v.eventQuery) || record(v.trigger) && fn(v.trigger) || typeof v.on === 'string' && fn(v));
  const reads = (pattern: RegExp) => nodes.some(v => v.op === 'var' && pattern.test(v.path || '') || Object.entries(v).some(([k,x]) => !['id','name','description','emoji'].includes(k) && typeof x === 'string' && pattern.test(x)));
  const condition = (pattern: RegExp) => any(v => pattern.test(formulaText(v.when ?? v.condition ?? v.guard ?? '')));
  const summonDefs = nodes.filter(v => v.op === 'spawn_summon' && record(v.summon) || record(v.spawn_summon)).map(v => v.summon || v.spawn_summon);
  const stanceDefs = [...nodes.filter(v => op(v,'stance','set_stance') && record(v.stance)).map(v => v.stance), ...(entry.kind === 'stance' ? [root] : [])];
  const selector = (fn: (v: RecordValue) => boolean) => any(v => ['targets','random_target','targetSelector','selector'].some(k => record(v[k]) && fn(v[k])));
  const numericValue = (v: RecordValue, compact: string) => v.op ? v.amount : v[compact];
  switch(id) {
    case 'multi-hit': return damage(v => Number(v.hits) > 1) || nodes.some(v => Array.isArray(v.steps) && v.steps.filter((x:any)=>x.op==='damage').length>1);
    case 'damage-amplification': return any(v => op(v,'modify') && (()=>{const p=payload(v,'modify'); return ['damage','damage_taken'].includes(p.stat ?? (typeof v.modify==='string'?v.modify:'')) && (['multiply','divide'].includes(p.operator) || owns(p,'multiply') || owns(p,'divide'));})());
    case 'piercing': return damage(v => v.bypass_block === true || v.bypassBlock === true || v.damage_type === 'hp_loss' || v.damageKind === 'hp_loss');
    case 'lifesteal': return damage(v => positive(v.lifesteal));
    case 'fatal-kill': return operation('kill');
    case 'missing-hp': return reads(/\b(?:self|opponent)\.max_hp\s*-\s*(?:self|opponent)\.hp\b/) || any(v=>v.op==='subtract' && /max_hp/.test(formulaText(v)) && /\.hp/.test(formulaText(v)));
    case 'block-value': return reads(/\b(?:self|opponent)\.block\b/);
    case 'status-value': return reads(/\b(?:self|opponent)\.status\.[\w]+\.stacks\b/);
    case 'resource-value': return reads(/\b(?:x_resource|self\.resource|opponent\.resource)\.[\w]+/);
    case 'status-cleanse': return operation('remove_status') || any(v => op(v, 'status_action') && (v.spec?.mode ?? v.mode ?? v.status_action?.mode) === 'remove');
    case 'status-copy': case 'status-transfer': return any(v => op(v, 'status_action') && (v.spec?.mode ?? v.mode ?? v.status_action?.mode) === (id === 'status-copy' ? 'copy' : 'transfer'));
    case 'timed-status': return ['status','active-status'].includes(entry.kind) && any(v=>Number(v.duration)>0 || Number(v.duration?.turns)>0 || Number(v.lifecycle?.turns)>0 || Number(v.stacks_change)<0 || v.stacks_change==='reset');
    case 'periodic-damage': return ['status','active-status'].includes(entry.kind) && operation('damage') && trigger('turn_start','turn_end');
    case 'status-gate': return condition(/\b(?:self|opponent)\.(?:status\.|has_(?:status|buff|debuff)|(?:status|buff|debuff)_count)/);
    case 'enemy-status-event': return trigger('enemy_has_status','enemy_has_buff','enemy_has_debuff','enemy_gain_buff','enemy_gain_debuff','enemy_lose_buff','enemy_lose_debuff');
    case 'persistent-power': return root.type === 'Power' || entry.kind === 'ability' || ['status','active-status'].includes(entry.kind) && entry.triggers.size>0;
    case 'stat-modifier': return operation('modify');
    case 'lust-pressure': return any(v=>op(v,'lust','gain_lust') && positive(numericValue(v,'lust')));
    case 'lust-reduction': return any(v=>op(v,'lust','gain_lust') && Number(numericValue(v,'lust'))<0);
    case 'lust-overflow': return entry.kind === 'desire' || trigger('lust_overflow','enemy_lust_overflow');
    case 'lust-value': return reads(/\b(?:self|opponent)\.(?:lust|max_lust)\b/);
    case 'lust-growth': return growth('max_lust',false);
    case 'block-retain': return rule('retain_block');
    case 'self-damage': return damage(v => (v.target ?? v.to) === 'self');
    case 'low-hp': return condition(/(?:\.hp\b[^"\n]*(?:<|<=)|"relation":"(?:lt|lte)".*\.hp|\.hp.*"relation":"(?:lt|lte)")/);
    case 'full-hp': return condition(/(?:\.hp\b[^"\n]*={2,3}[^"\n]*\.max_hp|\.max_hp\b[^"\n]*={2,3}[^"\n]*\.hp)/) || any(v=>v.op==='compare'&&v.relation==='eq'&&/\.hp/.test(formulaText(v))&&/\.max_hp/.test(formulaText(v)));
    case 'retaliation': return operation('damage') && trigger('take_damage','damaged','damage_taken');
    case 'max-hp-growth': return growth('max_hp',false);
    case 'seek': return operation('seek') || any(v=>v.op==='recover_cards' && v.source==='draw');
    case 'discard-recovery': return any(v=>op(v,'recover','recover_cards') && (v.source ?? payload(v,'recover').from ?? 'discard') === 'discard');
    case 'exhaust-recovery': return any(v=>op(v,'recover','recover_cards') && (v.source ?? payload(v,'recover').from) === 'exhaust');
    case 'topdeck': case 'bottomdeck': return any(v=>op(v,'move_card','move_cards') && (()=>{const p=payload(v,'move_card');return ['draw','drawPile'].includes(p.destination??p.to) && (p.position??'top')===(id==='topdeck'?'top':'bottom');})());
    case 'retain': return root.retain === true || rule('retain_hand');
    case 'free-play': return rule('free');
    case 'additional-payment': return entry.kind === 'card' && any(v => record(v.payment) && nonempty(v.payment.additional));
    case 'alternative-payment': return entry.kind === 'card' && any(v => record(v.payment) && Array.isArray(v.payment.alternatives) && v.payment.alternatives.length > 0);
    case 'x-cost': return any(v=>v.cost==='energy' || record(v.cost) && Object.values(v.cost).some(x=>x==='all'));
    case 'double-effect': return operation('double','double_card_effect');
    case 'play-restriction': return rule('limit_card_play','deny_card_play','allow_card_play');
    case 'cost-patch': return any(v=>op(v,'patch_card','apply_card_patch') && ['cost','dynamic_cost'].includes((v.patch??v.patch_card?.patch??v.patch_card)?.kind));
    case 'resource-spend': return any(v=>record(v.cost) && Object.entries(v.cost).some(([k,x])=>k!=='energy'&&positive(x)) || op(v,'resource','gain_resource') && Number(v.op?v.amount:payload(v,'resource').amount)<0);
    case 'resource-store': return entry.kind==='resource' && root.refresh==='retain';
    case 'resource-capacity': return entry.kind==='resource' && Number(root.max)>0;
    case 'multiple-resource-cost': return any(v=>record(v.cost) && Object.values(v.cost).filter(positive).length>=2);
    case 'ensure-card': return operation('ensure_card');
    case 'future-copy-patch': return any(v=>op(v,'patch_card','apply_card_patch') && (()=>{const p=v.patch??v.patch_card?.patch??v.patch_card;return p?.includeFutureCopies===true || p?.include_future_copies===true || ['template','filter'].includes(p?.target?.match)&&['run','permanent'].includes(p?.scope);})());
    case 'enchantment': case 'affliction': return any(v=>op(v,'attach_card','apply_card_attachment') && (v.attachment??v.attach_card?.attachment??v.attach_card)?.kind===id);
    case 'curse-card': return any(v=>v.type==='Curse');
    case 'deck-pollution': return any(v=>op(v,'add_card') && v.card?.type==='Curse') || operation('add_card') && any(v=>v.type==='Curse');
    case 'card-lifecycle': return any(v=>v.ethereal===true || record(v.lifecycle) && Object.values(v.lifecycle).some(x=>x===true || typeof x==='string'&&x!=='keep'));
    case 'template-selection': return selector(v=>typeof v.filter?.templateId==='string' || typeof v.filter?.template_id==='string') || any(v=>v.match==='template');
    case 'instance-selection': return selector(v=>['instanceId','runInstanceId','combatInstanceId','cardInstanceId'].some(k=>typeof v.filter?.[k]==='string')) || any(v=>v.match==='instance');
    case 'summon-single-core': return summonDefs.some(v=>typeof v.slot==='string' && v.slot.length>0);
    case 'summon-swarm': return any(v=>op(v,'spawn_summon') && !((v.summon??v.spawn_summon)?.slot) && Number(v.count??v.spawn_summon?.count??1)>1);
    case 'summon-self-destruct': return summonDefs.some(s=>objects(s.abilities).some(a=>(a.trigger==='defeated'||a.trigger?.on==='defeated') && objects(a).some(n=>op(n,'damage')))) && (operation('dismiss_summon','dismiss_summons') || operation('damage_summon','damage_summons'));
    case 'summon-death-repeat': return any(v=>op(v,'activate_summon','activate_summons') && (v.trigger??v.activate_summon?.trigger)==='defeated');
    case 'summon-copy': return operation('copy_summon','copy_summons');
    case 'summon-growth': return growth(undefined,true);
    case 'summon-revive': return summonDefs.some(v=>['revive_reset','revive_reinforce'].includes(v.onDefeated??v.on_defeated));
    case 'summon-capacity': return any(v=>op(v,'spawn_summon') && ['replace_oldest','replace_lowest_hp'].includes(v.overflow??v.spawn_summon?.overflow));
    case 'summon-passive': return summonDefs.some(s=>Array.isArray(s.abilities)&&s.abilities.length>0);
    case 'summon-hp-scaling': return summonDefs.some(s=>objects([s.actions,s.abilities]).some(v=>op(v,'damage')&&/\bself\.(?:hp|max_hp)\b/.test(formulaText(v.amount??v.damage))));
    case 'summon-ordered-action': return any(v=>op(v,'activate_summon','activate_summons') && nonempty(v.suppliedAction??v.activate_summon?.action));
    case 'summon-required-card': return any(v=>typeof (v.requires_summon??v.requiresSummonTemplateId)==='string');
    case 'stance-passive': return stanceDefs.some(v=>nonempty(v.passiveEffects??v.passive));
    case 'stance-entry': return stanceDefs.some(v=>nonempty(v.enterEffects??v.enter));
    case 'stance-exit': return stanceDefs.some(v=>nonempty(v.exitEffects??v.exit));
    case 'orb-overflow': return operation('channel_orb'); // Overflow eviction is an invariant of channel_orb.
    case 'all-enemies': return selector(v=>v.mode==='all_enemies' || v.mode==='all' && v.team!=='self' && v.owner!=='self');
    case 'random-enemy': return selector(v=>['random_enemy','random','random_n'].includes(v.mode) && !['self','ally','team'].includes(v.team??v.owner));
    case 'random-ally': return selector(v=>v.mode==='random_ally' || ['random','random_n'].includes(v.mode) && ['self','ally','team'].includes(v.team??v.owner));
    case 'lowest-hp': return selector(v=>['lowest_hp','lowest_hp_ratio'].includes(v.mode??v.pick));
    case 'manual-target': return selector(v=>v.pick==='choose'||v.mode==='choose');
    case 'unit-count': return condition(/\b(?:self|opponent)\.(?:ally_count|summon_count|has_ally|has_summon)\b/);
    case 'conditional-guard': return operation('guard') || operation('if');
    case 'negative-control': return ['status','active-status'].includes(entry.kind) && (root.type==='debuff'||root.category==='debuff');
    case 'damage-interception': case 'card-play-interception': return ['status', 'active-status'].includes(entry.kind) && Array.isArray(root.intercepts) && root.intercepts.some((rule: RecordValue) => rule.window === (id === 'damage-interception' ? 'before_damage' : 'before_card_play'));
    case 'on-play': return trigger('card_played','attack_played','skill_played','power_played');
    case 'on-hit': return trigger('deal_damage','damage_dealt','hit');
    case 'on-discard': return trigger('on_discard');
    case 'on-exhaust': return trigger('on_exhaust');
    case 'on-kill': return trigger('kill','enemy_defeated');
    case 'on-draw': return trigger('on_draw');
    case 'turn-start': return trigger('turn_start');
    case 'turn-end': return trigger('turn_end');
    case 'first-n': return query(v=>v.scope==='turn' && ['first','first_n'].includes(v.ordinal));
    case 'battle-uses': return query(v=>(v.scope??'combat')==='combat' && ['first','first_n'].includes(v.ordinal));
    case 'periodic-trigger': return query(v=>v.ordinal==='every_n');
    case 'event-value': return reads(/\b(?:last_damage|last_hp_loss|last_heal|last_resource_spent)\b/) || any(v=>v.op==='history'&&['last_damage','last_hp_loss','last_heal','last_resource_spent'].includes(v.metric));
    case 'repeating-schedule': return any(v=>op(v,'schedule','schedule_effect') && Number(v.repeatEvery??v.repeat_every)>0 && Number(v.repeats)>0);
    default: return undefined;
  }
}
