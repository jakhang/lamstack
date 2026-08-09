import * as React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Initializer } from './Initializer';
import { useInitializer } from './useInitializer';
import type { InitializationTask } from '../core/task';
import type { ErrorScreenProps, SplashScreenProps } from './Initializer';

function task(id: string, overrides: Partial<InitializationTask> = {}): InitializationTask {
  return { id, run: async () => {}, ...overrides };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A task that only settles when its context signal aborts — for exercising cancellation. */
function abortableTask(id: string): InitializationTask {
  return {
    id,
    run: ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  };
}

describe('Initializer', () => {
  it('shows the default splash screen while running, then renders children', async () => {
    render(
      <Initializer tasks={[task('a')]}>
        <div data-testid="app">App</div>
      </Initializer>,
    );

    expect(screen.getByText(/Initializing/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('app')).toBeInTheDocument());
  });

  it('reflects progress in the default splash screen', async () => {
    const d1 = deferred();
    const tasks = [task('a', { run: () => d1.promise }), task('b')];

    render(
      <Initializer tasks={tasks}>
        <div data-testid="app">App</div>
      </Initializer>,
    );

    await waitFor(() => expect(screen.getByText(/0%/)).toBeInTheDocument());
    d1.resolve();
    await waitFor(() => expect(screen.getByTestId('app')).toBeInTheDocument());
  });

  it('shows the default error screen on a critical failure, naming the failed task', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tasks = [
      task('config', {
        run: async () => {
          throw new Error('boom');
        },
      }),
    ];

    render(
      <Initializer tasks={tasks}>
        <div data-testid="app">App</div>
      </Initializer>,
    );

    await waitFor(() => expect(screen.getByText('Initialization Failed')).toBeInTheDocument());
    expect(screen.getByText(/config/)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('P2 regression: default splash/error/cancelled screens carry accessible roles', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount: unmountSplash } = render(
      <Initializer tasks={[task('a', { run: () => new Promise(() => {}) })]}>
        <div>App</div>
      </Initializer>,
    );
    expect(screen.getByRole('status', { busy: true })).toBeInTheDocument();
    unmountSplash();

    render(
      <Initializer tasks={[task('a', { run: async () => { throw new Error('boom'); } })]}>
        <div>App</div>
      </Initializer>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    consoleSpy.mockRestore();
  });

  it('P2 regression: default error screen formats a thrown plain object instead of showing "[object Object]"', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tasks = [
      task('config', {
        run: async () => {
          throw { code: 'CONFIG_MISSING' };
        },
      }),
    ];

    render(
      <Initializer tasks={tasks}>
        <div data-testid="app">App</div>
      </Initializer>,
    );

    await waitFor(() => expect(screen.getByText('Initialization Failed')).toBeInTheDocument());
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
    expect(screen.getByText(/CONFIG_MISSING/)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('restarts the whole sequence when Retry is clicked, and can succeed the second time', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let attempt = 0;
    const tasks = [
      task('flaky', {
        run: async () => {
          attempt += 1;
          if (attempt === 1) throw new Error('first attempt fails');
        },
      }),
    ];

    render(
      <Initializer tasks={tasks}>
        <div data-testid="app">App</div>
      </Initializer>,
    );

    await waitFor(() => expect(screen.getByText('Retry')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => expect(screen.getByTestId('app')).toBeInTheDocument());
    expect(attempt).toBe(2);
    consoleSpy.mockRestore();
  });

  it('renders children immediately for an empty task list', async () => {
    render(
      <Initializer tasks={[]}>
        <div data-testid="app">App</div>
      </Initializer>,
    );
    await waitFor(() => expect(screen.getByTestId('app')).toBeInTheDocument());
  });

  it('P1-5 regression: an empty task list settles on the very next microtask flush — no extra macrotask/effect-deferral tax', async () => {
    render(
      <Initializer tasks={[]}>
        <div data-testid="app">App</div>
      </Initializer>,
    );
    // Previously the handle wasn't even created until a *passive* effect ran
    // (deferred past paint); now it's a *layout* effect, so `run()` — and its
    // one unavoidable microtask hop through `await runStages()` — starts
    // before paint. Flushing once (no real timer, no `waitFor` polling) is
    // enough to reach 'completed'.
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByTestId('app')).toBeInTheDocument();
  });

  it('P1-5 regression: minSplashDuration keeps the splash up after a fast task settles, then switches to children', async () => {
    const t = task('fast', { run: async () => {} });

    render(
      <Initializer tasks={[t]} minSplashDuration={150}>
        <div data-testid="app">App</div>
      </Initializer>,
    );

    expect(screen.getByText(/Initializing/)).toBeInTheDocument();

    // The task itself resolves almost immediately, well under 150ms — but the
    // splash must still be showing shortly after, before minSplashDuration elapses.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByText(/Initializing/)).toBeInTheDocument();
    expect(screen.queryByTestId('app')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('app')).toBeInTheDocument(), { timeout: 1000 });
  });

  it('P1-1 regression: shows a deliberate "cancelled" UI instead of a stuck splash screen when abort() is called', async () => {
    function SplashWithCancel() {
      const { abort } = useInitializer();
      return <button onClick={abort}>Cancel</button>;
    }

    render(
      <Initializer tasks={[abortableTask('slow')]} splashScreen={SplashWithCancel}>
        <div data-testid="app">App</div>
      </Initializer>,
    );

    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(screen.getByText('Initialization Cancelled')).toBeInTheDocument());
  });

  it('supports a custom cancelledScreen', async () => {
    function SplashWithCancel() {
      const { abort } = useInitializer();
      return <button onClick={abort}>Cancel</button>;
    }
    const CustomCancelled: React.FC<{ retry: () => void }> = ({ retry }) => (
      <div data-testid="custom-cancelled">
        <button onClick={retry}>Try again</button>
      </div>
    );

    render(
      <Initializer
        tasks={[abortableTask('slow')]}
        splashScreen={SplashWithCancel}
        cancelledScreen={CustomCancelled}
      >
        <div data-testid="app">App</div>
      </Initializer>,
    );

    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(screen.getByTestId('custom-cancelled')).toBeInTheDocument());
  });

  it('supports custom splashScreen and errorScreen components', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const CustomSplash: React.FC<SplashScreenProps> = ({ progress }) => (
      <div data-testid="custom-splash">Loading {progress}</div>
    );
    const CustomError: React.FC<ErrorScreenProps> = ({ error }) => (
      <div data-testid="custom-error">Oops: {error.taskId}</div>
    );

    const failing = [
      task('a', {
        run: async () => {
          throw new Error('boom');
        },
      }),
    ];

    render(
      <Initializer tasks={failing} splashScreen={CustomSplash} errorScreen={CustomError}>
        <div data-testid="app">App</div>
      </Initializer>,
    );

    await waitFor(() => expect(screen.getByTestId('custom-error')).toHaveTextContent('Oops: a'));
    consoleSpy.mockRestore();
  });

  it('exposes status/progress/tasks/retry/abort to descendants via useInitializer()', async () => {
    function App() {
      const { status, progress, tasks, retry, abort } = useInitializer();
      return (
        <div>
          <span data-testid="status">{status}</span>
          <span data-testid="progress">{progress}</span>
          <span data-testid="task-count">{tasks.length}</span>
          <button onClick={retry}>reset</button>
          <button onClick={abort}>stop</button>
        </div>
      );
    }

    render(
      <Initializer tasks={[task('a'), task('b')]}>
        <App />
      </Initializer>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('completed'));
    expect(screen.getByTestId('progress')).toHaveTextContent('100');
    expect(screen.getByTestId('task-count')).toHaveTextContent('2');
  });

  it('task-6 regression: exposes the shared state via useInitializer().getState() once the run completes', async () => {
    type AppState = { user: string };
    function App() {
      const { status, getState } = useInitializer<AppState>();
      return <span data-testid="user">{status === 'completed' ? getState().get('user') : 'loading'}</span>;
    }

    render(
      <Initializer<AppState> tasks={[task('load-user', { run: ({ state }) => void state.set('user', 'Ada') })]}>
        <App />
      </Initializer>,
    );

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Ada'));
  });
});

describe('useInitializer', () => {
  it('throws when called without an Initializer ancestor', () => {
    function Orphan() {
      useInitializer();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/useInitializer\(\) was called outside of <Initializer>/);
    spy.mockRestore();
  });
});
