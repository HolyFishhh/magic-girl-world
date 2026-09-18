/** One explicit navigation intent shared across independently bundled views. */
const KEY = '__MWG_NAVIGATION_FOCUS__';
type Intent = { selector: string };
type NavigationState = { intent?: Intent; settledUntil?: number };
const host = () => globalThis as typeof globalThis & { [KEY]?: NavigationState };
export function requestNavigationFocus(selector: string): void { host()[KEY] = { intent: { selector } }; }
/** Frame resizing must not restore the old parent scroll after this explicit jump. */
export function isNavigationFocusSettling(): boolean {
  return (host()[KEY]?.settledUntil ?? 0) > (globalThis.performance?.now?.() ?? Date.now());
}
export function applyNavigationFocus(): boolean {
  const state = host()[KEY];
  const intent = state?.intent;
  if (!intent) return false;
  const target = document.querySelector<HTMLElement>(intent.selector);
  // Missing, hidden, or still-loading destinations must not consume the intent.
  if (!target || !target.getClientRects().length || target.closest('[hidden], [inert], [aria-busy="true"]')) return false;
  host()[KEY] = { settledUntil: (globalThis.performance?.now?.() ?? Date.now()) + 700 };
  scrollUserNavigationTargetIntoView(target, documentViewportHeight(document), 'start');
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  return true;
}
import { scrollUserNavigationTargetIntoView, documentViewportHeight } from '../common/userNavigationScroll';
