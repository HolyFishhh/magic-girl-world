/** Presentation ports for a dedicated simulation Worker (or a Node test process).
 * Never enable this in a browser document: the live battle owns separate singletons.
 * Rules, transactions, random state, triggers and card choices still use the production hosts.
 */
export type IsolatedPresenter = 'effects' | 'cards' | 'relics' | 'intent' | 'effect_choice' | 'summon_choice';
export interface IsolatedBattlePresentation {
  presenters: Record<IsolatedPresenter, object>;
  terminal(result: string): void;
}
let isolated: IsolatedBattlePresentation | undefined;
export function installIsolatedBattlePresentation(ports: IsolatedBattlePresentation): void {
  if (typeof document !== 'undefined' || typeof window !== 'undefined')
    throw new Error('Headless battle evaluation must run in its own Worker, never in the player document');
  if (isolated) throw new Error('Isolated battle presentation already installed');
  isolated = ports;
}
export function isolatedBattlePresentation(): IsolatedBattlePresentation | undefined { return isolated; }
export function isolatedPresenter<T>(kind: IsolatedPresenter): T | undefined {
  return isolated?.presenters[kind] as T | undefined;
}
