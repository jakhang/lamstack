# @omnireact/dialog

Headless, imperative dialog API for React — `useDialogs()` gives you `open`, `close`,
`alert`, `confirm`, and `prompt`, all promise-based. You bring the actual dialog
components (whatever UI library you use); this package handles the stack, the imperative
`open()`/`close()` plumbing, and the `Promise<result>` semantics.

## Install

```bash
pnpm add @omnireact/dialog
```

## Usage

```tsx
import { DialogsProvider, useDialogs } from '@omnireact/dialog';
import type { DialogTemplates } from '@omnireact/dialog';

const templates: DialogTemplates = {
  alert: MyAlertDialog,
  confirm: MyConfirmDialog,
  prompt: MyPromptDialog,
};

function App() {
  return (
    <DialogsProvider templates={templates}>
      <DeleteButton />
    </DialogsProvider>
  );
}

function DeleteButton() {
  const { confirm } = useDialogs();

  return (
    <button
      onClick={async () => {
        const ok = await confirm('Delete this item?', { title: 'Are you sure?' });
        if (ok) {
          // ...delete it
        }
      }}
    >
      Delete
    </button>
  );
}
```

Full docs, live demo, and API reference: [omnireact docs](../../apps/docs) (or the
published docs site once deployed).

## License

MIT
