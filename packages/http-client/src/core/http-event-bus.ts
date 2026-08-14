import type { HttpError } from './http-error';

export interface HttpEventMap {
  unauthorized: { error: HttpError };
  'token:refreshed': Record<string, never>;
  'token:refresh-failed': { error: unknown };
}

type Listener<K extends keyof HttpEventMap> = (payload: HttpEventMap[K]) => void;

/**
 * Typed pub/sub for session-level events — deliberately separate from the
 * request/response pipeline, since these describe the auth *session*, not
 * any single request. Not a singleton: create one and pass it to
 * `refresh({ events })`, then subscribe via `events.on(...)`.
 */
export class HttpEventBus {
  private listeners: Partial<{ [K in keyof HttpEventMap]: Set<Listener<K>> }> = {};

  /** Subscribes to an event. Returns an unsubscribe function — handy for a React `useEffect` cleanup. */
  on<K extends keyof HttpEventMap>(event: K, listener: Listener<K>): () => void {
    // TS can't narrow a generically-indexed read/write on a mapped type keyed by `K` — the cast
    // is provably safe by construction (every entry is created and read under the same `event`).
    const listeners = this.listeners as Record<K, Set<Listener<K>> | undefined>;
    let set = listeners[event];
    if (!set) {
      set = new Set();
      listeners[event] = set;
    }
    set.add(listener);
    return () => this.off(event, listener);
  }

  /** Unsubscribes a specific listener from an event. */
  off<K extends keyof HttpEventMap>(event: K, listener: Listener<K>): void {
    this.listeners[event]?.delete(listener);
  }

  /** Triggers every listener subscribed to `event`. A throwing listener doesn't stop the others. */
  emit<K extends keyof HttpEventMap>(event: K, payload: HttpEventMap[K]): void {
    this.listeners[event]?.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(`Error in HttpEventBus listener for '${String(event)}':`, error);
      }
    });
  }

  /** Removes every listener for every event. */
  clearAll(): void {
    this.listeners = {};
  }
}
