# stateward

**Exclusive states and predictable code paths for TypeScript and React.**

Most bugs are states nobody planned for: loading and error both true, a new status that falls into
a `default`, an error nobody catches. The code compiles and the types pass. stateward shows where
your code allows those states, and how to say what you mean in a type instead of leaving it to
guesswork or a runtime check. You get the context and the fix; you decide. In VS Code as you type,
in the terminal or in CI.

```ts
type Status = "idle" | "uploading" | "failed";

function statusLabel(status: Status): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "uploading":
      return "Uploading";
    default:
      return "Unknown";
  }
}
```

```text
error[unions/default-hides-cases]: this `default` hides 1 case of `status`: "failed"
 --> src/status.ts:9:5
  = fix: list the case, then put `status satisfies never;` in the `default`, or if the `default` is right for it, say so:
        default: status satisfies "failed";
```

Today `"failed"` shows "Unknown". Tomorrow someone adds `"paused"` and it does too, silently.
List the case and write `status satisfies never;` in the `default`, and the next new status is a
type error until it is handled. If the `default` really is right, `status satisfies "failed"`
says so, and stateward takes your word for it.

## Principles

- **Exclusive states.** A value is in one state at a time: a union, not flags that can contradict
  each other. Where your types allow a state your app never means, stateward points at it and shows
  the type that rules it out.
- **Predictable code paths.** With exclusive states, every case is handled in one clear place: you
  can read the code and know what happens next.
- **Your intent, in types.** Say what you mean in a type (a union, `satisfies`, `value satisfies
  never`) and the compiler holds the code to it: no guessing, no runtime check. stateward trusts
  what a type states; when the intent is unclear, it asks, with a fix for each reading.
- **Context to decide.** Each finding says what is wrong, why, and the change to make, with your own
  names. You decide.
- **Early and honest.** As you type, before commit, in CI. The TypeScript you already write, no new
  syntax, nothing on until you choose it; what it cannot decide is shown as "not checked", never
  passed silently.

## Try it

In your app's folder (Node 20 or newer; npm, yarn, pnpm or bun):

```bash
npm install --save-dev stateward
```

```bash
npx stateward init
```

```bash
npx stateward check
```

`init` asks which packs to use (the ones that fit your `package.json` are already ticked), writes
`stateward.config.ts`, and prints the install line for the packs it picked. `check` lists the
problems, each with the change to make. Then install the VS Code extension: search for
"Stateward" in the Extensions view.

[docs/user/quick-start.md](docs/user/quick-start.md) takes about five minutes. Then:

- [Work through the findings one rule at a time](docs/user/work-through-findings.md), and see them in VS Code.
- [Install it in your app](docs/user/install.md): every way, with the VS Code extension.
- [Run it in CI](docs/user/ci.md): findings on every pull request, from one workflow file.
- [Before each commit](docs/user/pre-commit.md): check the staged files with a pre-commit hook.
- [The config file](docs/user/config.md): every key, with an example, and settings per folder.
- [Write a rule of your own](docs/user/write-your-own-rule.md) for a convention your team keeps.
- [What changed](CHANGELOG.md).

## What it helps with

Rules come in packs. Turn on the ones that fit your app; each pack's page is in
[docs/packs/](docs/packs/).

| Pack | What it helps with |
| --- | --- |
| `unions` | A `switch` or an `if` chain that misses a case of a union, today or after someone adds one, and a tag that cannot tell the cases apart |
| `records` | A lookup like `labels[status]` that misses a key, a table typed too loosely to be checked, a key written twice, maps keyed alike that drift apart |
| `async` | A pending flag left set when the awaited call fails, and an async handler whose failure nobody waits for |
| `errors` | Errors that are swallowed or caught too broadly, lost in `finally`, or a `Result` that gets ignored |
| `ownership` | Module-level state that several files change instead of one, and a brand (`OrderId`) built outside its owner |
| `reducers` | A reducer with a state you can never reach, or one you can never leave |
| `react-context` | A context with a fake default (`createContext({} as Theme)`), or a component rendered outside its Provider |
| `react` | Effects and `memo` components that rerun on every render because a hook returns a new function or object each time, and flags that allow impossible combinations |

## How well it works

On eight open-source projects, every default rule was right at least 86% of the time it could be
judged, and a first check took 0.9 to 1.5 times as long as `tsc --noEmit`:
[docs/user/real-world-results.md](docs/user/real-world-results.md).

It works on macOS, Linux and Windows, with any TypeScript version in your app (it brings its own
for reading). A finding you think is wrong is a bug: please
[open an issue](https://github.com/khoing1111/ts-stateward/issues) with the finding as printed and
the smallest code that causes it.

## How it relates to ESLint

typescript-eslint checks one function at a time and has a few exhaustiveness rules
(`switch-exhaustiveness-check`). stateward follows types and values across files and the whole
project (which Provider is above a component, which errors a call can throw, which file writes a
shared value) and asks about intent where a lint rule would have to guess. Use both: stateward
leaves out what typescript-eslint already checks well.

## For contributors

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT, see [LICENSE](LICENSE). The VS Code extension lists the licences of what it bundles in
`THIRD-PARTY-NOTICES.txt`.
