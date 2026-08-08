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

function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
    />
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
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

const templates: DialogTemplates = {
  alert: AlertDialog,
  confirm: ConfirmDialog,
  prompt: PromptDialog,
};

function DemoButtons() {
  const { confirm } = useDialogs();
  const [result, setResult] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-3">
      <PrimaryButton
        onClick={async () => {
          const confirmed = await confirm('Delete this item? This cannot be undone.', {
            title: 'Are you sure?',
            okText: 'Delete',
            cancelText: 'Cancel',
          });
          setResult(confirmed ? 'Confirmed' : 'Cancelled');
        }}
      >
        Open confirm dialog
      </PrimaryButton>
      {result ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Result: {result}</p>
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
