import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useNonNullableContext } from './index';

const TestContext = React.createContext<string | null>(null);

function Consumer() {
  const value = useNonNullableContext(TestContext);
  return <span data-testid="value">{value}</span>;
}

function ThrowingConsumer() {
  useNonNullableContext(TestContext);
  return null;
}

describe('useNonNullableContext', () => {
  it('returns the context value when a provider supplies one', () => {
    render(
      <TestContext.Provider value="hello">
        <Consumer />
      </TestContext.Provider>,
    );
    expect(screen.getByTestId('value')).toHaveTextContent('hello');
  });

  it('throws when the context value is null (no provider rendered)', () => {
    // Suppress the expected React error-boundary console.error noise for this assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ThrowingConsumer />)).toThrow(/Context value is null/);
    spy.mockRestore();
  });
});
