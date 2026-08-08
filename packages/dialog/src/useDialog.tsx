'use client';
import * as React from 'react';
import { useNonNullableContext } from '@omnireact/core';
import { DialogsContext } from './dialog.context';
import type { AlertOptions, ConfirmOptions, DialogHook, PromptOptions } from './types';

/**
 * Access the imperative dialogs API.
 * Must be called from a descendant of <DialogsProvider>.
 */
export function useDialogs(): DialogHook {
  const { open, close, templates } = useNonNullableContext(DialogsContext);

  const alert = React.useCallback(
    (message: React.ReactNode, options: AlertOptions = {}) => {
      // Options are nested into the payload (alongside `msg`) instead of
      // being spread as sibling props next to the real `DialogProps.onClose`.
      // See the DialogTemplates comment in types.ts for why.
      return open(templates.alert, { msg: message, ...options }, options);
    },
    [open, templates],
  );

  const confirm = React.useCallback(
    (message: React.ReactNode, options: ConfirmOptions = {}) => {
      return open(templates.confirm, { msg: message, ...options }, options);
    },
    [open, templates],
  );

  const prompt = React.useCallback(
    (message: React.ReactNode, options: PromptOptions = {}) => {
      return open(templates.prompt, { msg: message, ...options }, options);
    },
    [open, templates],
  );

  return React.useMemo(
    () => ({ open, close, alert, confirm, prompt }),
    [open, close, alert, confirm, prompt],
  );
}
