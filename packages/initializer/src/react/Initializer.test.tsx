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
});

describe('useInitializer', () => {
  it('throws when called without an Initializer ancestor', () => {
    function Orphan() {
      useInitializer();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/Context value is null/);
    spy.mockRestore();
  });
});
