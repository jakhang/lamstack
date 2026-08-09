/**
 * A shared key/value bag passed to every task via `InitializationContext`,
 * used to pass data between tasks (e.g. a task that loads the current user
 * makes it available to a task that depends on it).
 */
export interface InitializationState {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  has(key: string): boolean;
}

export function createInitializationState(): InitializationState {
  const store = new Map<string, unknown>();
  return {
    get: <T,>(key: string) => store.get(key) as T | undefined,
    set: <T,>(key: string, value: T) => {
      store.set(key, value);
    },
    has: (key: string) => store.has(key),
  };
}
