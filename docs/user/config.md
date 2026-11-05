# The config file

Nothing is on until you choose. Adding a pack to `plugins` only makes its rules available; a
`preset`, a group or a rule by name turns them on. `stateward init` writes `preset: "recommended"`;
remove it to choose rules one by one.

`stateward.config.ts` (or `.mts`, `.js`, `.mjs`) sits in your project's folder. stateward uses the
nearest one in the folder you run it in or above, up to the repository's root; `--config <file>`
names another. Wrap it in `defineConfig` and your editor completes every key, rule id and option.

```ts
import { defineConfig, defaults } from "stateward";
import { records } from "@stateward/plugin-records";

export default defineConfig({
  plugins: [records()],
  preset: "recommended",
  exclude: [...defaults.exclude, "src/generated/**"],
  overrides: [{ files: ["src/legacy/**"], rules: { "records/lookup-misses-key": "off" } }],
});
```

A mistake in the file stops `stateward` with a message that names the key and says what is allowed.

## Every key

| Key         | Default                                      | What it does                                      |
| ----------- | -------------------------------------------- | ------------------------------------------------- |
| `plugins`   | none                                         | the packs and your own rules (required)           |
| `preset`    | none: no rule is on                          | turns the packs' rules on, and how strict         |
| `addons`    | `[]`                                         | extra rule sets a pack offers by name             |
| `rules`     | from the preset                              | one rule's severity and options                   |
| `groups`    | from the preset                              | a severity for all rules of a group               |
| `unknowns`  | `"info"`                                     | how places stateward could not check show         |
| `overrides` | `[]`                                         | other settings for some folders or files          |
| `extends`   | `[]`                                         | shared configs to start from                      |
| `tsconfig`  | `"tsconfig.json"`                            | the TypeScript projects to check                  |
| `include`   | `**/*.ts`, `**/*.tsx`                        | files to check                                    |
| `exclude`   | tests, test helpers, stories, `node_modules` | files to skip                                     |
| `ignores`   | reason required, unused ignore a warning     | how strict `stateward-ignore` comments are        |
| `rollout`   | `false`                                      | run only the rules `stateward next` turned on     |
| `facts`     | `{}`                                         | what library functions throw, for the errors pack |
| `maxMemory` | 4096, or 3/4 of the machine's memory         | the memory (MB) the command may use               |

### plugins

The packs you use, each a function call. Install only these: each pack is its own package.

```ts
plugins: [unions(), records()],
```

A rule that is off is never loaded, so it costs no start-up time or memory. The packs and their
rules: [unions](../packs/unions.md), [records](../packs/records.md), [async](../packs/async.md),
[errors](../packs/errors.md), [ownership](../packs/ownership.md),
[reducers](../packs/reducers.md), [react-context](../packs/react-context.md),
[react](../packs/react.md).

### preset

Turns on the rules of every pack in `plugins`. `"recommended"` reports what a rule can only
suspect as info; `"strict"` makes those errors. Without a preset no rule is on, and `check` says so.

```ts
preset: "strict",
```

### addons

Rules a pack keeps off until you ask, named `<pack>/<add-on>`. The rule's page names its add-on.

```ts
addons: ["react/effect-race"],
```

### rules

One rule's severity (`"error"`, `"warning"`, `"info"` or `"off"`), with its options if it has any.

```ts
rules: {
  "records/lookup-misses-key": "warning",
  "team/max-union-members": ["warning", { max: 12 }],
},
```

Each rule's page lists its options. Lists of names take `*` as "any characters": `"use*Query"`. A
rule that reports several kinds of finding takes a severity per kind, named on its page:

```ts
"errors/throws-doc-mismatch": ["error", { severities: { extra: "warning" } }],
```

### groups

A severity for all rules of a group (the headings in `stateward plan`). A rule in `rules` wins over
its group.

```ts
groups: { "unions/cases": "warning" },
```

### overrides

