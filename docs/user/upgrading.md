# Upgrading

The changes an app needs when it moves to a newer stateward. For a new install, see
[quick-start.md](quick-start.md).

## From 1.0 to 1.1

Update `stateward` and every pack you use together (`npm outdated` lists them):

```bash
npm install --save-dev stateward@latest
```

Then:

1. **Remove the three rules that were taken out.** They were right too rarely on real projects,
   because most of what they reported was intended. Delete their add-ons from
   `addons`, and their ids from `rules`, `// stateward-ignore` comments and
   `stateward.rollout.json`:

   | Rule removed                          | Add-on to delete from `addons` |
   | ------------------------------------- | ------------------------------ |
   | `errors/catch-without-intent`         | `errors/catch-intent`          |
   | `records/keyed-maps-out-of-sync`      | `records/keyed-maps`           |
   | `react/flags-allow-impossible-combos` | `react/flag-combos`            |

   If they are left in place, the run stops with a message that names what to remove:

   ```text
   stateward: stateward.config.ts: addons: unknown add-on "react/flag-combos"; add-ons of the loaded plugins: react/effect-race
   ```

   ```text
   stateward: stateward.rollout.json lists "react/flags-allow-impossible-combos", which is not a rule of your packs; remove "react/flags-allow-impossible-combos" from its "enabled" list; the other rules stay on
   ```

   An ignore comment that names one is reported as an error at the comment.

