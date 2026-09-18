import { readRewardCardGroups } from '../game-core/rewardCardGroups';
import { readGameMode } from '../game-core/towerMode';
import { towerItemSlotsRemaining, towerRewardItemSlots } from '../game-core/towerInventory';
import { inspectRewardCandidates, normalizeMvuList, readRewardEntitlements, type RewardCategory } from './rewardTransactions';
import { isCardFaceDetailInteraction } from '../shared/cardChoice';

export interface BattleRewardMenuEntry {
  kind: RewardCategory | 'gold'; label: string; detail: string; indexes: number[]; pick?: number; cardGroupId?: string;
}
export interface BattleRewardMenuClaim { kind: RewardCategory | 'gold' | 'discard'; indexes?: number[]; cardGroupId?: string }
export interface BattleRewardsMenuOptions {
  root: HTMLElement; stat: Record<string, any>; enabled: boolean;
  renderCard(card: any): string;
  renderSupport(content: any, kind: '遗物' | '道具'): string;
  claim(request: BattleRewardMenuClaim): Promise<void>;
}
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

/** Only existing entitlements become menu rows. Capacity does not erase a real drop. */
export function createBattleRewardMenuEntries(stat: Record<string, any>): BattleRewardMenuEntry[] {
  const reward=stat.reward||{},limits=readRewardEntitlements(stat),entries:BattleRewardMenuEntry[]=[];
  if(Number(reward.gold)>0&&reward.gold_claimed!==true)entries.push({kind:'gold',label:'金币',detail:`${reward.gold} 金币`,indexes:[]});
  const cards=normalizeMvuList(reward.card);
  if(limits.cards>0)for(const group of readRewardCardGroups(reward,cards.length)){
    if(group.pick>0)entries.push({kind:'cards',label:'卡牌自选',detail:`${group.indices.length}选${group.pick}`,indexes:group.indices,pick:group.pick,cardGroupId:group.id});
  }
  for(const kind of ['artifacts','items'] as const){
    const candidates=normalizeMvuList<any>(reward[kind==='artifacts'?'artifact':'item']);
    if(!candidates.length||limits[kind]<=0)continue;
    const label=kind==='artifacts'?'遗物':'药水与道具';
    if(limits[kind]<candidates.length){
      entries.push({kind,label:`${label}自选`,detail:`${candidates.length}选${limits[kind]}`,indexes:candidates.map((_,index)=>index),pick:limits[kind]});
    }else candidates.forEach((candidate,index)=>entries.push({kind,label:String(candidate.name||label),detail:kind==='items'?`${label} ×${candidate.count??1}`:label,indexes:[index]}));
  }
  return entries;
}

