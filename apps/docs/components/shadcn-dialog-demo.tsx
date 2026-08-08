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
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

function AlertDialog({ payload, open, onClose }: DialogProps<AlertDialogPayload, void>) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          {payload.title ? <DialogTitle>{payload.title}</DialogTitle> : null}
          <DialogDescription>{payload.msg}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onClose()}>{payload.okText ?? 'OK'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({ payload, open, onClose }: DialogProps<ConfirmDialogPayload, boolean>) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          {payload.title ? <DialogTitle>{payload.title}</DialogTitle> : null}
          <DialogDescription>{payload.msg}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>
            {payload.cancelText ?? 'Cancel'}
          </Button>
          <Button onClick={() => onClose(true)}>{payload.okText ?? 'OK'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PromptDialog({
  payload,
  open,
  onClose,
}: DialogProps<PromptDialogPayload, string | null>) {
  const [value, setValue] = React.useState(payload.defaultValue ?? '');
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose(null)}>
      <DialogContent>
        <DialogHeader>
          {payload.title ? <DialogTitle>{payload.title}</DialogTitle> : null}
          <DialogDescription>{payload.msg}</DialogDescription>
        </DialogHeader>
        <input
          className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={value}
          placeholder={payload.placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(null)}>
            {payload.cancelText ?? 'Cancel'}
          </Button>
          <Button onClick={() => onClose(value)}>{payload.okText ?? 'OK'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <Button
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
      </Button>
      {result ? <p className="text-sm text-muted-foreground">Result: {result}</p> : null}
    </div>
  );
}

export function ShadcnDialogDemo() {
  return (
    <DialogsProvider templates={templates}>
      <DemoButtons />
    </DialogsProvider>
  );
}
