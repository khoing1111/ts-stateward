# Install stateward

You need Node 20 or newer and your app's packages installed. Your app can use any TypeScript
version: stateward brings its own TypeScript 6.

## Install the command

In your app's folder, with your app's package manager:

```bash
npm install --save-dev stateward
```

```bash
yarn add --dev stateward
```

```bash
pnpm add --save-dev stateward
```

```bash
bun add --dev stateward
```

## Set it up

```bash
npx stateward init
```

`init` asks which packs to use (the ones that fit your `package.json` are ticked), how strict to be
(`recommended` or `strict`) and whether to turn the rules on one at a time. Press Enter for the
suggested answer, or pass `--yes` to take them all. It writes `stateward.config.ts` and never
overwrites one.

```text
Created stateward.config.ts
  packs   unions, records, async, react-context, errors, react (detected from package.json)
  preset  recommended
  rollout on: rules are turned on one at a time (stateward plan, stateward next)

Install what it imports (npm, from your lockfile; stateward does not run it):
  npm install --save-dev stateward @stateward/plugin-unions ...
```

Run the install command it prints. Each pack is its own package, and `stateward` depends only on
`@stateward/core`, so you install only the packs you use: an app without React gets no React pack.

Commit `package.json`, the lockfile and `stateward.config.ts`. CI installs them as usual.

Then run `npx stateward check` ([quick-start.md](quick-start.md)), or `npx stateward plan` to turn
the rules on one at a time ([work-through-findings.md](work-through-findings.md)).
`npx stateward --help` lists every command.

## VS Code

Search for "Stateward" in the Extensions view, or run:

```bash
code --install-extension stateward.stateward-vscode
```

Open your app's folder. The extension checks it when it has a `stateward.config.ts`, using the
stateward installed in your app (else its own copy). What it shows and its settings:
[the extension's page](../../packages/vscode/README.md).

## Update

Update `stateward` and the packs you use together (`npm outdated` lists them):

```bash
npm install --save-dev stateward@latest
```

VS Code updates the extension itself.

## Remove

Uninstall `stateward` and the packs (`@stateward/plugin-…`), then delete `stateward.config.ts`,
`stateward.rollout.json` and `stateward.baseline.json`.

```bash
npm uninstall stateward
```

```bash
code --uninstall-extension stateward.stateward-vscode
```

## If it goes wrong

- **`no stateward.config.{ts,mts,js,mjs} found`.** Run `npx stateward init` in the app's folder, or
  name the folder with `--cwd ~/code/my-app`.
- **`No rules are on`.** The config has packs but turns no rule on: add `preset: "recommended"`, a
  group or a rule ([config.md](config.md)).
- **Findings are missing or look wrong.** Install your app's packages first, so stateward can follow
  its imports. `npx stateward check --verbose` says which config and tsconfig projects it used.
- **`turn on rollout: true ... first`** from `next`. Set `rollout: true` in `stateward.config.ts`.
- **`unknown rule "..."`.** Rule ids include the pack: `records/lookup-misses-key`. The message
  suggests the id you meant, then lists every id.
- **Out of memory, or slow.** See [Big projects](ci.md#big-projects) and
  [Why is it slow?](ci.md#why-is-it-slow).
- **Exit code 2 with a `failure`.** A rule crashed, so the result is incomplete. Please
  [report it](https://github.com/khoing1111/ts-stateward/issues) with the output.
- **Nothing shows in VS Code.** Open the app's folder or one above it, and check it has a
  `stateward.config.ts`. View › Output, then "Stateward", says which copy of stateward started and
  any error. In an untrusted workspace the extension stays off.
- **A finding is wrong.** [Report it](https://github.com/khoing1111/ts-stateward/issues) as printed,
  with the smallest code that causes it.
