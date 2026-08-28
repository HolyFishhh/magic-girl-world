/**
 * `structuredClone` is available in the supported browser and Node runtimes.
 * The portable declaration build intentionally omits DOM and Node type packs,
 * so declare only this cross-runtime primitive instead of widening its globals.
 */
declare function structuredClone<T>(value: T): T;
