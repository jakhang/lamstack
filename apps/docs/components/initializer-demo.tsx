'use client';

import * as React from 'react';
import { parallel, Initializer, useInitializer } from '@lamstack/react-initializer';
import type {
  InitializationTask,
  TaskEntry,
  TaskSnapshot,
  ErrorScreenProps,
  SplashScreenProps,
} from '@lamstack/react-initializer';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STATUS_STYLE: Record<TaskSnapshot['status'], { icon: string; className: string }> = {
  pending: { icon: '○', className: 'text-neutral-400 dark:text-neutral-600' },
  running: { icon: '◐', className: 'text-blue-500 animate-pulse' },
  completed: { icon: '●', className: 'text-emerald-500' },
  failed: { icon: '✕', className: 'text-red-500' },
  skipped: { icon: '–', className: 'text-neutral-400 dark:text-neutral-600' },
  cancelled: { icon: '⊘', className: 'text-neutral-400 dark:text-neutral-600' },
};

function TaskList({ tasks }: { tasks: TaskSnapshot[] }) {
  return (
    <ul className="space-y-1.5 font-mono text-sm">
      {tasks.map((task) => {
        const style = STATUS_STYLE[task.status];
        return (
          <li key={task.id} className="flex items-center gap-2">
            <span className={style.className}>{style.icon}</span>
            <span className="text-neutral-700 dark:text-neutral-300">{task.id}</span>
            <span className="text-neutral-400 dark:text-neutral-600">{task.status}</span>
          </li>
        );
      })}
    </ul>
  );
}

function DemoSplashScreen({ progress, tasks }: SplashScreenProps) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <TaskList tasks={tasks} />
    </div>
  );
}

function DemoErrorScreen({ error, retry }: ErrorScreenProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">
        Task &quot;{error.taskId}&quot; failed: {String(error.error)}
      </p>
      <button
        onClick={retry}
        className="mt-3 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Retry
      </button>
    </div>
  );
}

function ReadyPanel() {
  const { tasks, retry } = useInitializer();
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
        ✓ App ready — every required task settled.
      </p>
      <div className="mt-3">
        <TaskList tasks={tasks} />
      </div>
      <button
        onClick={retry}
        className="mt-3 rounded-md px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        Run again
      </button>
    </div>
  );
}

function buildTasks(failAuth: boolean): TaskEntry[] {
  const config: InitializationTask = {
    id: 'config',
    run: () => delay(400),
  };

  const auth: InitializationTask = {
    id: 'auth',
    critical: true,
    run: async () => {
      await delay(600);
      if (failAuth) throw new Error('Session expired');
    },
  };

  // This whole stage runs after `auth` settles — if auth fails, the run
  // aborts and none of these three ever start (try the checkbox below).
  const profile: InitializationTask = { id: 'profile', run: () => delay(500) };
  const cache: InitializationTask = { id: 'cache', run: () => delay(350) };
  const translations: InitializationTask = {
    id: 'translations',
    critical: false, // must be attempted, but a fallback locale covers a failure
    run: async () => {
      await delay(300);
      throw new Error('Translation service unreachable');
    },
  };

  return [config, auth, parallel([profile, cache, translations])];
}

export function InitializerDemo() {
  const [failAuth, setFailAuth] = React.useState(false);

  // `tasks` is only re-read by <Initializer> when a run (re)starts — toggling
  // this checkbox alone won't affect a run already in progress or already
  // completed. Click "Retry"/"Run again" afterwards to see the new value.
  const tasks = React.useMemo(() => buildTasks(failAuth), [failAuth]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        <input
          type="checkbox"
          checked={failAuth}
          onChange={(event) => setFailAuth(event.target.checked)}
        />
        Simulate auth failure (then Retry/Run again to apply)
      </label>

      <Initializer tasks={tasks} splashScreen={DemoSplashScreen} errorScreen={DemoErrorScreen}>
        <ReadyPanel />
      </Initializer>
    </div>
  );
}
