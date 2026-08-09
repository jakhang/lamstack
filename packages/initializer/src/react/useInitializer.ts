import { useNonNullableContext } from '@omnireact/core';
import { InitializerContext, type InitializerContextValue } from './InitializerContext';

/**
 * Reads the current initialization state (`status`/`progress`/`tasks`/`error`)
 * and `retry`/`abort` controls. Must be called from a descendant of
 * <Initializer>.
 */
export function useInitializer(): InitializerContextValue {
  return useNonNullableContext(InitializerContext);
}
