# omnireact

A collection of independent, headless React packages. MIT licensed. Each package is
installable on its own and only depends on `@omnireact/core` (shared utilities) — never
on a sibling feature package.

📖 **Docs, live demos, and API reference: [omnireact-six.vercel.app](https://omnireact-six.vercel.app)**

```bash
pnpm add @omnireact/dialog
# or: npm install @omnireact/dialog
# or: yarn add @omnireact/dialog
# or: bun add @omnireact/dialog
```

## Packages

| Package                                            | Description                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`@omnireact/core`](./packages/core)               | Shared internal-ish hooks other `@omnireact/*` packages build on. Usable standalone.                                            |
| [`@omnireact/dialog`](./packages/dialog)           | Headless, imperative dialog API (`useDialogs()` → `open`/`close`/`alert`/`confirm`/`prompt`).                                   |
| [`@omnireact/initializer`](./packages/initializer) | Headless app-startup orchestrator (`<Initializer>` runs async init steps, with parallel batching, retry, splash/error screens). |

More packages (data, ...) are planned.

## Credits

`@omnireact/dialog` is a headless extraction and adaptation of
[MUI Toolpad Core's `useDialogs`](https://mui.com/toolpad/core/react-use-dialogs/) — same
shape and semantics, ported out from under MUI so it has no MUI dependency. All credit for
the original design goes to the Toolpad team — see
[`packages/dialog/NOTICE`](./packages/dialog/NOTICE) for the required MIT attribution.

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## License

MIT
