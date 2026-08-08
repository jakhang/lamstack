'use client';

import * as React from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import { DialogsProvider, useDialogs } from '@omnireact/dialog';
import type {
  AlertDialogPayload,
  ConfirmDialogPayload,
  DialogProps,
  DialogTemplates,
  PromptDialogPayload,
} from '@omnireact/dialog';

function AlertDialog({ payload, open, onClose }: DialogProps<AlertDialogPayload, void>) {
  return (
    <Dialog open={open} onClose={() => onClose()}>
      {payload.title ? <DialogTitle>{payload.title}</DialogTitle> : null}
      <DialogContent>
        <DialogContentText>{payload.msg}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()} variant="contained">
          {payload.okText ?? 'OK'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ConfirmDialog({ payload, open, onClose }: DialogProps<ConfirmDialogPayload, boolean>) {
  return (
    <Dialog open={open} onClose={() => onClose(false)}>
      {payload.title ? <DialogTitle>{payload.title}</DialogTitle> : null}
      <DialogContent>
        <DialogContentText>{payload.msg}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(false)}>{payload.cancelText ?? 'Cancel'}</Button>
        <Button onClick={() => onClose(true)} variant="contained">
          {payload.okText ?? 'OK'}
        </Button>
      </DialogActions>
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
    <Dialog open={open} onClose={() => onClose(null)}>
      {payload.title ? <DialogTitle>{payload.title}</DialogTitle> : null}
      <DialogContent>
        <DialogContentText>{payload.msg}</DialogContentText>
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          variant="standard"
          value={value}
          placeholder={payload.placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(null)}>{payload.cancelText ?? 'Cancel'}</Button>
        <Button onClick={() => onClose(value)} variant="contained">
          {payload.okText ?? 'OK'}
        </Button>
      </DialogActions>
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
    <Stack sx={{ alignItems: 'flex-start' }} spacing={1.5}>
      <Button
        variant="contained"
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
      {result ? <Typography variant="body2">Result: {result}</Typography> : null}
    </Stack>
  );
}

export function MuiDialogDemo() {
  return (
    <DialogsProvider templates={templates}>
      <DemoButtons />
    </DialogsProvider>
  );
}
