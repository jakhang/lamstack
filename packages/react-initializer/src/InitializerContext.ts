import * as React from 'react';
import type { InitializerSnapshot, InitializationState, StateMap } from '@lamstack/initializer';

export interface InitializerContextValue<S extends StateMap = StateMap> extends InitializerSnapshot {
  /** Restarts the whole run from the beginning. */
  retry: () => void;
  /** Aborts the run in progress. */
  abort: () => void;
  /**
   * The shared `state` bag tasks wrote to via `state.set(...)` during the
   * run. Only reliably complete once `status` is `'completed'` — read
   * mid-run (or after `'failed'`/`'cancelled'`) it may be partially filled
   * in, same as `InitializerHandle.getState`.
   */
  getState: () => InitializationState<S>;
}

// A single React Context can only carry one concrete type parameter — the
// per-call-site `S` in `useInitializer<S>()` is applied there via a type
// assertion, since at runtime every consumer reads the same object.
export const InitializerContext = React.createContext<InitializerContextValue | null>(null);
