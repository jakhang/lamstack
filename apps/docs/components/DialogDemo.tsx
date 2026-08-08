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

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.4)',
  zIndex: 50,
};

const dialogStyle: React.CSSProperties = {
  background: 'var(--nextra-bg, white)',
  color: 'inherit',
  borderRadius: 8,
  padding: 20,
  minWidth: 280,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

function AlertDialog({ payload, open, onClose }: DialogProps<AlertDialogPayload, void>) {
  if (!open) return null;
  return (
    <div style={overlayStyle}>
      <div style={dialogStyle} role="alertdialog">
        {payload.title ? <strong>{payload.title}</strong> : null}
        <p>{payload.msg}</p>
        <div style={buttonRowStyle}>
          <button onClick={() => onClose()}>{payload.okText ?? 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ payload, open, onClose }: DialogProps<ConfirmDialogPayload, boolean>) {
  if (!open) return null;
  return (
    <div style={overlayStyle}>
      <div style={dialogStyle} role="alertdialog">
        {payload.title ? <strong>{payload.title}</strong> : null}
        <p>{payload.msg}</p>
        <div style={buttonRowStyle}>
          <button onClick={() => onClose(false)}>{payload.cancelText ?? 'Cancel'}</button>
          <button onClick={() => onClose(true)}>{payload.okText ?? 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

function PromptDialog({ payload, open, onClose }: DialogProps<PromptDialogPayload, string | null>) {
  const [value, setValue] = React.useState(payload.defaultValue ?? '');
  if (!open) return null;
  return (
    <div style={overlayStyle}>
      <div style={dialogStyle} role="alertdialog">
        {payload.title ? <strong>{payload.title}</strong> : null}
        <p>{payload.msg}</p>
        <input
          value={value}
          placeholder={payload.placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
        <div style={buttonRowStyle}>
          <button onClick={() => onClose(null)}>{payload.cancelText ?? 'Cancel'}</button>
          <button onClick={() => onClose(value)}>{payload.okText ?? 'OK'}</button>
        </div>
      </div>
    </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
      <button
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
      </button>
      {result ? <p>Result: {result}</p> : null}
    </div>
  );
}

export function DialogDemo() {
  return (
    <DialogsProvider templates={templates}>
      <DemoButtons />
    </DialogsProvider>
  );
}
