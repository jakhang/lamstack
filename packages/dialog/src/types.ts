import * as React from 'react';

// ============================================================
// Base Types
// ============================================================

/**
 * Props passed to every dialog component rendered by DialogsProvider.
 * P = payload type (data passed into the dialog when opened)
 * R = result type (data the dialog resolves with when closed)
 */
export interface DialogProps<P = undefined, R = void> {
  /** The payload that was passed when the dialog was opened. */
  payload: P;
  /** Whether the dialog is currently open. */
  open: boolean;
  /**
   * Call this to close the dialog, passing the result.
   * Returns a Promise that resolves once the dialog is fully closed
   * (after the `onClose` option, if any, has finished running) —
   * useful for showing a loading state while an async onClose runs.
   */
  onClose: (result: R) => Promise<void>;
}

/** A React component that can be opened as a dialog. */
export type DialogComponent<P = undefined, R = void> = React.ComponentType<DialogProps<P, R>>;

// ============================================================
// Options Types (per-call options for open/alert/confirm/prompt)
// ============================================================

export interface OpenDialogOptions<R> {
  /**
   * Called right before the dialog closes. The dialog stays open as long
   * as the returned Promise is pending — use this for async side effects
   * (e.g. an API call) that should finish before the dialog disappears.
   */
  onClose?: (result: R) => Promise<void>;
}

export interface AlertOptions extends OpenDialogOptions<void> {
  title?: React.ReactNode;
  okText?: React.ReactNode;
  icon?: React.ReactNode;
}

export interface ConfirmOptions extends OpenDialogOptions<boolean> {
  title?: React.ReactNode;
  okText?: React.ReactNode;
  cancelText?: React.ReactNode;
  severity?: 'error' | 'info' | 'success' | 'warning';
  icon?: React.ElementType;
}

export interface PromptOptions extends OpenDialogOptions<string | null> {
  title?: React.ReactNode;
  okText?: React.ReactNode;
  cancelText?: React.ReactNode;
  placeholder?: string;
  defaultValue?: string;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  icon?: React.ReactNode;
}

// ============================================================
// Imperative call signatures
// ============================================================

export interface OpenAlertDialog {
  /**
   * Opens an alert dialog. Resolves when the user acknowledges it.
   * @param msg The message to show in the dialog.
   * @param options Additional options for the dialog.
   */
  (msg: React.ReactNode, options?: AlertOptions): Promise<void>;
}

export interface OpenConfirmDialog {
  /**
   * Opens a confirmation dialog. Resolves to `true` if the user confirms,
   * `false` if the user cancels.
   */
  (msg: React.ReactNode, options?: ConfirmOptions): Promise<boolean>;
}

export interface OpenPromptDialog {
  /**
   * Opens a prompt dialog. Resolves to the entered value if the user
   * confirms, `null` if the user cancels.
   */
  (msg: React.ReactNode, options?: PromptOptions): Promise<string | null>;
}

export interface OpenDialog {
  /**
   * Open a dialog that takes no payload — `payload` can be omitted.
   * Only valid when `P extends undefined`.
   */
  <P extends undefined, R>(
    Component: DialogComponent<P, R>,
    payload?: P,
    options?: OpenDialogOptions<R>,
  ): Promise<R>;
  /**
   * Open a dialog and pass a payload.
   * @param Component The dialog component to open.
   * @param payload The payload to pass to the dialog.
   * @param options Additional options for the dialog.
   */
  <P, R>(Component: DialogComponent<P, R>, payload: P, options?: OpenDialogOptions<R>): Promise<R>;
}

export interface CloseDialog {
  /**
   * Closes a dialog and resolves its promise with `result`.
   * @param dialog The promise returned by `open` for the dialog to close.
   * @param result The result to resolve the dialog's promise with.
   */
  <R>(dialog: Promise<R>, result: R): Promise<R>;
}

// ============================================================
// Public hook surface — the shape returned by useDialogs()
// ============================================================

export interface DialogHook {
  alert: OpenAlertDialog;
  confirm: OpenConfirmDialog;
  prompt: OpenPromptDialog;
  open: OpenDialog;
  close: CloseDialog;
}

// ============================================================
// Payload types for the built-in alert/confirm/prompt dialogs
// (mirrors @toolpad/core's AlertDialogPayload / ConfirmDialogPayload /
// PromptDialogPayload)
// ============================================================

export interface AlertDialogPayload extends AlertOptions {
  msg: React.ReactNode;
}

export interface ConfirmDialogPayload extends ConfirmOptions {
  msg: React.ReactNode;
}

export interface PromptDialogPayload extends PromptOptions {
  msg: React.ReactNode;
}

// ============================================================
// Template Injection Types
// ============================================================

/**
 * Components used to render the built-in alert/confirm/prompt dialogs.
 *
 * Options (title, okText, the `onClose` side-effect, ...) are nested INSIDE
 * `payload` alongside `msg`, rather than spread as sibling props next to the
 * real `DialogProps.onClose`. This is deliberate: `OpenDialogOptions.onClose`
 * (an optional side-effect run before closing) and `DialogProps.onClose`
 * (the actual close function) would otherwise share the same prop name at
 * the top level if flattened — nesting keeps them in separate namespaces so
 * there is no risk of one silently shadowing the other.
 */
export interface DialogTemplates {
  alert: React.ComponentType<DialogProps<AlertDialogPayload, void>>;
  confirm: React.ComponentType<DialogProps<ConfirmDialogPayload, boolean>>;
  prompt: React.ComponentType<DialogProps<PromptDialogPayload, string | null>>;
}
