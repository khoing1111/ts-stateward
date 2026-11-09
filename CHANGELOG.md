# Changelog

## 1.2.0 (2026-11-09)

- **`unions/non-exhaustive-switch` checks a `switch` without a `default`** (rc.2). One over a
  union that misses a case is an error, unless TypeScript already reports it (TS2366, TS7030).
  Quick fixes add the case after the last clause, or a `default` that allows it. Kinds `missing`
  and `many-missing`. Who gets fewer switch findings than with 1.1: a project whose switches list
  every case with a `default`, or that set the removed kind `complete`; one that ended its switches
  with `satisfies never` sees the same, plus switches without a `default` that miss a case.
- **`stateward guarantees` lists `SingleProvider` and `Stable` contexts** (rc.2), with their
  Providers; the hover shows every trait of a declaration and the code lens has one per trait.
- **`stateward guarantees` agrees with `check`** (rc.2). An error about a guarantee counts when it
  names the declaration or lies in a place the guarantee covers; every finding on a `switch` over
  an `OpenUnion` names the union, however the value got its type. A declaration is listed only
  where its marker is written. `StatedGuarantee.covers` gives the noun in both forms
  (`{ one: "switch", many: "switches" }`).
- **`--no-cache` on every command that checks** (rc.2); `baseline`, `coverage`, `plan`, `next`,
  `deps` and `guarantees` share the results cache with `check`.
- **`records/unchecked-key` skips keys taken from the same object** (rc.2): `for (k in T)`,
  `Object.keys(T)` and `Object.entries(T)` with their array methods, read as `T[k as K]`.
- **`records/unchecked-key` skips reads that handle a missing key** (rc.2): `??`, `||`, `?.`, or a
  `const` next compared with `undefined` or `null` or passed to `isDefined`, `isNil`, `isNullish`.
- **`records/unchecked-key` skips keys checked against valid keys** (rc.2): `VALID.has(k)` on a
  `Set` or `Map`, `VALID.includes(k)` on an array, before the read.
- **`records/unchecked-key` fix line follows the `lib`** (rc.2): it names
  `Object.prototype.hasOwnProperty.call` when the project has no `Object.hasOwn`.
- **`records/unchecked-key` shows a long table short** (rc.2): `getArrowBindings(…)`, and the fix
  line says to put it in a `const` first.
- **`unions/non-exhaustive-switch` (was `unions/default-hides-cases`) enforces every case.** A
  `default` handles no case of the union unless the code allows it there with
  `void (type satisfies "newsletters");`; one that handles a case nobody allowed is an error. A
  `default` that cannot be reached because every case is listed is correct and no longer reported,
  and the kind `complete` is removed. `satisfies never` is no longer suggested or needed (an
  existing one is read like a plain `default`), and fixes no longer call a project's own `never`
  helper. The headline is `` `switch` on `type` does not handle "newsletters" ``; the quick fixes
  are "Add the missing case" and "Allow "newsletters" in `default`", neither applied by
  `check --fix`.
- **`OpenUnion<T>`.** A union marked open must be handled with a `default` in every `switch`: one
  without is an error, with a note at the declaration. Listed by `stateward guarantees`, hover and
  code lens.
- **`unions/ambiguous-discriminant` (was `unions/tag-does-not-discriminate`).** New headline, and a
  fix with both decisions: a catch-all member with its own tag, or an open union allowed by name.
  The rule page shows the branded-type pattern and `ownership/brand-built-outside-owner`.
- **Removed: `unions/if-chain-misses-case`.** A config that names it gets "unknown rule" with the
  rules there are; `baseline --prune` drops its entries.
- **Renamed rules keep working.** The old id in a config, an ignore comment (with a quick fix),
  `stateward.rollout.json`, the baseline, `explain` and `--rule` is read as the new one, with a
  warning.
- **A fix with alternatives is a list** (contract M22): `one of`, then one line per way, in the
  terminal, in GitHub annotations and in the editor. `hint` in the JSON stays one string, its ways
  on lines that start with `- `.
- **One marker property per guarantee.** `"__guarantee:<name>"?: true`, so guarantees combine by
  intersection, flat or nested; a marker's first parameter defaults to `unknown`. The 1.1.0 form
  `__guarantee?: "<name>"` is still read, and a refactoring rewrites a file in it. The quick fixes
  that write `src/guarantees.ts` write the new form.
