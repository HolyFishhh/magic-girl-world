import type { SillyTavernContext } from './types';

/**
 * Tavern Helper keeps event emission on a private binding object rather than
 * its public top-level API. Persistent extensions must not depend on that
 * internal shape. Keep Tavern Helper as the owner of message/variable methods
 * while routing events through SillyTavern's official extension context.
 */
export function createEventBridgedTavernHelper(
  helper: unknown,
  context: Pick<SillyTavernContext, 'eventSource'> | null | undefined,
): Record<string, any> | null {
  if (!helper || typeof helper !== 'object' || typeof context?.eventSource?.emit !== 'function') return null;
  const target = helper as Record<string, any>;
  const emit = context.eventSource.emit.bind(context.eventSource);

  return new Proxy(target, {
    get(source, property) {
      if (property === 'eventEmit') {
        return (eventName: string, ...args: unknown[]) => emit(eventName, ...args);
      }
      const value = Reflect.get(source, property, source);
      return typeof value === 'function' ? value.bind(source) : value;
    },
  });
}
