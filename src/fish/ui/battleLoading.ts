/** Lightweight readiness surface; state is scoped to the current battle DOM. */
export function setBattleLoading(busy: boolean): void {
  const scene=document.getElementById('battle-scene');
  const loading=document.getElementById('battle-loading');
  scene?.setAttribute('aria-busy',String(busy));
  scene?.querySelectorAll<HTMLElement>('.battle-main-grid,.top-info-bar,.battle-footer').forEach(el=>el.inert=busy);
  if(loading)loading.hidden=!busy;
}
export async function paintBattleLoading(): Promise<void> {
  setBattleLoading(true);
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
}
