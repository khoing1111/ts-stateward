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

## Contents

- [Principles](#principles)
- [Try it](#try-it)
- [Using it](#using-it)
- [A minimal config](#a-minimal-config)
- [Packs](#packs)
- [Rules](#rules)
- [How well it works](#how-well-it-works)
- [How it relates to ESLint](#how-it-relates-to-eslint)
- [For contributors](#for-contributors)
- [Licence](#licence)

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

Then install the VS Code extension (search "Stateward"). The
[quick start](docs/user/quick-start.md) takes about five minutes; [Using it](#using-it) walks
through every step.

## Using it

The flow from install to CI, a few lines each. Every command takes `--help`.

1. **Install.** `npm install --save-dev stateward` (or yarn, pnpm, bun):
   [install.md](docs/user/install.md).
2. **Set up.** `npx stateward init` asks which packs to use, writes `stateward.config.ts`, and
   prints the install line for the packs. `--yes` takes the suggested answers;
   `--packs unions,records` and `--preset strict` choose for you.
   [quick-start.md](docs/user/quick-start.md).
3. **Check.** `npx stateward check` lists the problems. In a big app, `npx stateward plan` shows
   how many places each rule flags, and with `rollout: true` in the config, `npx stateward next`
   turns the rules on one at a time. `check --rule <rule>` or `--group <group>` looks at one.
   [work-through-findings.md](docs/user/work-through-findings.md).
4. **Read a finding.** The first line is the severity, the rule and what is wrong; then the file,
   line and column; then `= fix:` with the change to make in your names, and `= docs:` with the
   command that explains the rule (`npx stateward explain <rule>`, the same text as the rule's page
   below). Places stateward could not decide are counted as "not checked", never passed silently;
   `check --verbose` or `npx stateward coverage` lists them.
   [quick-start.md](docs/user/quick-start.md#read-a-finding).
5. **Fix.** In VS Code, the lightbulb offers the fixes; each is tried on a copy of your code first.
   `npx stateward check --fix` applies the ones that cannot change how the code runs;
   `--fix --dry-run` shows them as a diff first.
   [work-through-findings.md](docs/user/work-through-findings.md#fix-in-bulk).
6. **VS Code.** Search for "Stateward" in the Extensions view. Findings show as you type, with
   quick fixes and hints about the errors a function can throw.
   [The extension's page](packages/vscode/README.md).
7. **CI.** `npx stateward init --ci github` writes `.github/workflows/stateward.yml`; add
   `--changed` to report only the files a pull request changes. `check --format github` annotates
   the pull request. [ci.md](docs/user/ci.md). Before each commit: `init --hook`,
   [pre-commit.md](docs/user/pre-commit.md).
8. **Existing code.** `npx stateward baseline` accepts today's problems, so only new ones fail
   `check`; `baseline --prune` drops the ones you fixed. `next --baseline` turns on the next rule
   and accepts its problems in one step.
   [work-through-findings.md](docs/user/work-through-findings.md#accept-what-is-there-today).
9. **Ignore one case**, as a last resort, when the code is meant to be that way: a comment above
   the line with the rule and why,
   `// stateward-ignore records/lookup-misses-key: keys come from the server's fixed list`.
   [work-through-findings.md](docs/user/work-through-findings.md#ignore-one-case).

Also: [write a rule of your own](docs/user/write-your-own-rule.md) for a convention your team
keeps, and [what changed](CHANGELOG.md).

## A minimal config

```ts
// stateward.config.ts
import { defineConfig, defaults } from "stateward";
import { unions } from "@stateward/plugin-unions";
import { records } from "@stateward/plugin-records";

export default defineConfig({
  plugins: [unions(), records()],
  preset: "recommended", // or "strict"; without a preset no rule is on
  rules: { "records/lookup-misses-key": "warning" }, // one rule's severity, or [severity, options]
  groups: { "unions/cases": "error" }, // every rule of a group
  addons: ["records/keyed-maps"], // rules a pack keeps off until you ask
  exclude: [...defaults.exclude, "src/generated/**"], // keep the default skips (tests, stories)
});
```

Every key, settings per folder, and monorepos: [config.md](docs/user/config.md).

## Packs

Rules come in packs, each its own package. Turn on the ones that fit your app.

<!-- generated:packs -->

| Pack | What it promises | Package | Rules |
| --- | --- | --- | --- |
| [unions](docs/packs/unions.md) | Every case of a union is handled, and its tag tells the cases apart. | `@stateward/plugin-unions` | 3 |
| [records](docs/packs/records.md) | Lookup tables and records keyed by a union have every key, once, under a type that names them. | `@stateward/plugin-records` | 4 |
| [async](docs/packs/async.md) | An async failure is never lost: handlers catch their own, and state set before an await is set again when it fails. | `@stateward/plugin-async` | 2 |
| [react-context](docs/packs/react-context.md) | A component that needs a context is always rendered under its Provider. | `@stateward/plugin-react-context` | 2 |
| [errors](docs/packs/errors.md) | Errors are handled where they can happen: nothing swallowed, nothing lost in finally, no Result dropped. | `@stateward/plugin-errors` | 10 |
| [ownership](docs/packs/ownership.md) | One owner per piece of shared state and per brand: others call the owner's functions. | `@stateward/plugin-ownership` | 2 |
| [reducers](docs/packs/reducers.md) | A reducer reaches every state it declares and can leave every state it enters. | `@stateward/plugin-reducers` | 3 |
| [react](docs/packs/react.md) | Values that effects and memoized components depend on keep their identity; effects do not copy state, loop, leak or race; state updates see the latest state; flags do not stand in for one state. | `@stateward/plugin-react` | 11 |

<!-- /generated:packs -->

## Rules

Each rule links to its page: why it matters, what it catches and what it does not, how to fix what
it finds, and its options. The same tables, as one page: [docs/rules/README.md](docs/rules/README.md).

<!-- generated:rules -->

Kind: **Core** rules are on in every preset. **Coverage** rules ask your types to say more; they
are info under `recommended` and errors under `strict`. **Add-on** rules stay off until you list
their add-on in `addons`; the table shows their severity once it is listed. A heuristic rule
guesses, so it is never an error unless you set it.

### [unions](docs/packs/unions.md)

Every case of a union is handled, and its tag tells the cases apart. Package: `@stateward/plugin-unions`.

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [default-hides-cases](docs/rules/unions/default-hides-cases.md) | A switch over a union handles every case, so a value added later fails to compile instead of falling into the default. | Core | error | error |
| [if-chain-misses-case](docs/rules/unions/if-chain-misses-case.md) | An if / else if chain over a union handles every case, so a value added later fails to compile. | Core | error | error |
| [tag-does-not-discriminate](docs/rules/unions/tag-does-not-discriminate.md) | A property like kind that tells a union's members apart is a literal in every member, not string or number in one. | Coverage | info | error |

### [records](docs/packs/records.md)

Lookup tables and records keyed by a union have every key, once, under a type that names them. Package: `@stateward/plugin-records`.

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [duplicate-key](docs/rules/records/duplicate-key.md) | A new Map([...]) or new Set([...]) written out in code has the same key twice, so the second replaces the first. | Core | error | error |
| [lookup-misses-key](docs/rules/records/lookup-misses-key.md) | A lookup like labels[status] has an entry for every value of the key, or handles a missing one. | Core | error | error |
| [table-type-too-loose](docs/rules/records/table-type-too-loose.md) | A lookup table typed `Record<string, V>` says neither "these are all the keys" nor "keys come from outside"; say which in its type. | Core | error | error |
| [keyed-maps-out-of-sync](docs/rules/records/keyed-maps-out-of-sync.md) | Two records kept in step must lose a key together: a key removed from one and forgotten in the other is reported. (heuristic) | Add-on `keyed-maps` | warning | warning |

### [async](docs/packs/async.md)

An async failure is never lost: handlers catch their own, and state set before an await is set again when it fails. Package: `@stateward/plugin-async`.

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [handler-rejection-lost](docs/rules/async/handler-rejection-lost.md) | An async event handler, listener or timer callback catches its own failures, since nothing awaits it. | Core | error | error |
| [pending-state-stuck-on-failure](docs/rules/async/pending-state-stuck-on-failure.md) | State set before an await and set again after it is also set again when the await fails, so a failure does not leave it pending. (heuristic) | Core | warning | warning |

### [react-context](docs/packs/react-context.md)

A component that needs a context is always rendered under its Provider. Package: `@stateward/plugin-react-context`.

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [fake-default-value](docs/rules/react-context/fake-default-value.md) | A React context gets its value from a Provider, not from a fake default like {} as Theme. | Coverage | info | error |
| [provider-missing](docs/rules/react-context/provider-missing.md) | A component that reads a required context is rendered under that context's Provider. | Core | error | error |

### [errors](docs/packs/errors.md)

Errors are handled where they can happen: nothing swallowed, nothing lost in finally, no Result dropped. Package: `@stateward/plugin-errors`.

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [must-handle-error](docs/rules/errors/must-handle-error.md) | An error class marked @mustHandle is named in a catch or passed on with @throws by every call that can throw it. | Core | error | error |
| [result-ignored](docs/rules/errors/result-ignored.md) | The Result of a call is checked or passed on, not dropped as a statement, after void or after await. | Core | error | error |
| [result-unchecked](docs/rules/errors/result-unchecked.md) | A call that reports failure in its value, not by throwing, is checked before the code goes on as if it worked. (heuristic) | Core | warning | warning |
| [throws-doc-mismatch](docs/rules/errors/throws-doc-mismatch.md) | A function's @throws tag lists exactly the error classes it can throw, as far as stateward can see. | Core | error | error |
| [catch-hides-unexpected](docs/rules/errors/catch-hides-unexpected.md) | A catch that handles some errors with instanceof also rethrows or handles all the others. | Core | error | error |
| [catch-misses-error](docs/rules/errors/catch-misses-error.md) | A catch that branches with instanceof handles every error class its try can throw, or rethrows the rest; so does an error boundary's fallback. | Core | error | error |
| [finally-can-throw](docs/rules/errors/finally-can-throw.md) | A finally block does not call something that throws, so the error that led to it is not lost. | Core | error | error |
| [catch-without-intent](docs/rules/errors/catch-without-intent.md) | Experimental: on real projects it is mostly wrong; it may change or be removed. A catch that handles every error says how: it narrows, reports, or falls back; one that only logs, or calls something stateward cannot judge, and carries on is reported. (heuristic) | Add-on `catch-intent` | warning | warning |
| [narrow-try](docs/rules/errors/narrow-try.md) | Calls to your own code placed in a `try` after the call it is for: move them after the `try`. | Add-on `narrow-try` | warning | warning |
| [render-throw-without-boundary](docs/rules/errors/render-throw-without-boundary.md) | A component that can throw a known error while rendering has an error boundary above it. | Core | warning | warning |

### [ownership](docs/packs/ownership.md)

One owner per piece of shared state and per brand: others call the owner's functions. Package: `@stateward/plugin-ownership`.

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [brand-built-outside-owner](docs/rules/ownership/brand-built-outside-owner.md) | A branded value that has a check is built only by that check, in the file that declares the brand. | Core | error | error |
| [state-written-outside-owner](docs/rules/ownership/state-written-outside-owner.md) | Shared module-level state is changed only by the module that declares it; others call its functions. | Core | error | error |

### [reducers](docs/packs/reducers.md)

A reducer reaches every state it declares and can leave every state it enters. Package: `@stateward/plugin-reducers`.

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [state-cannot-leave](docs/rules/reducers/state-cannot-leave.md) | A state a reducer reaches but never leaves is marked final, so a missing way out does not go unnoticed. | Core | warning | warning |
| [state-unreachable](docs/rules/reducers/state-unreachable.md) | A state of a reducer that no event can lead to. | Core | error | error |
| [reducer-not-readable](docs/rules/reducers/reducer-not-readable.md) | A place in or around a reducer that stateward cannot read, so its other reducer checks cannot cover it. | Coverage | info | error |

### [react](docs/packs/react.md)

Values that effects and memoized components depend on keep their identity; effects do not copy state, loop, leak or race; state updates see the latest state; flags do not stand in for one state. Package: `@stateward/plugin-react`.

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [effect-copies-derived-value](docs/rules/react/effect-copies-derived-value.md) | A value computed from props or state is computed while rendering, not copied into state by an effect. | Core | warning | warning |
| [effect-loops](docs/rules/react/effect-loops.md) | An effect does not set, every time it runs, a state it depends on to a new value: that is a render loop. | Core | error | error |
| [effect-missing-cleanup](docs/rules/react/effect-missing-cleanup.md) | An effect that starts a listener, timer, subscription, observer or connection returns a cleanup that stops it. | Core | warning | warning |
| [timer-runs-after-unmount](docs/rules/react/timer-runs-after-unmount.md) | A timer a component keeps in a ref is cleared when the component unmounts, so it cannot run after the component is gone. | Core | warning | warning |
| [effect-response-race](docs/rules/react/effect-response-race.md) | An effect that loads data ignores a response that arrives after its inputs have changed. (heuristic) | Add-on `effect-race` | warning | warning |
| [dependency-changes-every-render](docs/rules/react/dependency-changes-every-render.md) | A dependency of an effect, `useMemo` or `useCallback`, or a prop of a `memo` component, is not a new value that a custom hook creates on every render. | Core | warning | warning |
| [index-key-on-reordered-list](docs/rules/react/index-key-on-reordered-list.md) | A list that is filtered, sorted, reversed, spliced or added to at the front is not keyed by the position of its rows. (heuristic) | Core | warning | warning |
| [provider-value-changes-every-render](docs/rules/react/provider-value-changes-every-render.md) | A context Provider is not given a value created anew on every render. | Core | warning | warning |
| [closure-reads-stale-state](docs/rules/react/closure-reads-stale-state.md) | A state setter called from a timer, a listener or a callback that outlives its render passes an updater function, not a value computed from the state. | Core | warning | warning |
| [state-copies-prop](docs/rules/react/state-copies-prop.md) | A state is not a copy of a prop that an effect keeps in step: one value, one owner. | Core | warning | warning |
| [flags-allow-impossible-combos](docs/rules/react/flags-allow-impossible-combos.md) | Boolean or nullable useState values that are read or set together become one state, so combinations that make no sense cannot happen. (heuristic) | Add-on `flag-combos` | warning | warning |

<!-- /generated:rules -->

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
