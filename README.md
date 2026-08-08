# omnireact

A collection of independent, headless React packages. MIT licensed. Each package is
installable on its own and only depends on `@omnireact/core` (shared utilities) — never
on a sibling feature package.

```bash
pnpm add @omnireact/dialog
# or: npm install @omnireact/dialog
# or: yarn add @omnireact/dialog
# or: bun add @omnireact/dialog
```

## Packages

| Package                                  | Description                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`@omnireact/core`](./packages/core)     | Shared internal-ish hooks other `@omnireact/*` packages build on. Usable standalone.          |
| [`@omnireact/dialog`](./packages/dialog) | Headless, imperative dialog API (`useDialogs()` → `open`/`close`/`alert`/`confirm`/`prompt`). |

More packages (initializer, data, ...) are planned.

## Credits

`@omnireact/dialog`'s API is a headless extraction of
[MUI Toolpad Core's `useDialogs`](https://mui.com/toolpad/core/react-use-dialogs/) — same
shape and semantics, ported out from under MUI so it has no MUI dependency. All credit for
the original design goes to the Toolpad team.

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## License

MIT
