import * as React from 'react';

export function useNonNullableContext<T>(context: React.Context<T | null>): T {
  const value = React.useContext(context);
  if (value === null) {
    throw new Error('Context value is null. Ensure the provider is rendered.');
  }
  return value;
}
