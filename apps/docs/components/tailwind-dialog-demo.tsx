'use client';

import * as React from 'react';
import { DialogsProvider, useDialogs } from '@omnireact/dialog';
import type {
  AlertDialogPayload,
  ConfirmDialogPayload,
  DialogProps,
  DialogTemplates,
  PromptDialogPayload,
} from '@omnireact/dialog';

function DialogShell({
  title,
  children,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        {title ? (
          <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {title}
          </h3>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex justify-end gap-2">{children}</div>;
}

function SecondaryButton({
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-md px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800 ${className}`}
    />
  );
}

function PrimaryButton({
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:pointer-events-none disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 ${className}`}
    />
  );
}

function AlertDialog({ payload, open, onClose }: DialogProps<AlertDialogPayload, void>) {
  if (!open) return null;
  return (
    <DialogShell title={payload.title}>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{payload.msg}</p>
      <DialogActions>
        <PrimaryButton onClick={() => onClose()}>{payload.okText ?? 'OK'}</PrimaryButton>
      </DialogActions>
    </DialogShell>
  );
}

function ConfirmDialog({ payload, open, onClose }: DialogProps<ConfirmDialogPayload, boolean>) {
  if (!open) return null;
  return (
    <DialogShell title={payload.title}>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{payload.msg}</p>
      <DialogActions>
        <SecondaryButton onClick={() => onClose(false)}>
          {payload.cancelText ?? 'Cancel'}
        </SecondaryButton>
        <PrimaryButton onClick={() => onClose(true)}>{payload.okText ?? 'OK'}</PrimaryButton>
      </DialogActions>
    </DialogShell>
  );
}

function PromptDialog({
  payload,
  open,
  onClose,
}: DialogProps<PromptDialogPayload, string | null>) {
  const [value, setValue] = React.useState(payload.defaultValue ?? '');
  if (!open) return null;
  return (
    <DialogShell title={payload.title}>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{payload.msg}</p>
      <input
        className="mt-3 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-600 dark:text-neutral-100"
        value={value}
        placeholder={payload.placeholder}
        onChange={(event) => setValue(event.target.value)}
      />
      <DialogActions>
        <SecondaryButton onClick={() => onClose(null)}>
          {payload.cancelText ?? 'Cancel'}
        </SecondaryButton>
        <PrimaryButton onClick={() => onClose(value)}>{payload.okText ?? 'OK'}</PrimaryButton>
      </DialogActions>
    </DialogShell>
  );
}

// Demonstrates open() with a dialog that isn't one of the three built-in kinds — its own
// payload (ItemPayload) and result (number | null) type, nothing to do with
// AlertOptions/ConfirmOptions/PromptOptions.
interface ItemPayload {
  itemName: string;
}

function RatingDialog({ payload, open, onClose }: DialogProps<ItemPayload, number | null>) {
  const [rating, setRating] = React.useState(0);
  if (!open) return null;
  return (
    <DialogShell title={`Rate "${payload.itemName}"`}>
      <div className="mt-3 flex gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={star <= rating}
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            onClick={() => setRating(star)}
            className={
              star <= rating
                ? 'text-2xl text-amber-500'
                : 'text-2xl text-neutral-300 dark:text-neutral-600'
            }
          >
            ★
          </button>
        ))}
      </div>
      <DialogActions>
        <SecondaryButton onClick={() => onClose(null)}>Skip</SecondaryButton>
        <PrimaryButton disabled={rating === 0} onClick={() => onClose(rating)}>
          Submit
        </PrimaryButton>
      </DialogActions>
    </DialogShell>
  );
}

// Demonstrates awaiting DialogProps.onClose(result) inside the dialog itself to show a
// loading state — that promise only resolves once the caller's own async `onClose` option
// (passed to open()) has finished, so this needs no extra plumbing to know when to stop
// spinning.
function SaveDialog({ payload, open, onClose }: DialogProps<ItemPayload, boolean>) {
  const [pending, setPending] = React.useState(false);
  if (!open) return null;
  return (
    <DialogShell title="Save changes?">
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Save changes to &quot;{payload.itemName}&quot;?
      </p>
      <DialogActions>
        <SecondaryButton disabled={pending} onClick={() => onClose(false)}>
          Cancel
        </SecondaryButton>
        <PrimaryButton
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await onClose(true);
          }}
        >
          {pending ? 'Saving…' : 'Save'}
        </PrimaryButton>
      </DialogActions>
    </DialogShell>
  );
}

