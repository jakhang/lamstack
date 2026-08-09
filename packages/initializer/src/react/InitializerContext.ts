import * as React from 'react';
import type { RunnerSnapshot } from '../core/runner';

export interface InitializerContextValue extends RunnerSnapshot {
  /** Restarts the whole initialization sequence from the beginning. */
  retry: () => void;
  /** Aborts the sequence in progress. */
  abort: () => void;
}

export const InitializerContext = React.createContext<InitializerContextValue | null>(null);