- **A config that names an unknown rule** lists the rules of the loaded packs.
- **The VS Code extension says which language server it runs.** When the `stateward.serverPath`
  setting is used, the log and the status bar tooltip name it. When the project also has its own
  `@stateward/language-server`, a notification offers "Use the project's server", which removes
  the setting from the user settings. A server that does not implement a command (an older one)
  gets a message that names the server and the fix, instead of "Unhandled method". A command in a
  TypeScript project never goes to a Python folder's server; when the TypeScript server is not
  running, the message and the status bar say why. `pnpm try` no longer suggests
  `stateward.serverPath`.
- **New add-on `records/unchecked-key`** (`addons: ["records/unchecked-key"]`, a warning): a cast such as
  `status as keyof typeof LABELS`, or a type predicate that tests `key in LABELS`, used to read a
  plain object without checking the key. Such a read gives `undefined` for a missing key and an
  inherited value for `"constructor"` or `"toString"`. The quick fix "Check the key with isKeyOf"
  writes a small `isKeyOf` helper once (in `src/keys.ts`, or uses the project's own), imports it,
  and rewrites the read as `isKeyOf(LABELS, status) ? LABELS[status] : undefined`.
- **`records/table-type-too-loose` is now `records/ambiguous-table`.** The old id keeps working,
  with a warning that says where to rename it.
- **The records fix lines suggest `satisfies` only for a table read with a declared key type**
  (`status: Status`), as `as const satisfies Record<Status, V>`, with a note where `Status` is
  declared; `Partial<Record<Status, V>>` when every such read has a fallback; `as const` alone
  when the object defines its keys. The quick fix of `records/ambiguous-table` follows the same
  rule ("Use as const: the object defines the keys"). For an open dictionary, the fix line lists
  the choices: `Partial<Record<string, V>>`, a `Map`, `Object.create(null)` or `isKeyOf` before
  reading.
- **The traits model.** `stateward guarantees` lists every trait with where it is stated (the
  project's marker, a standard type, the config's facts or stateward's facts), in the text and the
  JSON (`source`); the hover names a source that is not a marker. The guarantees guide is one
  catalog: for each trait, when to use it, when not, an example and its finding.
- **`Opaque<T, Name>`.** A brand stated opaque makes `ownership/brand-built-outside-owner` strict:
  every value of the type built outside its module (a cast, a plain value, an object literal,
  `any`) is an error, with a note at the declaration. The finding on an unmarked brand offers the
  quick fix "State `X` opaque". Listed by `stateward guarantees`.
- **New: `ownership/resource-not-released`** (core). A value with the release trait (a
  `Disposable` type, the `Release<T>` marker, or a `facts` line `returns: "release"` or
  `returns: { release: "<method>" }`) that a function does not release on every way out is an
  error; what it cannot follow (an array, a parameter not typed `Release`) is an error that says
  why. The ownership pack ships facts for Firebase `onSnapshot`, RxJS `Observable.subscribe`,
  Redux `Store.subscribe` and zustand `StoreApi.subscribe`. Core checks `returns` in `facts` and a
  plugin's own `facts`.
- **`react/effect-missing-cleanup` reads the release trait.** A value with the trait that an
  effect does not release is reported whatever the function is called, with a note naming the
  source; the name-based detection stays for the rest.
- **`Pending<T, Running>`.** `async/pending-state-stuck-on-failure` proves that a state stated
  pending settles on every way out of a function that sets it running, and that an async function
  does not start while it runs; the fixes name the start value and the other values from the type.
  A `Pending` with no running value is reported. These findings are errors (kind `stated` under `severities`); unmarked state stays a warning. Core: `ReportProblem.stated`. A pending finding notes other state the function
  writes, and the rule page has "One state for an async result".
- **`ownership/state-written-outside-owner`'s fix line** lists the read-only view first and
  `Owned` second; the rule page and the guarantees guide show the pattern.

- **`react/provider-value-changes-every-render` is now `react-context/provider-value-changes-every-render`**,
  in the react-context pack. The old id keeps working with the rename warning, and `check --fix`
  renames it in the config. A config that names it without loading `reactContext()` gets a
  warning to add the pack or remove the line.
- **`SingleProvider` and `react-context/provider-nested`.** A context whose type has
  `SingleProvider` (`Context<Store | undefined> & SingleProvider`, or
  `RequiredContext<Store> & SingleProvider`) has one Provider on any render path. A Provider of it
  rendered under another one is an error, at the render that brings in the second Provider, with
  the outer one as a note.
- **`Stable`, proven by `react-context/provider-value-changes-every-render`.** A context whose type
  has `Stable` must get a value that never changes: setters, a `dispatch`, refs, module
  constants, and `useMemo`/`useCallback` over them. Anything else is an error that names the
  cause (state, a prop, a new literal, a hook not followed). The rule's default severity is now
  `error` for that case; a new value for a context that states nothing is still a warning.
- **`react-context/value-changed-by-reader`, an add-on.** Reports a component or hook that changes
  the value it reads from a context (an assignment, `delete`, `push`, `set`, `add`): readers
  re-render only when the Provider passes a new value. Off by default until it is measured on
  real projects: `addons: ["react-context/value-changed-by-reader"]`.
- **The react-context messages and rule pages are rewritten** to say what each rule checks first,
  with one example and its fix; fix lines with alternatives are lists. `fake-default-value` now
  reads "`ThemeContext` defaults to `{} as Theme`, a cast that is not a real value"; the quick
  fixes are "State AuthCtx required: …" and "Remove the run-time check in useAuth".
- **`Stable`: state whose setter is never read is stable.** `const [store] = useState(createStore)`,
  a setter bound and never read, and a reducer whose `dispatch` is never taken keep their first
  value, so a context stated `Stable` may carry them. A setter that is read, and `ref.current`,
  are still reported.
- **`neverRejects: true` in `facts`.** A package function or promise property can be stated never
  to reject: an `await` of it is not a way out for `ownership/resource-not-released` and for a
  state stated `Pending`, and the async rules read it too. Shipped for RTK Query's
  `cacheEntryRemoved` (`@reduxjs/toolkit`), so the `onCacheEntryAdded` streaming pattern
  (`await cacheEntryRemoved; unsubscribe();`) is no longer reported. The config validates it:
  only `true`, never with a non-empty `rejects`. Core: `neverRejectsFactOf`,
  `TypeQueries.bindingPropertyOf`.
- **`ownership/resource-not-released` asks no type question about a call whose syntax rules the
  trait out** (`releaseCandidates` in core; `react/effect-missing-cleanup` uses it too). Cold,
  with only that rule: outline 16.2 s to 5.8 s, mattermost-webapp 17.4 s to 6.5 s; a full cold
  check is 2.5 s faster on each. Findings are the same. Core: `TypeQueries.declaresDispose` and
  `renamedBindings`.
- **A package function called through a name the project gives it** (`const listen = onSnapshot`,
  `const { onSnapshot: listen } = firestore`) is followed to its `facts` line by
  `resource-not-released`; rc.1 did not follow it.
- **Projects reached through a link** (every folder under macOS's `/tmp`): `init --hook` writes
  the right `cd`, `init --ci` names the workflow from the project, `check --staged` checks the
  staged text, the warning about a config file that imports its own TypeScript names the file
  from the config's folder, and the VS Code extension no longer treats a `stateward.serverPath`
  that names the project's own server through a link as an override.
- **Tables keyed by a type that does not resolve are not judged.** `TypeQueries.propertyKeysOf`
  says `"generic"` for a mapped type over the keys of an unresolved import, instead of an index
  signature (twenty, `records/lookup-misses-key`).
- **`resource-not-released`: a value stored in a field and returned** from the same function is
  handed to the caller, not left unreleased (reactfire's `SuspenseSubject._subscribe`).
- **`effect-missing-cleanup` accepts an emitter's `off`**: `bus.on(event, handler)` ended by
  `bus.off(event, handler)` or `removeListener` with the same arguments is cleaned up (insomnia).
- **On save, VS Code applies only safe fixes.** `source.fixAll.stateward`, which
  `editor.codeActionsOnSave` runs, takes only the fixes a rule marks `safe` (those
  `check --fix` applies); the lightbulb's "Fix all stateward problems in the file" still takes the
  first fix of each finding.
- **A second `stateward.config.*` in the folder** gets a warning that names the file used and the
  one ignored.
- **`install-into` says that the `file:` paths it writes** work only on this machine and are not
  to be committed; `--vendor` is the form for a team or CI.
- **Development:** a gate step fails on file names that differ only by case, or by `.ts` and
  `.tsx`; the fixture `Feed.tsx` that collided with `feed.ts` is now `FeedList.tsx`.

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
