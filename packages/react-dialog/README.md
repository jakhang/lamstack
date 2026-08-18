# @lamstack/react-dialog

Headless, imperative dialog API for React — `useDialogs()` gives you `open`, `close`,
`alert`, `confirm`, and `prompt`, all promise-based. You bring the actual dialog
components (whatever UI library you use); this package handles the stack, the imperative
`open()`/`close()` plumbing, and the `Promise<result>` semantics.

## Install

```bash
pnpm add @lamstack/react-dialog
```

## Usage

```tsx
import { DialogsProvider, useDialogs } from '@lamstack/react-dialog';
import type { DialogTemplates } from '@lamstack/react-dialog';

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

Full docs, live demos (Tailwind CSS / MUI / shadcn-ui), and API reference:
**[lamstack-docs.vercel.app/dialog](https://lamstack-docs.vercel.app/dialog)**

## Credits

This is a headless extraction and adaptation of
[MUI Toolpad Core's `useDialogs`](https://mui.com/toolpad/core/react-use-dialogs/) —
same `open`/`close`/`alert`/`confirm`/`prompt` shape and `onClose` semantics, and the
dialog stack management in `dialog.provider.tsx` is derived from Toolpad Core's
`DialogsProvider`, ported out from under MUI so this package has no MUI dependency. All
credit for the original design goes to the Toolpad team — see [`NOTICE`](./NOTICE) for
the required MIT attribution.

## License

MIT
