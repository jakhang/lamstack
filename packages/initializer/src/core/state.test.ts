import { describe, expect, it } from 'vitest';
import { createInitializationState } from './state';

describe('createInitializationState', () => {
  it('stores and retrieves values by key', () => {
    const state = createInitializationState();
    state.set('user', { id: 1 });
    expect(state.get('user')).toEqual({ id: 1 });
  });

  it('returns undefined for a missing key', () => {
    const state = createInitializationState();
    expect(state.get('missing')).toBeUndefined();
  });

  it('has() reflects whether a key was set', () => {
    const state = createInitializationState();
    expect(state.has('user')).toBe(false);
    state.set('user', 'anything');
    expect(state.has('user')).toBe(true);
  });

  it('is isolated per instance', () => {
    const a = createInitializationState();
    const b = createInitializationState();
    a.set('key', 'a-value');
    expect(b.get('key')).toBeUndefined();
  });
});
