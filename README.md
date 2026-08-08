# omnireact

A collection of independent, headless React packages. MIT licensed. Each package is
installable on its own and only depends on `@omnireact/core` (shared utilities) — never
on a sibling feature package.

```bash
pnpm add @omnireact/dialog
```

## Packages

| Package                                  | Description                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`@omnireact/core`](./packages/core)     | Shared internal-ish hooks other `@omnireact/*` packages build on. Usable standalone.          |
| [`@omnireact/dialog`](./packages/dialog) | Headless, imperative dialog API (`useDialogs()` → `open`/`close`/`alert`/`confirm`/`prompt`). |

More packages (initializer, data, ...) are planned.

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## License

MIT
