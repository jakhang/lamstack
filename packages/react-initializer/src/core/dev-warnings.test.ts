import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkTasks, warnAboutTasks } from './dev-warnings';
import { parallel, type InitializationTask } from './task';

function task(id: string, overrides: Partial<InitializationTask> = {}): InitializationTask {
  return { id, run: async () => {}, ...overrides };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('checkTasks — retry without timeout', () => {
  it('warns when retry > 1 and no timeout is set', () => {
    const warnings = checkTasks([task('a', { retry: 3 })]);
    expect(warnings).toEqual([expect.stringContaining('Task "a" has retry: 3 but no timeout')]);
  });

  it('does not warn when retry is set alongside a timeout', () => {
    expect(checkTasks([task('a', { retry: 3, timeout: 500 })])).toEqual([]);
  });

  it('does not warn for the default retry (1, i.e. no retry) even without a timeout', () => {
    expect(checkTasks([task('a')])).toEqual([]);
  });

  it('checks every task inside a parallel() stage too', () => {
    const warnings = checkTasks([parallel([task('a', { retry: 2 }), task('b')])]);
    expect(warnings).toEqual([expect.stringContaining('Task "a" has retry: 2 but no timeout')]);
  });
});

describe('checkTasks — non-critical task in its own sequential stage', () => {
  it('warns when a critical: false task is a standalone stage followed by another', () => {
    const warnings = checkTasks([task('a', { critical: false }), task('b')]);
    expect(warnings).toEqual([
      expect.stringContaining('Task "a" is critical: false but runs in its own sequential stage'),
    ]);
  });

  it('does not warn when the non-critical task is inside a parallel() group', () => {
    expect(checkTasks([parallel([task('a', { critical: false })]), task('b')])).toEqual([]);
  });

  it('does not warn when the non-critical task is the last stage (nothing waits on it)', () => {
    expect(checkTasks([task('a'), task('b', { critical: false })])).toEqual([]);
  });
});

describe('warnAboutTasks', () => {
  it('logs each warning via console.warn, prefixed with the package name', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnAboutTasks([task('a', { retry: 3 })]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[@lamstack/react-initializer]'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('retry: 3 but no timeout'));
    warnSpy.mockRestore();
  });

  it('does not warn (or throw) for tasks with nothing to flag', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnAboutTasks([task('a'), task('b')]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('stays silent in production (NODE_ENV=production)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnAboutTasks([task('a', { retry: 3 })]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