Other settings for some files. Each entry has `files` (globs, from the config's folder) and any of
`rules`, `groups`, `preset` and `addons`. In an override, `rules` takes a severity only; set a
rule's options once, in the top-level `rules`.

```ts
overrides: [
  { files: ["src/legacy/**"], rules: { "records/lookup-misses-key": "off" } },
  { files: ["src/payments/**"], preset: "strict" },
],
```

A rule's severity in a file comes from the config's `preset`, `addons`, `groups`, then `rules`; then
from each matching entry in order, the same way, the later winning. A `preset` or `addons` in an
entry only changes a rule's default: a severity you set for the rule or its group stays.

Rules that look at the whole project (is this context provided somewhere?) still read every file,
and report only in files where they are on. `plan` and `coverage` count the same way.

### extends

Start from a shared config: a package that exports `defineConfig({ ... })`.

```ts
import team from "@acme/stateward-config";

export default defineConfig({
  extends: [team],
  rules: { "records/lookup-misses-key": "off" },
});
```

Configs merge in order and your file wins:

- `plugins` are joined by name; one name from two different packages is an error.
- `rules`, `groups` and `facts` merge key by key; `addons` are joined; `ignores` merge option by
  option.
- A severity alone keeps the shared options: `["error", { maxHidden: 10 }]` there and `"warning"`
  here give `["warning", { maxHidden: 10 }]`. Options replace the shared options object whole.
- The shared `overrides` come first, so yours win. Their globs are read from your config's folder.
- `tsconfig`, `include`, `exclude`, `preset` and `rollout` take the last value set.

### tsconfig

The TypeScript project to check, or a list (globs from the config's folder). Each is checked with
its own compiler options, and its `references` are followed. A file in two projects is checked once.

```ts
tsconfig: ["packages/*/tsconfig.json", "apps/web/tsconfig.json"],
```

### include and exclude

Which files of those projects to check, and which to skip. What the tsconfig excludes is skipped
too. The default `exclude` skips `**/*.test.*`, `**/*.spec.*`, `**/*.testing.*`, `**/*.stories.*`,
`**/*.story.*`, `**/__tests__/**`, `**/__scenarios__/**`, `**/__fixtures__/**`, `**/__mocks__/**`
and `**/node_modules/**`.

Setting `exclude` replaces that list. Keep it with `defaults.exclude` (`defaults.include` too):

```ts
exclude: [...defaults.exclude, "src/generated/**"],
```

### ignores

How strict `// stateward-ignore` comments are
([Ignore one case](work-through-findings.md#ignore-one-case)).

```ts
ignores: { requireReason: true, reportUnused: "warning" },
```

- `requireReason` (default `true`): a comment without a reason is a warning.
- `reportUnused` (default `"warning"`): the level for a comment that no longer covers a finding:
  `"error"`, `"warning"` or `"off"`.

### rollout

Run only the rules in `stateward.rollout.json`, which `stateward next` fills
([Work through the findings](work-through-findings.md)).

```ts
rollout: true,
```

### unknowns

Where a rule cannot decide, it reports a "place not checked" instead of passing silently.

- `"info"` (default): `check` counts them in one line and lists them with `--verbose`.
  `--format github` annotates them as notices only with `--verbose`; `--format json` always has
  them. The editor shows them as faint hints.
- `"warning"`: listed as warnings everywhere, and counted by `--max-warnings`.
- `"off"`: not listed. The summary still counts them, so a gap is never silent.

A file stateward could not read at all (`stateward/syntax`, `stateward/imports`) is always listed.

### maxMemory

The memory in MB the command may use, for a large project that runs out. `--max-memory` wins over
it; the VS Code extension does not read it. See [Big projects](ci.md#big-projects).

```ts
maxMemory: 6144,
```

### facts

What a library function throws or rejects with, when the package does not say. The errors pack uses
it to tell whether a `catch` is complete; `stateward deps` lists the calls still unknown.

```ts
facts: { axios: { get: { throws: ["AxiosError"] } } },
```

## Monorepos

**One config at the root** suits packages with the same settings, and lets rules that look across
packages (who provides a context, who writes a record) see them all.

```ts
// stateward.config.ts, at the repository's root
export default defineConfig({
  tsconfig: ["packages/*/tsconfig.json"],
  plugins: [records(), reactContext()],
  preset: "strict",
  overrides: [{ files: ["packages/legacy/**"], preset: "recommended" }],
});
```

`check` at the root, or in any package below it, checks every package. If the root
`tsconfig.json` already `references` them all, leave `tsconfig` out.

**One config per package** suits packages that need different packs or belong to different teams.
Run `check` in each (`pnpm -r exec stateward check`, or `--cwd packages/web`); a rule then sees
only its own package. Share settings with `extends`.

You can mix the two. `check --verbose` prints the config and each project with its number of files.
In VS Code each file is checked with the nearest config above it.

## Files beside the config

`stateward.rollout.json` and `stateward.baseline.json` are written by stateward; commit them, and do
not edit them by hand.
