# Publishing to npm

This repo can be published as an npm package.

## Pre-flight checklist

1. Confirm the package name is available.
   - Current name: `aslx`
   - If it’s taken, switch to a scoped name like `@your-org/aslx`.

2. Ensure you can build the distributable output:

```bash
npm install
npm run build
```

> Tip: if you commit a `package-lock.json`, you can (and should) switch to `npm ci` for reproducible installs.

3. Dry-run the package contents:

```bash
npm pack --dry-run
```

The published contents are restricted to `dist/`, `docs/`, `README.md`, and `LICENSE` via the `files` field in `package.json`.

## Publish

### Manual publish

```bash
npm login
npm publish --access public
```

### GitHub Actions (release workflow)

This repo includes a `release.yml` workflow that publishes on tags.

1. Set a repository secret: `NPM_TOKEN`
2. Create and push a tag:

```bash
git tag v0.1.0
git push --tags
```

## CLI commands

When installed globally (or via `npx`), the recommended entrypoint is:

- `aslx`

You can list available commands with:

```bash
aslx --help
```

Available subcommands (recommended short forms):

- `aslx compile` (aliases: `compile-jsonata`, `slots`)
- `aslx build` (alias: `build-machine`)
- `aslx validate` (aliases: `validate-machine`, `check`)
- `aslx yml` (aliases: `build-yml`, `yaml`)

Each subcommand supports `--help`:

```bash
aslx build --help
```

Legacy binaries are still published (useful for scripts), but `aslx` is preferred:

- `aslx-compile-jsonata`
- `aslx-build-machine`
- `aslx-validate-machine`
- `aslx-build-yml`

