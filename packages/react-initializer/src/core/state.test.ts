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

  it('P2 regression: a typed StateMap gives get/set per-key type inference (and still round-trips at runtime)', () => {
    interface User {
      id: number;
      name: string;
    }
    type AppState = { user: User; ready: boolean };

    const state = createInitializationState<AppState>();
    state.set('user', { id: 1, name: 'Ada' });
    state.set('ready', true);

    // `.id`/`.name` type-check here only because `get('user')` is inferred
    // as `User | undefined`, not `unknown` — this would fail to compile
    // before the StateMap generic existed.
    const user = state.get('user');
    expect(user?.id).toBe(1);
    expect(user?.name).toBe('Ada');
    expect(state.get('ready')).toBe(true);
    expect(state.has('user')).toBe(true);
  });
});
