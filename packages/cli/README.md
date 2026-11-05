# stateward

Exclusive states and predictable code paths for TypeScript and React. stateward shows where your code allows
states your app never means (a `default` that hides a new status, a lookup missing a key, an error
nobody handles), explains what can happen, and suggests the type or change that rules them out. In
the terminal, in CI and in VS Code, on the TypeScript you already write.

```bash
npm install --save-dev stateward
```

```bash
npx stateward init
```

```bash
npx stateward check
```

`init` picks the rule packs that fit your app and writes `stateward.config.ts`; `check` lists the
problems. `npx stateward --help` lists every command.

Docs, the rule packs and the VS Code extension:
[github.com/khoing1111/ts-stateward](https://github.com/khoing1111/ts-stateward#readme).
