type Listener<TMap, K extends keyof TMap> = (payload: TMap[K]) => void;

/**
 * Generic typed pub/sub, not tied to any specific event map — instantiate with
 * a concrete map for your domain (e.g. `EventBus<RecoveryEventMap>`). Deliberately
 * separate from the request/response pipeline, since these describe
 * session/domain-level events, not any single request. Not a singleton: create
 * one and pass it around, subscribe via `on()`.
 */
export class EventBus<TMap extends Record<string, unknown>> {
  private listeners: Partial<{ [K in keyof TMap]: Set<Listener<TMap, K>> }> = {};

  /** Subscribes to an event. Returns an unsubscribe function — handy for a React `useEffect` cleanup. */
  on<K extends keyof TMap>(event: K, listener: Listener<TMap, K>): () => void {
    // TS can't narrow a generically-indexed read/write on a mapped type keyed by `K` — the cast
    // is provably safe by construction (every entry is created and read under the same `event`).
    const listeners = this.listeners as Record<K, Set<Listener<TMap, K>> | undefined>;
    let set = listeners[event];
    if (!set) {
      set = new Set();
      listeners[event] = set;
    }
    set.add(listener);
    return () => this.off(event, listener);
  }

  /** Unsubscribes a specific listener from an event. */
  off<K extends keyof TMap>(event: K, listener: Listener<TMap, K>): void {
    this.listeners[event]?.delete(listener);
  }

  /** Triggers every listener subscribed to `event`. A throwing listener doesn't stop the others. */
  emit<K extends keyof TMap>(event: K, payload: TMap[K]): void {
    this.listeners[event]?.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(`Error in EventBus listener for '${String(event)}':`, error);
      }
    });
  }

  /** Removes every listener for every event. */
  clearAll(): void {
    this.listeners = {};
  }
}
