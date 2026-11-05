# Contributing to stateward

Thank you for helping.

## Report a wrong or missed finding

[Open an issue](https://github.com/khoing1111/ts-stateward/issues) with the finding as stateward
printed it (or the case it missed), the stateward version (`npx stateward --version`), and the
smallest code that shows it. For a security problem, follow [SECURITY.md](SECURITY.md) instead.

## Set up

You need Node 20 or newer and pnpm 10.

```bash
corepack enable
```

```bash
pnpm install
```

```bash
pnpm run gate
```

The gate runs every check, one line each: prettier, eslint, the TypeScript build, the generated
docs, the tests, the VS Code extension bundle, a smoke test of the language server, and stateward
on its own source. A change is ready when it passes.

- `pnpm run docs` regenerates `docs/packs/` and `docs/rules/` from the plugins. Run it after
  changing a rule's text; the gate fails when they are stale.
- `pnpm test` builds and runs the tests.

## Layout

```text
packages/
  core/                  engine, plugin contract, TypeQueries backend (one file), testing helper
  cli/                   the stateward command
  language-server/       LSP server
  vscode/                VS Code extension client
  plugin-*/              the rule packs, each with fixtures
examples/basic/          a small app the CLI tests run against
docs/                    user guides, generated rule and pack pages
scripts/                 the gate, the docs generator, packaging
```

[docs/architecture.md](docs/architecture.md) explains how the parts fit together, and
[docs/user/write-your-own-rule.md](docs/user/write-your-own-rule.md) how a rule is written and
tested.

## Architecture rules

- **SW1.** Only the backend file in core calls the TypeScript type checker. Rules use `TypeQueries`.
- **SW2.** Core knows no library (React or otherwise). Library knowledge lives in a plugin.
- **SW3.** Plugins reach stateward only through `@stateward/core`'s public API.
- **SW4.** A rule that cannot decide reports an `unknown` finding; it never passes silently.
- **SW5.** Findings are deterministic: same input, same findings, same order.
- **SW6.** No new syntax. Everything stateward reads is valid TypeScript.

## Try your build in an app

```bash
pnpm run pack
```

This writes the packages and the VS Code extension (`.vsix`) into `artifacts/`. Install them into
an app, on a branch of the app, since its `package.json` and lockfile will point into your clone:

```bash
pnpm run install-into ~/code/my-app
```

It uses the app's package manager. Install the extension with
`code --install-extension artifacts/stateward-vscode-*.vsix`, or press F5 in this repository to run
it in a development host.

## Pull requests

- Add a test that fails without your change.
- `pnpm run gate` passes.
- Keep the change to one thing, and say in the description what it fixes and why.
