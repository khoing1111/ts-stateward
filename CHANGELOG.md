# Changelog

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

- **VS Code start on a large project.** With saved results, the first findings for the file you
  have open can take 10 to 15 s on a 3,000-file app: that file is checked from scratch before the
  saved results are used. Editing and TypeScript's own errors are not affected. A fix is planned for
  1.0.1.
- **Edits that change an exported type** (or the body of an exported function without a written
  return type) re-check every file that imports it, in the background. Your own file is checked
  first.
- `errors/catch-without-intent` is an experimental add-on: most catches it reports are deliberate
  fallbacks.