// Retain the live subtree while background preparation changes unrelated run data.
// Real pool, inventory, route identity, or permission changes invalidate it.
const renderedMenus = new WeakMap<HTMLElement, { key: string; header: Element | null }>();
export function renderBattleRewardsMenu(options: BattleRewardsMenuOptions): void {
  const {root,stat}=options,doc=root.ownerDocument,reward=stat.reward||{};
  const run=stat.run,battle=stat.battle||{};
  const key=JSON.stringify([reward,battle.cards,battle.artifacts,battle.items,battle.statuses,
    battle.core?.resources,battle.player_lust_effect,readGameMode(stat),options.enabled,
    run?.seed,run?.act,run?.floor,run?.currentNode?.id,run?.phase]);
  const previous=renderedMenus.get(root);
  if(previous?.key===key && previous.header && root.querySelector('.reward-header')===previous.header)return;
  const remember=()=>renderedMenus.set(root,{key,header:root.querySelector('.reward-header')});
  const pools={cards:normalizeMvuList<any>(reward.card),artifacts:normalizeMvuList<any>(reward.artifact),items:normalizeMvuList<any>(reward.item)};
  const inspections=inspectRewardCandidates(stat),entries=createBattleRewardMenuEntries(stat);
  let busy=false,lastEntry=0;
  const perform=async(request:BattleRewardMenuClaim)=>{
    if(busy||!options.enabled)return;
    busy=true;
    const buttons=Array.from(root.querySelectorAll<HTMLButtonElement>('button')),disabled=buttons.map(button=>button.disabled);
    buttons.forEach(button=>button.disabled=true);
    try{await options.claim(request);}catch(error){
      const alert=doc.createElement('p');alert.className='reward-error';alert.setAttribute('role','alert');alert.textContent=error instanceof Error?error.message:'领取失败，请重试';root.querySelector('.reward-actions')?.append(alert);
    }finally{busy=false;buttons.forEach((button,index)=>button.disabled=disabled[index]);}
  };
  const showMenu=()=>{
    root.innerHTML='<div class="reward-header"><strong class="title">战利品</strong><span class="battle-reward-hint">逐项领取，可随时返回</span></div><div class="battle-reward-category-list"></div><div class="reward-actions"><button type="button" class="btn reward-discard">继续前进</button></div>';
    remember();
    const list=root.querySelector('.battle-reward-category-list')!;
    entries.forEach((entry,index)=>{
      const button=doc.createElement('button');button.type='button';button.className='battle-reward-category';button.disabled=!options.enabled;
      button.dataset.rewardEntry=String(index);
      button.innerHTML=`<span>${escapeHtml(entry.label)}</span><small>${escapeHtml(entry.detail)}</small>`;
      button.addEventListener('click',()=>{
        if(entry.kind==='gold'){void perform({kind:'gold'});return;}
        lastEntry=index;showEntry(entry);
      });list.append(button);
    });
    if(!entries.length)list.textContent='奖励已领取完毕';
    const leave=root.querySelector<HTMLButtonElement>('.reward-discard')!;leave.disabled=!options.enabled;
    leave.addEventListener('click',()=>{
      if(!entries.length){void perform({kind:'discard'});return;}
      const actions=root.querySelector('.reward-actions')!;
      actions.innerHTML='<p class="battle-reward-discard-confirm">仍有未领取战利品。继续将放弃它们。</p><button type="button" class="btn btn-primary reward-discard-confirm">确认放弃并继续</button><button type="button" class="btn reward-discard-cancel">返回</button>';
      actions.querySelector('.reward-discard-cancel')?.addEventListener('click',showMenu);
      actions.querySelector('.reward-discard-confirm')?.addEventListener('click',()=>void perform({kind:'discard'}));
    });
  };
  const showEntry=(entry:BattleRewardMenuEntry)=>{
    const pick=entry.pick??1;
    const selected=new Set<number>();
    if(entry.kind!=='gold'&&entry.indexes.length===1&&pick===1)selected.add(entry.indexes[0]);
    root.innerHTML=`<div class="reward-header"><strong class="title">${escapeHtml(entry.label)}</strong><span class="battle-reward-hint">${escapeHtml(entry.detail)}</span></div><div class="battle-reward-option-list mwg-card-choice-list"></div><div class="reward-actions reward-choice-actions"><button type="button" class="btn reward-back">返回</button><button type="button" class="btn btn-primary reward-confirm">确认领取</button></div>`;
    remember();
    root.querySelector('.reward-back')?.addEventListener('click',()=>{showMenu();root.querySelector<HTMLButtonElement>(`[data-reward-entry="${lastEntry}"]`)?.focus({preventScroll:true});});
    const list=root.querySelector('.battle-reward-option-list')!,confirm=root.querySelector<HTMLButtonElement>('.reward-confirm')!;
    const valid=(index:number)=>entry.kind!=='gold'&&inspections[entry.kind][index]?.ok===true&&!(entry.kind==='items'&&readGameMode(stat)==='tower'&&towerRewardItemSlots([pools.items[index]])>towerItemSlotsRemaining(stat.battle));
    const refresh=()=>{
      confirm.disabled=!options.enabled||(entry.kind!=='gold'&&(selected.size!==pick||[...selected].some(index=>!valid(index))));
      list.querySelectorAll<HTMLElement>('[data-reward-index]').forEach(option=>{const active=selected.has(Number(option.dataset.rewardIndex));option.classList.toggle('is-selected',active);option.setAttribute('aria-pressed',String(active));});
    };
    if(entry.kind==='gold')list.innerHTML=`<p>领取 ${Number(reward.gold)} 金币。</p>`;
    else entry.indexes.forEach((index,ordinal)=>{
      const kind=entry.kind as RewardCategory,candidate=pools[kind][index],option=doc.createElement('div');
      option.className='battle-reward-option mwg-card-choice';option.dataset.rewardIndex=String(index);option.setAttribute('role','button');option.tabIndex=valid(index)?0:-1;option.setAttribute('aria-disabled',String(!valid(index)));
      option.innerHTML=kind==='cards'?`<div class="battle-reward-card-flip" style="--reward-flip-delay:${Math.min(ordinal*.24,.48)}s"><div class="battle-reward-card-face collection-card">${options.renderCard(candidate)}</div></div>`:`<div class="collection-support">${options.renderSupport(candidate,kind==='artifacts'?'遗物':'道具')}</div>`;
      if(!valid(index)){const reason=doc.createElement('small');reason.textContent=inspections[kind][index]?.ok?'道具栏空间不足，暂不能领取':'这项奖励暂不可领取';option.append(reason);}
      const select=(event:Event)=>{const target=event.target as HTMLElement;
        // Card faces contain their own buttons for visual/accessibility structure.
        // Only explicit detail/preview controls must keep the click from selecting.
        if(!valid(index)||isCardFaceDetailInteraction(target))return;
        if(selected.has(index))selected.delete(index);
        else if(pick===1){selected.clear();selected.add(index);}
        else if(selected.size<pick)selected.add(index);
        refresh();};
      option.addEventListener('click',select);option.addEventListener('keydown',event=>{if(event.target===option&&(event.key==='Enter'||event.key===' ')){event.preventDefault();select(event);}});
      list.append(option);
    });
    confirm.addEventListener('click',()=>{if(confirm.disabled||selected.size!==pick)return;void perform({kind:entry.kind,indexes:[...selected],cardGroupId:entry.cardGroupId});});
    refresh();
    root.querySelector<HTMLButtonElement>('.reward-back')?.focus({preventScroll:true});
  };
  showMenu();
}
