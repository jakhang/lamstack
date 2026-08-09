/**
 * Declares the shape of a run's shared state, keyed by name, e.g.
 * `{ user: User; config: Config }`. Defaults to an untyped bag (`get`/`set`
 * behave as before, `unknown`-typed) so existing code compiles unchanged.
 */
export type StateMap = Record<string, unknown>;

/**
 * A shared key/value bag passed to every task via `InitializationContext`,
 * used to pass data between tasks (e.g. a task that loads the current user
 * makes it available to a task that depends on it). Parameterize
 * `InitializationTask<S>`/`createInitializer<S>` with a `StateMap` to get
 * `get`/`set` type-checked and inferred per key, instead of an unchecked cast.
 */
export interface InitializationState<S extends StateMap = StateMap> {
  get<K extends keyof S>(key: K): S[K] | undefined;
  set<K extends keyof S>(key: K, value: S[K]): void;
  has(key: keyof S): boolean;
}

export function createInitializationState<S extends StateMap = StateMap>(): InitializationState<S> {
  const store = new Map<keyof S, S[keyof S]>();
  return {
    get: <K extends keyof S>(key: K) => store.get(key) as S[K] | undefined,
    set: <K extends keyof S>(key: K, value: S[K]) => {
      store.set(key, value);
    },
    has: (key: keyof S) => store.has(key),
  };
}