const templates: DialogTemplates = {
  alert: AlertDialog,
  confirm: ConfirmDialog,
  prompt: PromptDialog,
};

interface DemoAction {
  id: string;
  title: string;
  description: string;
  run: () => Promise<string>;
}

function ActionCard({
  action,
  disabled,
  onRun,
}: {
  action: DemoAction;
  disabled: boolean;
  onRun: (action: DemoAction) => void;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div>
        <p className="font-mono text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {action.title}
        </p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {action.description}
        </p>
      </div>
      <SecondaryButton
        className="self-start border border-neutral-300 dark:border-neutral-700"
        disabled={disabled}
        onClick={() => onRun(action)}
      >
        Run
      </SecondaryButton>
    </div>
  );
}

function DemoButtons() {
  const { alert, confirm, prompt, open } = useDialogs();
  const [log, setLog] = React.useState<{ id: number; text: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const nextLogId = React.useRef(0);

  function record(text: string) {
    nextLogId.current += 1;
    setLog((prev) => [{ id: nextLogId.current, text }, ...prev].slice(0, 6));
  }

  const actions: DemoAction[] = [
    {
      id: 'alert',
      title: 'alert()',
      description: 'Acknowledgement only — resolves void once dismissed.',
      run: async () => {
        await alert('Your changes have been saved.', { title: 'Success' });
        return 'alert() → acknowledged';
      },
    },
    {
      id: 'confirm',
      title: 'confirm()',
      description: 'Resolves true/false depending on which button was pressed.',
      run: async () => {
        const confirmed = await confirm('Delete this item? This cannot be undone.', {
          title: 'Are you sure?',
          okText: 'Delete',
          cancelText: 'Cancel',
        });
        return `confirm() → ${confirmed}`;
      },
    },
    {
      id: 'prompt',
      title: 'prompt()',
      description: 'Resolves the typed string, or null if cancelled.',
      run: async () => {
        const value = await prompt('What should we call this?', {
          title: 'Rename',
          placeholder: 'New name',
        });
        return `prompt() → ${JSON.stringify(value)}`;
      },
    },
    {
      id: 'custom',
      title: 'open(custom)',
      description: 'Any component works, not just alert/confirm/prompt — here, a rating.',
      run: async () => {
        const rating = await open(RatingDialog, { itemName: 'Acme Widget' });
        return `open(RatingDialog) → ${JSON.stringify(rating)}`;
      },
    },
    {
      id: 'loading',
      title: 'async onClose()',
      description:
        'onClose runs before the promise resolves — the dialog awaits it to show "Saving…" with no extra state.',
      run: async () => {
        const start = Date.now();
        const saved = await open(
          SaveDialog,
          { itemName: 'Acme Widget' },
          {
            onClose: async () => {
              await new Promise((resolve) => setTimeout(resolve, 1200));
            },
          },
        );
        return `open(SaveDialog) → saved=${saved} (${Date.now() - start}ms)`;
      },
    },
  ];

  async function runAction(action: DemoAction) {
    setBusy(true);
    try {
      record(await action.run());
    } finally {
      setBusy(false);
    }
  }

  async function runChainedFlow() {
    setBusy(true);
    try {
      const proceed = await confirm('Rename this item before continuing?', {
        okText: 'Yes, rename it',
        cancelText: 'Skip',
      });
      record(`1. confirm() → ${proceed}`);
      if (!proceed) return;

      const name = await prompt('New name:', { placeholder: 'e.g. Q3 Report' });
      record(`2. prompt() → ${JSON.stringify(name)}`);
      if (!name) return;

      await alert(`Renamed to "${name}".`, { title: 'Done' });
      record('3. alert() → acknowledged');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {actions.map((action) => (
          <ActionCard key={action.id} action={action} disabled={busy} onRun={runAction} />
        ))}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Chaining dialogs with async/await
        </p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Each call blocks until its dialog closes, so a multi-step flow — confirm, then
          prompt, then alert — reads top-to-bottom. No nested callbacks, no extra state for
          tracking which dialog is currently open.
        </p>
        <PrimaryButton className="mt-3" disabled={busy} onClick={runChainedFlow}>
          Run guided flow
        </PrimaryButton>
      </div>

      {log.length > 0 ? (
        <ol className="space-y-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          {log.map((entry) => (
            <li key={entry.id}>{entry.text}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function TailwindDialogDemo() {
  return (
    <DialogsProvider templates={templates}>
      <DemoButtons />
    </DialogsProvider>
  );
}
