# Changelog

## 1.1.0 (2026-11-07)

- **State that a context is required, and stateward proves it.** A context typed
  `RequiredContext<T>` (made with `requiredContext<T>()` from your own `src/guarantees.ts`) is
  proven by `react-context/provider-missing`: every component that reads it (`useContext`, `use`,
  its `Consumer`), checked or not, must be rendered under its Provider. What stateward cannot
  follow (a component picked at run time, a reader nothing renders) is an error with the path,
  never "not checked". The quick fix on a guarded context (`createContext<T | undefined>(undefined)`
  and a hook that throws) writes `src/guarantees.ts` once and rewrites the declaration; once every
  reader is proven, a second fix drops the hook's check. `react-context/fake-default-value` allows
  the helper's one cast. A type states a guarantee with an optional `__guarantee` property, which
  `ownership/brand-built-outside-owner` no longer reads as a brand.
  [guarantees.md](docs/user/guarantees.md).
- **Requests where the latest answer wins, proven.** `react/effect-response-race` is now on by
  default (an error in `recommended` and `strict`) and proves instead of guessing: an effect that
  calls a loader taking an `AbortSignal` (directly or as `signal` in an options object: `fetch`,
  axios, your own) and sets state from its answer must create an `AbortController`, pass its
  signal, and abort it in the cleanup, or check a flag the cleanup sets before each write. Each
  missing step is an error with a quick fix that writes the controller, the signal and the cleanup,
  offered when it compiles. Effects that run once and the calls of TanStack Query, SWR and RTK
  Query are left alone. The add-on `react/effect-race` now only guesses the narrow case of a call
  that takes no signal: a write after an `await`, with a prop or route parameter in the
  dependencies (6 of 6 right on ten projects, before 75%). New `TypeQueries.signalParameterOf`.
  [guarantees.md](docs/user/guarantees.md#requests-where-the-latest-answer-wins).
- **State that only its module changes a value, and stateward proves it.** A module-level `let`,
  `const` object, `Map`, `Set` or array, or a class's static field, typed `Owned<T>` (from your
  `src/guarantees.ts`) is proven by `ownership/state-written-outside-owner`: every change from
  another module is an error, also through an alias, a destructured part, an element, a function
  that returns it, a re-export, a cast that drops `readonly`, `Object.assign` or a function it is
  handed to. What stateward cannot follow (a package function given the value, a callee picked at
  run time, `any`, a parameter typed `Owned`) is an error with why. The message names the owner's
  functions that make the change. On a finding for an unmarked value, the quick fix "Declare …
  owned by …" writes `Owned` into `src/guarantees.ts` and marks the declaration. Nothing changes
  for values that do not state it. [guarantees.md](docs/user/guarantees.md).
- **See every guarantee and its proof.** `stateward guarantees` lists each `RequiredContext` and
  `Owned` your code states, where it is declared, whether it is proven (or the errors against it),
  and the readers or writers it covers; a marker nothing uses is listed as unused. `--format json`
  too; exit code 1 when one is not proven. In VS Code, hovering a marked declaration shows what it
  promises and its proof, a code lens above it ("2 readers proven · show") lists the places it
  covers, and "Show proof path" on an error walks from it to the declaration. All from the last
  check. [guarantees.md](docs/user/guarantees.md#list-them).
- Removed: the rules `react/flags-allow-impossible-combos` (add-on `react/flag-combos`; 16 right,
  10 wrong on the corpus), `errors/catch-without-intent` (add-on `errors/catch-intent`; right 0 of 31
  on the corpus, 0 of 14 on two new apps) and `records/keyed-maps-out-of-sync` (add-on
  `records/keyed-maps`; right 1 of 8) because most of what they reported was a deliberate
  choice; if your config lists any of these add-ons, remove it from `addons`.
- **Rules that could not run say so.** Where React's types do not resolve (the app's packages are
  not installed), the React rules see nothing: `check` names the packs in one line above the
  summary, `plan` shows "not checked: React's types are not installed (install the app's
  dependencies)" instead of "turns on clean", and `next` does not turn them on as clean. A pack
  declares this per rule (`needsTypes`).
