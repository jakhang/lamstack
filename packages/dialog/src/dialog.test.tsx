import * as React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DialogsProvider } from './dialog.provider';
import { useDialogs } from './useDialog';
import type { DialogProps, DialogTemplates } from './types';

interface EchoPayload {
  msg: string;
}

function EchoDialog({ payload, open, onClose }: DialogProps<EchoPayload, string>) {
  if (!open) return null;
  return (
    <div role="dialog">
      <span data-testid="dialog-msg">{payload.msg}</span>
      <button onClick={() => onClose('confirmed')}>close</button>
    </div>
  );
}

const templates: DialogTemplates = {
  alert: ({ payload, open, onClose }) =>
    !open ? null : (
      <div role="alertdialog">
        <span data-testid="alert-msg">{payload.msg}</span>
        <button onClick={() => onClose()}>ok</button>
      </div>
    ),
  confirm: ({ payload, open, onClose }) =>
    !open ? null : (
      <div role="alertdialog">
        <span data-testid="confirm-msg">{payload.msg}</span>
        <button onClick={() => onClose(true)}>yes</button>
        <button onClick={() => onClose(false)}>no</button>
      </div>
    ),
  prompt: ({ payload, open, onClose }) =>
    !open ? null : (
      <div role="alertdialog">
        <span data-testid="prompt-msg">{payload.msg}</span>
        <button onClick={() => onClose('typed value')}>submit</button>
      </div>
    ),
};

function renderWithProvider(children: React.ReactNode, unmountAfter = 0) {
  return render(
    <DialogsProvider templates={templates} unmountAfter={unmountAfter}>
      {children}
    </DialogsProvider>,
  );
}

describe('DialogsProvider + useDialogs', () => {
  it('opens a dialog with the given payload and resolves with the result on close', async () => {
    function Harness() {
      const { open } = useDialogs();
      const [result, setResult] = React.useState<string | null>(null);
      return (
        <div>
          <button onClick={() => open(EchoDialog, { msg: 'hello' }).then(setResult)}>
            open
          </button>
          <span data-testid="result">{result ?? ''}</span>
        </div>
      );
    }

    renderWithProvider(<Harness />);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByTestId('dialog-msg')).toHaveTextContent('hello');

    fireEvent.click(screen.getByText('close'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('confirmed'));
  });

  it('awaits the onClose side effect before the open() promise resolves', async () => {
    const events: string[] = [];
    let resolveSideEffect!: () => void;
    const sideEffect = new Promise<void>((resolve) => {
      resolveSideEffect = resolve;
    });

    function Harness() {
      const { open } = useDialogs();
      return (
        <button
          onClick={() =>
            open(
              EchoDialog,
              { msg: 'hi' },
              {
                onClose: async () => {
                  events.push('onClose:start');
                  await sideEffect;
                  events.push('onClose:end');
                },
              },
            ).then(() => events.push('open:resolved'))
          }
        >
          open
        </button>
      );
    }

    renderWithProvider(<Harness />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('close'));

    await waitFor(() => expect(events).toContain('onClose:start'));
    expect(events).not.toContain('open:resolved');

    await act(async () => {
      resolveSideEffect();
      await sideEffect;
    });

    await waitFor(() => expect(events).toEqual(['onClose:start', 'onClose:end', 'open:resolved']));
  });

  it('still resolves and closes the dialog even when onClose throws', async () => {
    function Harness() {
      const { open } = useDialogs();
      const [settled, setSettled] = React.useState(false);
      return (
        <div>
          <button
            onClick={() =>
              open(
                EchoDialog,
                { msg: 'hi' },
                {
                  onClose: async () => {
                    throw new Error('side effect failed');
                  },
                },
              ).finally(() => setSettled(true))
            }
          >
            open
          </button>
          <span data-testid="settled">{String(settled)}</span>
        </div>
      );
    }

    renderWithProvider(<Harness />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('close'));

    await waitFor(() => expect(screen.getByTestId('settled')).toHaveTextContent('true'));
  });

  it('alert/confirm/prompt open the matching template with msg + options in the payload', async () => {
    function Harness() {
      const { alert, confirm, prompt } = useDialogs();
      return (
        <div>
          <button onClick={() => alert('an alert', { okText: 'Got it' })}>do-alert</button>
          <button onClick={() => confirm('are you sure?')}>do-confirm</button>
          <button onClick={() => prompt('enter value')}>do-prompt</button>
        </div>
      );
    }

    renderWithProvider(<Harness />);

    fireEvent.click(screen.getByText('do-alert'));
    expect(screen.getByTestId('alert-msg')).toHaveTextContent('an alert');
    fireEvent.click(screen.getByText('ok'));

    fireEvent.click(screen.getByText('do-confirm'));
    expect(screen.getByTestId('confirm-msg')).toHaveTextContent('are you sure?');
    fireEvent.click(screen.getByText('yes'));

    fireEvent.click(screen.getByText('do-prompt'));
    expect(screen.getByTestId('prompt-msg')).toHaveTextContent('enter value');
    fireEvent.click(screen.getByText('submit'));
  });

  it('throws when useDialogs() is called without a DialogsProvider ancestor', () => {
    function Orphan() {
      useDialogs();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/Context value is null/);
    spy.mockRestore();
  });
});
