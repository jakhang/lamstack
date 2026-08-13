'use client';
import * as React from 'react';
import invariant from 'invariant';
import { useEventCallback } from '@lamstack/react-core';
import { DialogsContext } from './dialog.context';
import type {
  CloseDialog,
  DialogComponent,
  DialogTemplates,
  OpenDialog,
  OpenDialogOptions,
} from './types';

/** Internal bookkeeping for one dialog currently on the stack. */
interface DialogStackEntry<P, R> {
  key: string;
  open: boolean;
  promise: Promise<R>;
  Component: DialogComponent<P, R>;
  payload: P;
  onClose: (result: R) => Promise<void>;
  resolve: (result: R) => void;
}

/**
 * A stack holding dialogs with different P/R per entry cannot be stored in
 * one homogeneous array without erasing the generics somewhere — that's a
 * structural limitation of TypeScript, not an oversight. Rather than
 * scattering `any` throughout the module, we erase to `unknown` and perform
 * exactly ONE explicit cast, right where an entry is pushed onto the stack.
 * Every public call site (open/close/useDialogs) stays fully typed.
 */
type ErasedDialogStackEntry = DialogStackEntry<unknown, unknown>;

export interface DialogProviderProps {
  children?: React.ReactNode;
  /** Delay (ms) before a closed dialog is unmounted, to allow exit animations. */
  unmountAfter?: number;
  /** Components used to render the built-in alert/confirm/prompt dialogs. */
  templates: DialogTemplates;
}

export function DialogsProvider(props: DialogProviderProps) {
  const { children, unmountAfter = 1000, templates } = props;
  const [stack, setStack] = React.useState<ErasedDialogStackEntry[]>([]);
  const keyPrefix = React.useId();
  const nextId = React.useRef(0);

  // Maps a dialog's promise back to its stack entry, so closeDialog() can
  // find the entry without needing the key. WeakMap avoids leaking memory
  // for closed dialogs.
  const dialogMetadata = React.useRef(new WeakMap<Promise<unknown>, ErasedDialogStackEntry>());

  // useEventCallback returns a stable, non-generic function reference (it
  // doesn't know the concrete P/R at the call site). We restore the real
  // generic OpenDialog signature with one explicit cast here, instead of
  // letting TypeScript silently widen P/R to `any` at every call site.
  const requestDialog = useEventCallback(function open<P, R>(
    Component: DialogComponent<P, R>,
    payload: P,
    options: OpenDialogOptions<R> = {},
  ): Promise<R> {
    const { onClose = async () => {} } = options;
    let resolve!: (result: R) => void;

    const promise = new Promise<R>((resolveImpl) => {
      resolve = resolveImpl;
    });
    invariant(resolve, 'resolve not set');

    const key = `${keyPrefix}-${nextId.current}`;
    nextId.current += 1;

    const newEntry: DialogStackEntry<P, R> = {
      key,
      open: true,
      promise,
      Component,
      payload,
      onClose,
      resolve,
    };

    // The single, intentional type-erasure boundary (see comment above).
    const erasedEntry = newEntry as unknown as ErasedDialogStackEntry;
    dialogMetadata.current.set(promise, erasedEntry);

    setStack((prevStack) => [...prevStack, erasedEntry]);
    return promise;
  }) as OpenDialog;

  const closeDialogUi = useEventCallback(function closeDialogUi(dialog: Promise<unknown>) {
    // Mark closed first, so the dialog can play its exit animation...
    setStack((prevStack) =>
      prevStack.map((entry) => (entry.promise === dialog ? { ...entry, open: false } : entry)),
    );

    // ...then actually remove it from the stack after the animation delay.
    setTimeout(() => {
      setStack((prevStack) => prevStack.filter((entry) => entry.promise !== dialog));
    }, unmountAfter);
  });

  const closeDialog = useEventCallback(async function closeDialog<R>(
    dialog: Promise<R>,
    result: R,
  ): Promise<R> {
    const entryToClose = dialogMetadata.current.get(dialog as Promise<unknown>);
    if (!entryToClose) return dialog;

    try {
      // Run the caller-provided onClose (e.g. an API call) before the
      // dialog's promise resolves and the UI unmounts.
      await entryToClose.onClose(result);
    } catch (error) {
      // A failing onClose must not trap the dialog open forever, nor become
      // an unhandled rejection at this function's call sites (the per-dialog
      // wrapper below, and any caller of the public `close()`/`CloseDialog`
      // API) — `entryToClose.resolve` in `finally` still carries the result
      // to the original `open()` promise regardless of this failure.
      console.error('[@lamstack/react-dialog] onClose handler threw:', error);
    } finally {
      // Always resolve + start closing the UI, even if onClose threw —
      // a failing side effect should not trap the dialog open forever.
      entryToClose.resolve(result);
      closeDialogUi(dialog as Promise<unknown>);
    }
    return dialog;
  }) as CloseDialog;

  const contextValue = React.useMemo(
    () => ({ open: requestDialog, close: closeDialog, templates }),
    [requestDialog, closeDialog, templates],
  );

  return (
    <DialogsContext.Provider value={contextValue}>
      {children}

      {stack.map(({ key, open, Component, payload, promise }) => (
        <Component
          key={key}
          payload={payload}
          open={open}
          onClose={async (result) => {
            await closeDialog(promise, result);
          }}
        />
      ))}
    </DialogsContext.Provider>
  );
}
