# @stateward/language-server

The language server behind the Stateward VS Code extension: [stateward](https://github.com/khoing1111/ts-stateward#readme)'s
findings as you type, quick fixes, and hints about the errors a function can throw, for any editor
that speaks the Language Server Protocol.

```bash
npm install --save-dev @stateward/language-server
```

Start it with `npx stateward-language-server`. It talks over stdin and stdout and checks the
project of the nearest `stateward.config.ts`. The VS Code extension uses the copy installed in your
project, else its own.

## What you see

- Findings as diagnostics, as you type, with the rule id and the change to make.
- Quick fixes, each tried on a copy of your code first: one that would not compile is not offered.
  "Ignore this case here" writes a `// stateward-ignore` comment with the rule.
- Inlay hints after a function's signature with the errors it can throw (`throws NotFoundError`),
  and after a `catch` variable with the errors its `try` can throw (with the errors pack).
- Places stateward could not check, as faint hints; baselined findings, faintly.

## Docs

- [Every rule](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md), with
  what it finds and its severity.
- [The config file](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).
- [The VS Code extension](https://github.com/khoing1111/ts-stateward/blob/main/packages/vscode/README.md).
