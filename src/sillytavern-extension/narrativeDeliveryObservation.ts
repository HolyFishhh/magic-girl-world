export interface NarrativeDeliveryMetadata {
  wire?: import('./narrativeWireObservation').NarrativeWireMetadata;
  eventsAvailable: boolean;
  streamEvents: number;
  streamCharacters: number | null;
  /** Last-event length above can shrink to zero; these retain numeric history. */
  streamMaxCharacters: number | null;
  nonEmptyStreamEvents: number;
  endEvents: number;
  endCharacters: number | null;
}

/** Helper text events only. Retains lengths, never text, prompts or reasoning.
 * This observes Helper delivery, not upstream HTTP content or token usage. */
export function observeNarrativeDelivery(bus: any, generationId: string) {
  const metadata: NarrativeDeliveryMetadata = {
    eventsAvailable: false, streamEvents: 0, streamCharacters: null,
    streamMaxCharacters: null, nonEmptyStreamEvents: 0, endEvents: 0, endCharacters: null,
  };
  let active = true;
  const bindings: Array<[string, (text: unknown, id: unknown) => void]> = [];
  const close = () => {
    active = false;
    for (const [event, listener] of bindings) {
      try { bus.removeListener(event, listener); } catch { /* Diagnostics cannot interrupt generation. */ }
    }
    bindings.length = 0;
  };
  try {
    if (typeof bus?.on === 'function' && typeof bus?.removeListener === 'function') {
      for (const [event, stream] of [['js_stream_token_received_fully', true], ['js_generation_ended', false]] as const) {
        const listener = (text: unknown, id: unknown) => {
          if (!active || id !== generationId || typeof text !== 'string') return;
          if (stream) {
            metadata.streamEvents = Math.min(Number.MAX_SAFE_INTEGER, metadata.streamEvents + 1);
            metadata.streamCharacters = text.length;
            metadata.streamMaxCharacters = Math.max(metadata.streamMaxCharacters ?? 0, text.length);
            if (text.length > 0) metadata.nonEmptyStreamEvents = Math.min(Number.MAX_SAFE_INTEGER, metadata.nonEmptyStreamEvents + 1);
          } else {
            metadata.endEvents = Math.min(Number.MAX_SAFE_INTEGER, metadata.endEvents + 1);
            metadata.endCharacters = text.length;
          }
        };
        // Include even a listener whose registration throws after attaching.
        bindings.push([event, listener]);
        bus.on(event, listener);
      }
      metadata.eventsAvailable = true;
    }
  } catch { close(); }
  return { snapshot: (): NarrativeDeliveryMetadata => ({ ...metadata }), close };
}