2. **`react/effect-response-race` is now on by default,** as an error in
   `recommended` and `strict`. It checks every effect that calls a loader taking an `AbortSignal`
   (`fetch`, axios, or a project function such as `fetchUser(id, signal)`) and sets state from the
   answer. The effect must abort the request in its cleanup, or check a flag the cleanup sets. The quick fix in VS Code
   writes the three lines. With rollout on, it runs once `stateward next` turns it on, like any
   rule. The add-on `react/effect-race` now only covers loaders that take no signal.
   [How it works](guarantees.md#requests-where-the-latest-answer-wins).

3. **Clean up the baseline**, if there is one. Entries of the removed rules have no effect;
   `npx stateward baseline --prune` drops them, along with the findings fixed since.

### What to expect

- **Fewer findings.** On eleven open-source projects the problems went from 601 to 461, most of
  the difference from the removed rules, with nothing new outside the rules that changed
  ([real-world-results.md](real-world-results.md)).
- **"not checked" for the React rules when React's types are missing.** Install the app's packages
  before `check`, also in CI; `plan` no longer reports those rules as clean.
- **A line about `strictNullChecks`** when a tsconfig has it off.
- **Guarantees, opt-in.** stateward proves a stated guarantee (`RequiredContext`, `Owned`), and
  `npx stateward guarantees` lists them ([guarantees.md](guarantees.md)).

## From a beta to 1.0

An app that used stateward before 1.0, from a clone or a beta branch, needs the following changes.

### In short

1. Switch to the published packages: remove the `file:` or `vendor/stateward` entries from
   `package.json` (and their `resolutions`, `pnpm.overrides` or `overrides`), then
   `npm install --save-dev stateward` and the packs your config imports.
2. Fix the imports in `stateward.config.ts` if they name an old package (below).
3. Replace the old rule, group and add-on ids (below) everywhere they are written: the config,
   `// stateward-ignore` comments and `stateward.rollout.json`.
4. Refresh the baseline, if you have one (below).
5. Install the extension from the Marketplace, and uninstall the `.vsix` build first:
   `code --uninstall-extension stateward.stateward-vscode`. Remove `stateward.serverPath` from your
   VS Code settings if you set it.

An old id still works. stateward reads it as the new one, warns "`old` is now `new`; rename it in …"
(in the config, in a `// stateward-ignore` comment, in `stateward.rollout.json`) and continues.
A rule, group or add-on removed before 1.0 is dropped from the config with a warning. The run stops
only on an id stateward never had ("unknown rule id") and on an import of a removed package, which
fails to load. The warnings go away once you use the ids listed under "now" below.

### From rc.1

- **The catch add-on:** its rule was experimental and was removed in 1.1.0 (see the
  [changelog](../../CHANGELOG.md)). Remove the add-on from `addons`.
- **`errors/narrow-try` is now an add-on**, off by default. To keep it, add it to `addons`:
  `addons: ["errors/narrow-try"]`.

### Removed packages

| Old package | Use now |
| --- | --- |
| `@stateward/plugin-guards` | `unions()` from `@stateward/plugin-unions`, `records()` from `@stateward/plugin-records` |
| `@stateward/plugin-states` | `records()`, `asyncFlow()` from `@stateward/plugin-async`, `react()` from `@stateward/plugin-react` |
| `@stateward/plugin-values` | `ownership()` from `@stateward/plugin-ownership`, `errors()` from `@stateward/plugin-errors` |
| `@stateward/plugin-boundaries` | `ownership()` from `@stateward/plugin-ownership` |
| `@stateward/plugin-machines` | `reducers()` from `@stateward/plugin-reducers` |
| `@stateward/guards` | write `value satisfies never` in the `default` or `else`, or keep your own `assertNever(value: never): never` |
| `@stateward/react-context` | `createContext<User \| undefined>(undefined)` and a hook that throws when the value is `undefined` |
| `@stateward/values`, `@stateward/states` | copy the types you used (`Brand`, `Result`, `RemoteData`) into your project; the rules recognise `Brand` and `Result` by their shape |

Then remove the old package from `package.json`.

### Rule ids

| Old id | Id now |
| --- | --- |
| `guards/no-default-on-union-switch` | `unions/default-hides-cases` |
| `guards/exhaustive-if-chain` | `unions/if-chain-misses-case` |
| `guards/no-weak-discriminant` | `unions/tag-does-not-discriminate` |
| `guards/exhaustive-lookup` | `records/lookup-misses-key` |
| `states/fixed-record` | `records/table-type-too-loose` |
| `guards/no-duplicate-map-key` | `records/duplicate-key` |
| `states/parallel-maps` | removed in 1.1.0 |
| `states/loading-reset` | `async/pending-state-stuck-on-failure` |
| `errors/async-handler-unhandled` | `async/handler-rejection-lost` |
| `errors/exhaustive-catch` | `errors/catch-misses-error` |
| `errors/rethrow-unknown` | `errors/catch-hides-unexpected` |
| `errors/must-handle` | `errors/must-handle-error` |
| `errors/no-swallow` | removed in 1.1.0 |
| `errors/throws-matches-doc` | `errors/throws-doc-mismatch` |
| `errors/finally-may-throw` | `errors/finally-can-throw` |
| `errors/render-throws-without-boundary` | `errors/render-throw-without-boundary` |
| `values/must-use-result` | `errors/result-ignored` |
| `boundaries/one-writer` | `ownership/state-written-outside-owner` |
| `values/brand-owner` | `ownership/brand-built-outside-owner` |
| `states/no-boolean-state-combos` | removed in 1.1.0 |
| `machines/unreachable-state` | `reducers/state-unreachable` |
| `machines/dead-end` | `reducers/state-cannot-leave` |
| `machines/readable-reducer` | `reducers/reducer-not-readable` |
| `react-context/required-provider` | `react-context/provider-missing` |
| `react-context/no-placeholder-default` | `react-context/fake-default-value` |
| `react/stable-dependencies` | `react/dependency-changes-every-render` |
| `react/stable-provider-value` | `react/provider-value-changes-every-render` |
| `react/derived-state-effect` | `react/effect-copies-derived-value` |
| `react/state-copied-from-props` | `react/state-copies-prop` |
| `react/effect-sets-own-dependency` | `react/effect-loops` |
| `react/effect-cleanup` | `react/effect-missing-cleanup` |
| `react/effect-race` | `react/effect-response-race` |
| `react/stale-closure-update` | `react/closure-reads-stale-state` |
| `react/index-key-on-changing-list` | `react/index-key-on-reordered-list` |

### Groups

| Old group | Group now |
| --- | --- |
| `guards/switches` | `unions/cases` |
| `guards/unions` | `unions/cases` |
| `guards/lookups` | `records/keys` |
| `states/records` | `records/keys` |
| `states/flags` | `react/state` |
| `states/async` | `async/failures` |
| `values/brands` | `ownership/owners` |
| `values/results` | `errors/callers` |
| `boundaries/ownership` | `ownership/owners` |
| `machines/graph` | `reducers/graph` |
| `errors/async` | `async/failures` |
| `errors/finally` | `errors/catch` |
| `errors/inference` | `errors/callers` |
| `errors/react` | `errors/render` |
| `react/render-stability` | `react/render` |
| `react/state-updates` | `react/state` |

### Add-ons

| Old add-on | Add-on now |
| --- | --- |
| `states/parallel-maps` | removed in 1.1.0 |
| `errors/swallow` | removed in 1.1.0 |

The add-on `react/effect-race` keeps its name.

### Removed and merged rules

These rules were merged, so that one cause gives one message:

| Old rule | Now part of |
| --- | --- |
| `react/stable-hook-return` | `react/dependency-changes-every-render` |
| `errors/throw-in-hook` | `errors/render-throw-without-boundary` |
| `errors/exhaustive-fallback` | `errors/catch-misses-error` |

The add-on `errors/hook-throws` was removed with `errors/throw-in-hook`;
`errors/render-throw-without-boundary` needs no add-on.

These were removed, because they were rarely right or needed a stateward library:
`guards/stale-narrowing`, `guards/checked-type-predicates`, `guards/prefer-is-one-of`, `guards/no-todo-left`, `guards/dead-variants`, `values/refined-literal`, `values/throws-in-result-function`, `states/async-state-has-failure`, `react/hoist-constant`, `react/memo-defeated`, and the add-ons `guards/is-one-of`, `guards/stale-narrowing`,
`guards/checked-type-predicates` and `react/performance`. Delete them from your config and your
ignore comments.

### Options

- `async/pending-state-stuck-on-failure`: the `flagWords` option is gone. The rule reads any state
  set before an `await` and set again after it, whatever its name. A config that still sets it
  loads, with a warning.
- `react/effect-response-race`: set `stableHooks` on `react/dependency-changes-every-render`
  instead; both rules read it from there. Set on `react/effect-response-race` it still works, with a
  warning.

### Refresh the baseline

`stateward.baseline.json` records each accepted problem by its rule id. Rewrite it with the ids of
1.0 before the upgrade, while the beta still reads the old ones:

1. Run `npx stateward check`. With the accepted problems hidden, nothing new should fail. Fix or
   ignore anything new first; otherwise the next step accepts it.
2. Run `npx stateward baseline`, which writes the file again with the current ids.
3. Commit it, then upgrade.

After an upgrade, `npx stateward check --no-baseline` shows every problem, and
`npx stateward baseline` then accepts them under the new ids.

`stateward.rollout.json` lists rule ids under `enabled`. An old id is read as the new one and a
removed rule is skipped, so the file still loads. Replace the old ids using the table above, or
delete the file and turn the rules on again with `npx stateward next`.
