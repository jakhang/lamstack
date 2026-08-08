'use client';

import { createTheme } from '@mui/material/styles';

/**
 * `colorSchemeSelector: 'class'` scopes MUI's generated CSS variables under
 * `.light`/`.dark` selectors. next-themes (via nextra-theme-docs) already
 * toggles a `dark`/`light` class on <html> — reusing that class here means
 * MUI follows the docs site's own theme switcher with no separate MUI
 * color-scheme script or state of its own.
 */
export const muiTheme = createTheme({
  colorSchemes: { light: true, dark: true },
  cssVariables: { colorSchemeSelector: 'class' },
});
