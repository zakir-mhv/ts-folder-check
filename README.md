# ts-folder-check

Scoped TypeScript error checker. Type-checks only the specified folder(s) instead of the whole project, so it runs much faster than a full `tsc --noEmit` on a large codebase or monorepo.

## Install

```sh
# bun
bun add -d ts-folder-check

# npm
npm install -D ts-folder-check
```

`typescript` (>= 5.0) is a peer dependency — the checker uses the TypeScript version already installed in your project.

## Usage

Run from the project root (where your `tsconfig.json` lives), passing one or more folder paths relative to the root:

```sh
ts-folder-check <folder> [folder2]... [--include <dir[,dir2]>]
```

Examples:

```sh
bunx ts-folder-check <relative-folder-path>

# multiple folders
bunx ts-folder-check <relative-folder-path> <relative-folder-path>

# project has global .d.ts files (e.g. vite-env.d.ts) outside the target folders
bunx ts-folder-check <relative-folder-path> --include types
```

Or as a package.json script:

```json
{
  "scripts": {
    "ts-folder-check": "ts-folder-check --include types"
  }
}
```

```sh
bun ts-folder-check <folder>

# with npm, extra arguments need "--"
npm run ts-folder-check -- <folder>
```

### Options

| Option            | Description                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `--include <dir>` | Extra folder(s) with global `.d.ts` files that must be loaded but not type-checked. Comma-separated list. |

## What it does

- Uses the TypeScript Compiler API directly (no `bunx`/`npx` spawning, so no Windows/shell issues).
- Reads the nearest `tsconfig.json`, so path aliases resolve correctly.
- Type-checks only the files inside the target folder(s); imported files are parsed for types but not deeply checked (10x+ faster on a large project).
- Caches results incrementally in `.tscheck/` — repeated runs on the same folder are faster. Add `.tscheck/` to your `.gitignore`.
- Exits with code `1` if errors are found, `0` otherwise. Config or path problems are reported clearly, never hidden.

## License

MIT
