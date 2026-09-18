/** Validate action references in their defining enemy scope, including nested reinforcements. */
export function validateEnemyActionReferences(enemy: Record<string, any>, path: string): {path:string;code:string;message:string}[] {
  const issues: {path:string;code:string;message:string}[] = [];
  const ids = new Set<string>();
  for (const [i, action] of (Array.isArray(enemy.actions) ? enemy.actions : []).entries()) {
    if (typeof action?.id !== 'string') continue;
    if (ids.has(action.id)) issues.push({path:`${path}.actions[${i}].id`,code:'DUPLICATE_ACTION_ID',message:`重复的行动 ID：${action.id}`});
    ids.add(action.id);
  }
  const walk = (value:any, at:string):void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((v,i)=>walk(v,`${at}[${i}]`)); return; }
    const ref = value.op === 'enemy_intent' ? value.actionId : value.enemy_intent;
    if (typeof ref === 'string' && !ids.has(ref)) issues.push({path:`${at}.${value.op === 'enemy_intent' ? 'actionId' : 'enemy_intent'}`,code:'UNKNOWN_ENEMY_ACTION',message:`意图必须引用此敌人已有的行动 ID：${ref}`});
    for (const [key, child] of Object.entries(value)) {
      if (key === 'spawn_enemy' || (value.op === 'spawn_enemy' && key === 'enemy')) {
        if (child && typeof child === 'object') issues.push(...validateEnemyActionReferences(child as Record<string,any>,`${at}.${key}`));
      } else walk(child,`${at}.${key}`);
    }
  };
  for (const key of ['actions','abilities','lust_effect','stance','orbs']) walk(enemy[key],`${path}.${key}`);
  return issues;
}
