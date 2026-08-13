# lamstack

A collection of independent, headless React packages, published under the single
`@lamstack` npm scope. MIT licensed. Each package is installable on its own and only
depends on `@lamstack/react-core` (shared utilities) — never on a sibling feature package.

📖 **Docs, live demos, and API reference: [omnireact-six.vercel.app](https://omnireact-six.vercel.app)**

```bash
pnpm add @lamstack/react-dialog
# or: npm install @lamstack/react-dialog
# or: yarn add @lamstack/react-dialog
# or: bun add @lamstack/react-dialog
```

> Renamed from `omnireact`/`@omnireact/*` — see [`MIGRATION.md`](./MIGRATION.md) if you're
> upgrading from an `@omnireact/*` package.

## Packages

| Package | Description |
| --- | --- |
| [`@lamstack/react-core`](./packages/react-core) | Shared internal-ish hooks other `@lamstack/react-*` packages build on. Usable standalone. |
| [`@lamstack/react-dialog`](./packages/react-dialog) | Headless, imperative dialog API (`useDialogs()` → `open`/`close`/`alert`/`confirm`/`prompt`). |
| [`@lamstack/react-initializer`](./packages/react-initializer) | Headless app-startup orchestrator (`<Initializer>` runs async init steps, with parallel batching, retry, splash/error screens). |

More packages (data, non-React targets, ...) are planned, following the same
`@lamstack/<target>-<domain>` naming pattern — no new scopes.

## Credits

`@lamstack/react-dialog` is a headless extraction and adaptation of
[MUI Toolpad Core's `useDialogs`](https://mui.com/toolpad/core/react-use-dialogs/) — same
shape and semantics, ported out from under MUI so it has no MUI dependency. All credit for
the original design goes to the Toolpad team — see
[`packages/react-dialog/NOTICE`](./packages/react-dialog/NOTICE) for the required MIT
attribution.

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## License

MIT
