# lamstack

A collection of independent, headless packages — mostly React, with framework-agnostic
cores where a feature's logic doesn't need a framework at all — published under the
single `@lamstack` npm scope. MIT licensed. Each package is installable on its own; a
feature package depends on at most one shared core (`@lamstack/react-core` or
`@lamstack/initializer`), never on a sibling feature package.

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

| Package                                                       | Description                                                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@lamstack/react-core`](./packages/react-core)               | Shared internal-ish hooks other `@lamstack/react-*` packages build on. Usable standalone.                                                                                 |
| [`@lamstack/react-dialog`](./packages/react-dialog)           | Headless, imperative dialog API (`useDialogs()` → `open`/`close`/`alert`/`confirm`/`prompt`).                                                                             |
| [`@lamstack/initializer`](./packages/initializer)             | Framework-agnostic app-startup orchestrator core (`createInitializer`, `parallel`, task/state types). No React dependency.                                                |
| [`@lamstack/react-initializer`](./packages/react-initializer) | React adapter for `@lamstack/initializer` (`<Initializer>`, `useInitializer()`, splash/error screens), re-exporting the whole core API from one import.                   |
| [`@lamstack/http-client`](./packages/http-client)             | Framework-agnostic HTTP client core with a pluggable middleware pipeline (`auth`/`recover`/`errorMapper` plugins) and fetch/axios adapters. No hard dependency on either. |

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
