type TavernHelperEventBinding = {
  _eventOn?: (eventName: string, listener: (...args: any[]) => unknown) => unknown;
  _eventRemoveListener?: (eventName: string, listener: (...args: any[]) => unknown) => unknown;
};

type TavernHelperWithBindings = {
  _bind?: TavernHelperEventBinding;
};

/**
 * Subscribe to the event source captured inside Tavern Helper's own bundle.
 * Some persistent-extension contexts expose a different event-source object,
 * even though both sources use the same event name.
 */
export function subscribeTavernHelperRequestEvent(
  helper: unknown,
  eventName: string,
  listener: (...args: any[]) => unknown,
  ownerId = 'MWG-design-assistant-extension',
): (() => void) | null {
  if (!helper || typeof helper !== 'object') return null;
  const binding = (helper as TavernHelperWithBindings)._bind;
  if (typeof binding?._eventOn !== 'function' || typeof binding?._eventRemoveListener !== 'function') return null;

  // Tavern Helper only reads frameElement.id/name from `this` to scope and
  // later remove the wrapped listener. A synthetic persistent identity avoids
  // tying the listener to a message iframe that is routinely destroyed.
  const owner = {
    frameElement: { id: ownerId },
    name: ownerId,
  } as unknown as Window;
  binding._eventOn.call(owner, eventName, listener);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    binding._eventRemoveListener!.call(owner, eventName, listener);
  };
}
