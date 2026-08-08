import * as React from 'react';
import type { CloseDialog, DialogTemplates, OpenDialog } from './types';

/**
 * The value provided by DialogsProvider. Note this is intentionally NOT the
 * full DialogHook — `alert`/`confirm`/`prompt` are convenience wrappers
 * built on top of `open` inside useDialogs(), not part of the raw context.
 */
export interface DialogsContextType {
  open: OpenDialog;
  close: CloseDialog;
  templates: DialogTemplates;
}

export const DialogsContext = React.createContext<DialogsContextType | null>(null);
