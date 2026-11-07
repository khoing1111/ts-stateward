# stateward

stateward checks TypeScript and React code for invalid states and unpredictable code paths. It
reports code that allows states the app does not handle, such as a `default` that hides a new
status, a lookup that can miss a key, or an error that no code handles. Each finding says what can
happen and suggests the type or change that rules the state out, so that the intent is stated in
types instead of in a runtime check. It runs in the terminal, in CI and in VS Code, on ordinary
TypeScript.

## Contents

- [Install](#install)
- [Commands](#commands)
- [Packs](#packs)
- [Docs](#docs)

## Install

In your app's folder (Node 20 or newer):

```bash
npm install --save-dev stateward
```

```bash
npx stateward init
```

```bash
npx stateward check
```

`init` asks which rule packs to use (the ones that fit your `package.json` are ticked), writes
`stateward.config.ts`, and prints the install line for the packs. `check` lists the problems, each
with the change to make:

```text
error[unions/default-hides-cases]: "failed" of `status` is not listed; `default` handles it
 --> src/status.ts:9:5
  = fix: list the case, then put `status satisfies never;` in the `default`; or name it in the `default` instead, if that is where it belongs:
        default: status satisfies "failed";
  = docs: stateward explain unions/default-hides-cases
```

## Commands

`npx stateward <command> --help` shows a command's options.

<!-- generated:commands -->

| Command | What it does |
| --- | --- |
| `stateward check` | List the problems in your code, each with the change to make. Exit code: 0 when there is no error, 1 when there is an error (or more warnings than --max-warnings), 2 when stateward could not run, or a rule failed. |
| `stateward baseline` | Accept the problems you have today, so that from now on only new ones fail `check`. |
| `stateward plan` | Show every rule with how many places it flags in your code, in the order to turn them on. |
| `stateward next` | Turn on the next rule and say how many places it flags. Waits while the last rule you turned on still has problems. |
| `stateward coverage` | Show, per pack, the code stateward cannot check yet, and the change that would let it. |
| `stateward init` | Set up stateward in your project: write stateward.config.ts and print what to install. Asks a few questions; never overwrites a config. |
| `stateward explain` | Explain a rule: why it matters, what it flags and how to fix it. |
| `stateward deps` | Show the library functions your code calls and whether stateward knows what they throw (with the errors pack). |
| `stateward guarantees` | List the guarantees your code states (a `RequiredContext`, an `Owned` value), where each is declared, whether stateward proves it, and the readers or writers it covers; a marker nothing uses is listed as unused. Exit code: 0 when every guarantee is proven, unused or not checked, 1 when one is not proven, 2 when stateward could not run. |
| `stateward cache` | Show the size of, or delete, stateward's caches: what libraries throw, shared by all your projects (at most 200 MB, or STATEWARD_PACKAGE_CACHE_MAX_MB), and this project's earlier results (at most 200 MB, or STATEWARD_CACHE_MAX_MB). Past its limit, a cache drops what was used longest ago. |

<!-- /generated:commands -->

## Packs

Rules come in packs, each its own package. Install the ones you use and list them in `plugins`.

<!-- generated:packs -->

| Pack | What it promises | Package | Rules |
| --- | --- | --- | --- |
| [unions](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/unions.md) | Every case of a union is handled, and its tag tells the cases apart. | `@stateward/plugin-unions` | 3 |
| [records](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/records.md) | Lookup tables and records keyed by a union have every key, once, under a type that names them. | `@stateward/plugin-records` | 3 |
| [async](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/async.md) | An async failure is never lost: handlers catch their own, and state set before an await is set again when it fails. | `@stateward/plugin-async` | 2 |
| [react-context](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/react-context.md) | A component that needs a context is always rendered under its Provider. | `@stateward/plugin-react-context` | 2 |
| [errors](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/errors.md) | Errors are handled where they can happen: none ignored, none replaced in `finally`, no `Result` dropped. | `@stateward/plugin-errors` | 9 |
| [ownership](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/ownership.md) | One owner per piece of shared state and per brand: others call the owner's functions. | `@stateward/plugin-ownership` | 2 |
| [reducers](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/reducers.md) | A reducer reaches every state it declares and can leave every state it enters. | `@stateward/plugin-reducers` | 3 |
| [react](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/react.md) | Values that effects and memoized components depend on keep their identity; effects do not copy state, loop, leak or race; state updates see the latest state; flags do not stand in for one state. | `@stateward/plugin-react` | 10 |

<!-- /generated:packs -->

## Docs

- [Quick start](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/quick-start.md): install, check, read a finding.
- [Every rule](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md), with what it finds and its severity.
- [Work through the findings](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/work-through-findings.md): one rule at a time, baseline, `--fix`, ignore comments.
- [Best practices](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/best-practices.md): adopting it on an existing app, which guarantees to state, ignores, CI with `--changed`, "not checked".
- [Guarantees](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/guarantees.md): state a property in a type (`RequiredContext`, `Owned`, an `AbortSignal`) and stateward proves it.
- [Upgrading](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/upgrading.md): what to change from 1.0 to 1.1.
- [The config file](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md): every key.
- [Run it in CI](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/ci.md) and [before each commit](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/pre-commit.md).
- [Install](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/install.md): yarn, pnpm, bun, the VS Code extension, and what to do if it goes wrong.
- [Write a rule of your own](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/write-your-own-rule.md).
- [The project on GitHub](https://github.com/khoing1111/ts-stateward#readme).
