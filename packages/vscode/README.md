# Stateward for VS Code

Stateward checks TypeScript and React code for invalid states and unpredictable code paths while
you type. It reports code that allows states the app does not handle, such as a `default` that
hides a new status, a lookup that can miss a key, or an error that no code handles. Each finding
says what can happen and offers the change that rules the state out. Findings show as squiggles and
in the Problems view.

## What it shows

- Squiggles and Problems-view entries for each finding, as you type: what is wrong, the change to
  make, and the rule id; "Explain" on the lightbulb opens the rule's page.
- Quick fixes on the lightbulb, tried on a copy of the code first.
- Grey hints with the errors a function can throw, and those a `catch` receives.
- The error count, or the rollout's progress, in the status bar.

[The rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md) lists
each rule, what it finds and its severity.

## Set up

1. Install this extension.
2. In your project, install stateward and write its config:

   ```bash
   npm install --save-dev stateward
   ```

   ```bash
   npx stateward init
   ```

   Or open a TypeScript project without a config and choose "Set up" when the extension asks.

3. Open the project's folder. The extension checks each folder with a `stateward.config.ts` (or
   `.mts`, `.js`, `.mjs`). It uses the stateward installed in the project, or its own copy when there
   is none.

Install the project's packages too. The React rules read React's types from them, and without those
types the rules are reported as not checked.

In a monorepo, each file is checked with the nearest config above it, and the status bar names the
config of the open file.

## Python

The same extension checks Python with py-stateward. It does not bundle py-stateward; it uses the
version installed in the project, as the command line does.

1. Install it in the project: `uv add --dev py-stateward` (or `pip install py-stateward` in the
   project's environment).
2. Turn it on: add a `[tool.stateward]` table to the folder's `pyproject.toml` (for example
   `preset = "recommended"`), or set `stateward.python.enabled`.

The extension looks for `py-stateward` in `stateward.python.serverPath`, then the project's
`.venv` or `venv`, then `PATH`, and starts one server per such folder. If it finds none it says so
once; install it, then run "Stateward: Restart Python server". Findings, hovers, "Explain" and the
status bar work as for TypeScript. `stateward.python.pyrefly` and
`stateward.python.checkerProcesses` are passed to the server; a change restarts that folder's
server. View › Output, "Stateward (Python): <folder>", shows its log.

## Use it

- **The lightbulb** on a finding offers its fixes, "Explain" for the rule's page, "Fix all stateward
  problems in this file", and "Ignore this case here", which writes a `// stateward-ignore` comment.
  Each fix is tried on a copy of the code first, and one that would not compile is not offered.
- **The status bar** shows `Stateward` with a check mark, or the number of errors. With
  `rollout: true` in the config it shows the rollout's progress (`Stateward: rule 2 of 9 · 3 left`). Click it
  for the commands.
- **Grey hints** after a function's signature list the errors it can throw or reject with
  (`throws NotFoundError | ParseError`), and after a `catch` variable the errors its `try` can
  throw. Hover one to see where each comes from; on a `catch (e)`, the lightbulb offers "Handle
  the known errors here, rethrow the rest". The
  [errors guide](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/errors.md) explains
  how it works.
- Baselined findings show faintly; places stateward could not check show as faint hints.

## Guarantees

A declaration typed `RequiredContext<T>` or `Owned<T>` states a guarantee that stateward proves.
Hover its name to see the guarantee and whether it is proven. The code lens above it ("2 readers
proven · show") lists the places it covers; moving through the list shows each place, and choosing
one opens it. On an error against it, the lightbulb's **Show proof path** steps from the error to
the declaration. The
[guarantees guide](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/guarantees.md)
explains how it works.

## Commands

In the command palette, type "Stateward":

- **Set up this project**: runs `npx stateward init` in a terminal. It never installs anything
  itself.
- **Show the rule plan** and **Turn on the next rule**: turn the rules on one at a time.
- **Explain a rule…**: why the rule matters, what it flags and how to fix it.
- **Re-check now**.

## Settings

- `stateward.inlayHints.throws`, `stateward.inlayHints.catchVariable`: the grey hints (both on).
- `stateward.serverPath`: the path to a locally built language server.

The extension runs the project's config, so it stays off in an untrusted workspace.
View › Output, then "Stateward", shows which copy of stateward started and any error.

## Docs

- [Every rule](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md), grouped
  by pack, each with its page.
- [Quick start](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/quick-start.md) and
  [the config file](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).
- [Work through the findings](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/work-through-findings.md)
  one rule at a time.
- [Best practices](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/best-practices.md):
  adopting it on an existing app, which guarantees to state, ignores, CI.
- [The project on GitHub](https://github.com/khoing1111/ts-stateward#readme).