- **`strictNullChecks` off is said.** `check` names the projects without it once, with the setting
  to change, and the fix lines of `unions/default-hides-cases`, `unions/if-chain-misses-case`,
  `records/lookup-misses-key` and `records/table-type-too-loose` say TypeScript does not check
  `null` and `undefined` there (a rule declares this with `fixNeedsStrictNulls`).
- **A results cache without `node_modules`.** The user's cache folder (`~/.cache`,
  `~/Library/Caches`, `%LOCALAPPDATA%`), keyed by the project's path, or `.stateward-cache` in the
  project when there is none; `STATEWARD_CACHE_DIR` still wins and `check --verbose` says where.
- **The first `check` after `init` is useful.** With rollout on, `init` and a `check` with no rule
  on both end with "next: run `npx stateward next` to turn on the first rule".
- **Fewer false alarms.** `records/lookup-misses-key`: an entry made on an earlier line when
  missing (`m[k] = m[k] ?? {}`, `m[k] ??= {}`). `errors/narrow-try`: `Promise.allSettled(…)` is
  never the request (it never rejects), and what a function the `try` only defines can throw is
  neither the request nor a line to move.
- **Messages read like a compiler's.** Every headline states the problem first, as a fact about
  the code, in its own names: ``"failed" of `status` is not listed; `default` handles it``. A place
  not checked starts with `not checked:` and says why. Fix lines, quick-fix titles, hovers and
  VS Code labels follow the same style. The rules tables in the docs gain a "Why it matters" column.
  Findings are unchanged; only their text is.
- **`baseline --prune` drops entries of removed rules.** An entry of a rule its pack no longer has
  can never match again, so `--prune` removes it and names the rule. Entries of a pack the config
  does not load are kept.

## 1.0.2 (unreleased)

- **Fix: an error could be hidden.** Findings are listed at most 20 per rule per file; the first
  20 were kept in position order, so 20 places not checked earlier in a file could hide an error
  of the same rule further down, and `check` passed. Errors and warnings are now kept first.
- **VS Code starts fast on large projects.** With saved results, the file you have open shows its
  findings within about 2 s of VS Code starting (was 10 to 15 s on a 3,000-file app), and the
  whole project right after.
