import type { Card, GameState } from '../../game-core';
import { GameStateManager } from '../core/gameStateManager';

// Registered synchronously when the draw event arrives; consulted before a
// new hand node is attached, including the normal 30ms deferred UI refresh.
const pendingDraws = new Set<string>();
export function prepareDrawnCardElement(element: HTMLElement): void {
  element.classList.toggle('pile-flow-bound', pendingDraws.has(element.dataset.cardId || ''));
}
let batchDepth = 0;
export async function batchPileFlows(action: () => Promise<unknown>): Promise<void> {
  batchDepth++;
  try { await action(); } finally { batchDepth--; }
}
const piles: Record<string,string> = { drawPile: 'draw', discardPile: 'discard', exhaustPile: 'exhaust' };
const center = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
interface Transfer { from: string; to: string; id?: string; card?: Card; source?: DOMRect; sourceElement?: HTMLElement; face?: HTMLElement; batch?: boolean }

/** Cosmetic projection of actual zone events. Never edits cards or delays transactions. */
export function bindPileFlowAnimations(): () => void {
  const manager = GameStateManager.getInstance();
  let sequence = manager.getGameState().eventJournal?.nextSequence || 0;
  let pending: Transfer[] = [], timer: ReturnType<typeof setTimeout> | undefined;
  const active = new Set<HTMLElement>();
  const cleanups = new Map<HTMLElement,()=>void>();
  const flows = new Map<HTMLElement,(now:number,ctx:CanvasRenderingContext2D)=>void>();
  let canvas: HTMLCanvasElement | undefined, frame=0;
  const startRendering=()=>{
    if(frame)return;
    if(!canvas){canvas=document.createElement('canvas');canvas.className='pile-flow-canvas';canvas.setAttribute('aria-hidden','true');document.body.append(canvas);}
    const paint=(now:number)=>{
      frame=0;
      const ctx=canvas?.getContext('2d');if(!ctx)return;
      const width=document.documentElement.clientWidth,height=window.innerHeight;
      const ratio=Math.min(window.devicePixelRatio||1,1.5);
      if(canvas!.width!==Math.round(width*ratio)||canvas!.height!==Math.round(height*ratio)){
        canvas!.width=Math.round(width*ratio);canvas!.height=Math.round(height*ratio);
        canvas!.style.width=`${width}px`;canvas!.style.height=`${height}px`;
      }
      ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
      ctx.lineCap='round';
      for(const draw of flows.values())draw(now,ctx);
      if(flows.size)frame=requestAnimationFrame(paint);
      else {canvas?.remove();canvas=undefined;}
    };
    frame=requestAnimationFrame(paint);
  };
  const cardElements = () => Array.from(document.querySelectorAll<HTMLElement>('#hand-cards .mwg-card,.card-cast-flight'));
  const pulse = (zone: string) => {
    const pile = document.querySelector<HTMLElement>(`[data-pile="${piles[zone]}"] .pile-stack`);
    pile?.animate?.([{transform:'scale(1)'},{transform:'scale(1.18)'},{transform:'scale(1)'}],{duration:350});
  };
  const animate = (group: Transfer[]) => {
    const hand = document.getElementById('hand-cards');
    if (!hand) return;
    pulse(group[0].from);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { group.forEach(p=>pendingDraws.delete(p.id || '')); pulse(group[0].to); return; }
    // Read all geometry before writing any animation DOM. Every distinct card
    // contributes a path, even when the transaction is presented as one batch.
    const elements = cardElements(), handRect = hand.getBoundingClientRect();
    const seen = new Set<string>();
    const paths = group.flatMap(item => {
      const key = `${item.from}:${item.to}:${item.id || ''}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const source = item.sourceElement?.isConnected ? item.sourceElement : undefined;
      const incoming = item.to === 'hand';
      const destination = incoming ? elements.find(el => el.dataset.cardId === item.id)
        : document.querySelector<HTMLElement>(`[data-pile="${piles[item.to]}"] .pile-stack`);
      const from = item.source || document.querySelector(`[data-pile="${piles[item.from]}"] .pile-stack`)?.getBoundingClientRect() || handRect;
      const to = destination?.getBoundingClientRect() || handRect;
      const a = center(from), b = center(to);
      if (incoming && !destination) b.x = to.right - 35;
      return [{ item, source, destination, incoming, from, a, b }];
    });
    const token = document.createElement('div');
    token.className = `pile-flow-token flow-${piles[group[0].to] || 'draw'}`;
    token.setAttribute('aria-hidden','true');token.dataset.cardId=group[0].id || '';
    token.dataset.cardIds=JSON.stringify(paths.map(p=>p.item.id));
    token.style.left='0';token.style.top='0';
    const hidden = new Set<HTMLElement>(), animations: Animation[] = [];
    const arrivals: HTMLElement[] = [];
    for (const path of paths) {
      const { item, source, destination, incoming, from } = path;
      if (!incoming && item.face) {
        const shell = document.createElement('div'); shell.className='pile-flow-card';
        shell.dataset.cardId=item.id || '';
        Object.assign(shell.style,{width:`${from.width}px`,height:`${from.height}px`,left:`${from.left}px`,top:`${from.top}px`});
        const face=item.face;
        face.classList.remove('pile-flow-bound','dragging','card-cast-flight','card-queue-resolved');
        face.removeAttribute('style');face.removeAttribute('id');
        face.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
        shell.append(face);token.append(shell);
        // Opacity/transform stay on the compositor; avoid repainting a moving
        // clip mask over every full card during a mass discard.
        animations.push(shell.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.97)'}],{duration:170,easing:'ease-out',fill:'forwards'}));
      }
      const bound=incoming?destination:source;
      if(bound){bound.classList.add('pile-flow-bound');hidden.add(bound);if(incoming)arrivals.push(bound);}
    }
    if(group.length>1){const label=document.createElement('span');label.className='pile-flow-count';label.textContent=`×${group.length}`;
      label.style.left=`${paths[0].a.x}px`;label.style.top=`${paths[0].a.y-20}px`;token.append(label);}
    document.body.append(token);active.add(token);
    const color=group[0].to==='exhaustPile'?'#ffc38a':group[0].to==='discardPile'?'#cbb3ff':'#a3e5ff';
    const perCard=Math.min(8,Math.max(1,Math.floor(80/paths.length)));
    const points=paths.flatMap(({incoming,from,a,b})=>Array.from({length:perCard},()=>{
      const angle=Math.random()*Math.PI*2, spread=20+Math.random()*32;
      const x=a.x+(Math.random()-.5)*from.width*(incoming?.3:.8);
      const y=a.y+(Math.random()-.5)*from.height*(incoming?.3:.8);
      return { x,y,b,dx:Math.cos(angle)*spread,dy:Math.sin(angle)*spread,
        bend:incoming?Math.min(document.documentElement.clientWidth-8,Math.max(a.x,b.x)+100):(a.x+b.x)/2,
        bendY:incoming?(a.y+b.y)/2:Math.min(a.y,b.y)-30,
        delay:Math.random()*25,size:1.3+Math.random()*1.3,duration:460+Math.random()*45 };
    }));
    token.dataset.particleCount=String(points.length);
    // Short outward drift blends continuously into collection, without a hard
    // velocity change at the boundary. Randomness is sampled once, not per frame.
    const position=(p:typeof points[number],t:number)=>{
      const scatter=Math.min(1,t/.22), easeScatter=1-Math.pow(1-scatter,2);
      const travel=Math.max(0,(t-.13)/.87), v=travel*travel*(3-2*travel), u=1-v;
      return {x:u*u*(p.x+p.dx*easeScatter)+2*u*v*p.bend+v*v*p.b.x,
        y:u*u*(p.y+p.dy*easeScatter)+2*u*v*p.bendY+v*v*p.b.y};
    };
    const cleanup=()=>{paths.filter(p=>p.incoming).forEach(p=>pendingDraws.delete(p.item.id || ''));token.remove();active.delete(token);hidden.forEach(el=>el.classList.remove('pile-flow-bound'));animations.forEach(a=>a.cancel());flows.delete(token);};
    cleanups.set(token,cleanup);
    const start=performance.now();let revealed=false;
    flows.set(token,(now,ctx)=>{
      const elapsed=now-start;
      // A deferred hand render can happen after the flow starts. Bind its real
      // node and endpoint before reveal instead of leaving the first paint visible.
      if(!revealed) for(const path of paths){
        if(!path.incoming)continue;
        const el=document.querySelector<HTMLElement>(`#hand-cards .mwg-card[data-card-id="${CSS.escape(path.item.id || '')}"]`);
        if(el && !arrivals.includes(el)){el.classList.add('pile-flow-bound');hidden.add(el);arrivals.push(el);
          Object.assign(path.b,center(el.getBoundingClientRect()));}
      }
      for(const p of points){
        const t=(elapsed-p.delay)/p.duration;if(t<0||t>1)continue;
        const at=position(p,t),tail=position(p,Math.max(0,t-.055));
        const alpha=Math.min(1,t*20,(1-t)*12);
        ctx.strokeStyle=color;ctx.fillStyle=color;
        ctx.globalAlpha=alpha*.18;ctx.lineWidth=p.size*3;
        ctx.beginPath();ctx.moveTo(tail.x,tail.y);ctx.lineTo(at.x,at.y);ctx.stroke();
        ctx.globalAlpha=alpha;ctx.lineWidth=p.size;
        ctx.stroke();ctx.beginPath();ctx.arc(at.x,at.y,p.size*.7,0,Math.PI*2);ctx.fill();
      }
      if(!revealed && elapsed>=365){
        revealed=true;
        paths.filter(p=>p.incoming).forEach(p=>pendingDraws.delete(p.item.id || ''));
        for(const el of arrivals){el.classList.remove('pile-flow-bound');hidden.delete(el);
          animations.push(el.animate([{opacity:0},{opacity:1}],{duration:150,easing:'ease-out'}));}
      }
      if(elapsed>=560){cleanup();cleanups.delete(token);pulse(group[0].to);}
    });
    startRendering();
  };
  const flush=()=>{
    timer=undefined;const items=pending;pending=[];
    const groups=new Map<string,Transfer[]>();
    for(const item of items){const key=`${item.from}:${item.to}`;const group=groups.get(key)||[];group.push(item);groups.set(key,group);}
    for(const group of groups.values())animate(group);
  };
  const unsubscribe=manager.addEventListener('battle_event_recorded',(state:GameState)=>{
    if ((state.eventJournal?.nextSequence || 0) < sequence) { sequence = state.eventJournal?.nextSequence || 0; pending=[]; return; }
    const events=(state.eventJournal?.events || []).filter(e=>e.sequence>=sequence);
    sequence=state.eventJournal?.nextSequence || sequence;
    for(const event of events){
      if(!('actorId' in event) || event.actorId!=='player')continue;
      if(event.kind==='draw_pile_shuffled'){pending.push({from:'discardPile',to:'drawPile',batch:true});continue;}
      if(event.kind!=='card_moved'&&event.kind!=='card_drawn')continue;
      if(!piles[event.to]&&event.to!=='hand')continue;
      const cards=[...state.player.hand,...state.player.drawPile,...state.player.discardPile,...state.player.exhaustPile];
      const card=cards.find(c=>(c.combatInstanceId||c.id)===event.cardInstanceId);
      if(event.to==='hand' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) pendingDraws.add(card?.id || event.cardInstanceId);
      const source=event.from === 'hand' ? cardElements().find(el=>el.dataset.cardId===card?.id || el.dataset.cardId===event.cardInstanceId) : undefined;
      pending.push({from:event.from,to:event.to,id:card?.id || event.cardInstanceId,card,source:source?.getBoundingClientRect(),sourceElement:source,face:source?.cloneNode(true) as HTMLElement | undefined,
        batch: batchDepth>0 || state.phase==='enemy_turn'||event.kind==='card_moved'&&event.moveReason==='turn_cleanup'});
    }
    if(pending.length && !timer)timer=setTimeout(flush,0);
  });
  return ()=>{unsubscribe();clearTimeout(timer);cancelAnimationFrame(frame);pendingDraws.clear();cleanups.forEach(cleanup=>cleanup());cleanups.clear();flows.clear();canvas?.remove();pending=[];active.forEach(el=>{el.getAnimations().forEach(a=>a.cancel());el.remove();});document.querySelectorAll('.pile-flow-bound').forEach(el=>el.classList.remove('pile-flow-bound'));};
}
