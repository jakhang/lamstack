import * as React from 'react';
import { InitializerContext, type InitializerContextValue } from './InitializerContext';
import type { StateMap } from '../core/state';

/**
 * Reads the current run state (`status`/`progress`/`tasks`/`error`),
 * `retry`/`abort` controls, and `getState()` for the shared state bag. Must
 * be called from a descendant of `<Initializer>`. Parameterize with the same
 * `StateMap` passed to `<Initializer<S>>` to get `getState()` typed.
 */
export function useInitializer<S extends StateMap = StateMap>(): InitializerContextValue<S> {
  const value = React.useContext(InitializerContext);
  if (value === null) {
    throw new Error(
      '[@omnireact/initializer] useInitializer() was called outside of <Initializer>. ' +
        'Wrap the component tree that calls it in <Initializer>.',
    );
  }
  return value as InitializerContextValue<S>;
}
