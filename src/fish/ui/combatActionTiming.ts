/** Presentation-only clock: gameplay resumes at contact, cleanup continues independently. */
export const COMBAT_ACTION_TIMING = { crossing: { duration: 520, impact: 0.72 }, aura: { duration: 720, impact: 0.24 } } as const;
export function startCombatActionTiming(options: {
  crossing: boolean; reducedMotion: boolean; start: () => void; cleanup: () => void;
  frame: (callback: () => void) => unknown;
  delay: (callback: () => void, milliseconds: number) => unknown;
}): { impact: Promise<void>; finished: Promise<void> } {
  let contact!: () => void, finish!: () => void;
  const impact = new Promise<void>(resolve => { contact = resolve; });
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const timing = options.crossing ? COMBAT_ACTION_TIMING.crossing : COMBAT_ACTION_TIMING.aura;
  const duration = options.reducedMotion ? 1 : timing.duration;
  options.frame(() => {
    options.start();
    options.delay(contact, options.reducedMotion ? 0 : duration * timing.impact);
    options.delay(() => { options.cleanup(); contact(); finish(); }, duration);
  });
  return { impact, finished };
}