- **Edits re-check less.** Rules that read another file's code depend on the declarations they
  read, not the whole file: a comment or another function's body in a widely used helper no longer
  re-checks every caller (excalidraw's `utils.ts`, a comment: 12 s to 4.6 s). A comment above a
  top-level `X.y = …` assignment no longer re-checks every importer (excalidraw's `App.tsx`:
  17.8 s to 8.1 s). Results cached by an earlier version are recomputed once.
- **Fewer false alarms from `async/handler-rejection-lost`.** Awaiting a function of your own
  that catches its own failures (every `await` in it inside a `try` with a `catch`) is no longer
  reported as an unhandled rejection.
- **Fewer false alarms from `records/lookup-misses-key`.** A read tested before it is used
  (`if (table[key] && …) return table[key]`, `typeof table[key] === "object"`), a read compared
  with a literal (`table[key] === true`), and `(op && table[op]) ?? fallback` are no longer
  reported.
- **`unions/default-hides-cases` counts enum cases over a string type.** `case Status.Issued` over
  a status typed `"issued" | "pending"` covers `"issued"`, as TypeScript narrows; the message named
  every case as hidden. A `default` that throws now says a new value "would compile and throw
  here" instead of "would silently land here".
- **`errors/narrow-try` names the right call.** In `await api.save({ ttl: ttl.trim() })` the
  message named `ttl.trim(…)`, a call in the arguments, as what the `try` is for; it now names
  `api.save(…)`.
- **A project without its packages installed** no longer prints one info per file that imports
  them: past 20 files, the line at the top stands for them and `--verbose` lists them (an app of
  1,200 files printed 819).
- **Rule pages** open with an example and the message stateward really prints for it, in plain
  words; each pack page shows every rule with a short example. A guide to the errors pack:
  [docs/user/errors.md](docs/user/errors.md).

## 1.0.1 (2026-11-05)

Documentation only; the code is the same as 1.0.0.

- Every package's npm page lists its rules, each linked to its page, with how to turn the pack on
  and set a rule's severity and options. The `stateward` page lists every command.
- The README has a table of contents, a step-by-step guide from install to CI, and every rule by
  pack. New indexes: [docs/rules/](docs/rules/README.md) and [docs/packs/](docs/packs/README.md).
- The VS Code extension has an icon and a changelog tab.

## 1.0.0 (2026-11-05)

The first stable release. stateward finds where a TypeScript or React app allows states nobody
meant, and shows the change that rules them out: in the terminal, in CI and in VS Code. It reads
the TypeScript you already write.

### Rule packs

Each pack is its own package; install only the ones you use. Add-on rules are off until you list
the add-on in `addons`. Every rule has a page in [docs/rules/](docs/rules/).

- **unions** (`@stateward/plugin-unions`, 3 rules): a `switch` whose `default` hides cases, an `if`
  chain that misses one, a tag that cannot tell a union's members apart.
- **records** (`@stateward/plugin-records`, 4 rules): a lookup that misses a key, a table typed
  `Record<string, V>` where the keys are fixed, a key written twice, and (add-on
  `records/keyed-maps`) maps keyed alike that drift apart.
- **async** (`@stateward/plugin-async`, 2 rules): a pending flag left set when the awaited call
  fails, and an async handler whose failure nobody catches.
- **errors** (`@stateward/plugin-errors`, 10 rules): a `catch` that misses an error class or hides
  the unexpected ones, errors marked `@mustHandle` that callers must name, `@throws` tags that
  drift from the code, a `finally` that can throw, an ignored or unchecked `Result`, a component
  that can throw with no error boundary above it, and two add-ons: a `try` wider than its call
  (`errors/narrow-try`) and, experimental, a `catch` that swallows without saying why
  (`errors/catch-intent`).
- **ownership** (`@stateward/plugin-ownership`, 2 rules): module-level state changed outside the
  module that owns it, and a brand built outside its check.
- **reducers** (`@stateward/plugin-reducers`, 3 rules): a state no event reaches, a state the
  reducer never leaves, and a reducer stateward cannot read.
- **react-context** (`@stateward/plugin-react-context`, 2 rules): a component rendered outside its
  Provider, and a context with a fake default value.
- **react** (`@stateward/plugin-react`, 11 rules): dependencies and Provider values that change on
  every render; effects that copy state, loop, leak a listener or timer, or (add-on
  `react/effect-race`) let a late response win; state that copies a prop, updates that read stale
  state, index keys on reordered lists, and (add-on `react/flag-combos`) boolean flags that allow
  impossible combinations.

### Command line

- `stateward init` picks the packs that fit your app and writes `stateward.config.ts`; `--ci github`
  adds a GitHub Actions workflow, `--hook` a pre-commit or pre-push hook.
- `stateward check` lists the problems with the change to make. `--fix` applies the verified fixes
  that cannot change how the code runs; `--changed` and `--staged` report only your changes;
  `--format github` annotates pull requests.
- `stateward plan` and `stateward next` turn rules on one at a time; `stateward baseline` accepts
  today's problems so only new ones fail.
- `stateward coverage` shows the places not checked and what would let stateward check them;
  `stateward explain <rule>` shows a rule's page; `stateward deps` and `stateward cache` show what
  is known about libraries and what is cached.

### Config

`stateward.config.ts` with `defineConfig`: presets (`recommended`, `strict`), add-ons, severities
per rule, group and kind of finding, rule options, settings per folder (`overrides`), shared configs
(`extends`), monorepos, and library facts for the errors pack. See
[docs/user/config.md](docs/user/config.md).

### VS Code

The Stateward extension shows findings as you type, with quick fixes verified before they are
offered, "Explain" for each rule, ignore comments written for you, hints naming the errors a
function can throw, and rule-by-rule rollout from the status bar.

### Your own rules

`@stateward/core` exports `defineRule`, `definePlugin`, `option` and test helpers:
[docs/user/write-your-own-rule.md](docs/user/write-your-own-rule.md).

### Known limits

- **Edits that change an exported type** (or the body of an exported function without a written
  return type) re-check every file that imports it, in the background. Your own file is checked
  first.
- `errors/catch-without-intent` is an experimental add-on: most catches it reports are deliberate
  fallbacks.
