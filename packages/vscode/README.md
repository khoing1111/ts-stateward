# Stateward for VS Code

Exclusive states and predictable code paths for TypeScript and React, as you type. Stateward shows where your
code allows states your app never means (a `default` that hides a new status, a lookup missing a
key, an error nobody handles), explains what can happen, and offers the change that rules them out.
Findings show as squiggles and in the Problems view.

<!-- Screenshot to add before publishing: a squiggle on a `default` with its hover and quick fix. -->

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
   `.mts`, `.js`, `.mjs`), using the stateward installed in the project, else its own copy.

In a monorepo, each file is checked with the nearest config above it, and the status bar names the
config of the file you are in.

## Use it

- **The lightbulb** on a finding offers its fixes, "Explain" for the rule's page, "Fix all stateward
  problems in this file", and "Ignore this case here", which writes a `// stateward-ignore` comment.
  Fixes are tried on a copy of your code first: one that would not compile is not offered.
- **The status bar** shows `Stateward` with a check mark, or the number of errors. With
  `rollout: true` in the config it shows where you are (`Stateward: rule 2 of 9 · 3 left`). Click it
  for the commands.
- **Grey hints** after a function's signature list the errors it can throw or reject with
  (`throws NotFoundError | ParseError`), and after a `catch` variable the errors its `try` can
  throw. Hover one to see where each comes from.
- Baselined findings show faintly; places stateward could not check show as faint hints.

## Commands

In the command palette, type "Stateward":

- **Set up this project**: runs `npx stateward init` in a terminal. It never installs anything
  itself.
- **Show the rule plan** and **Turn on the next rule**: turn the rules on one at a time.
- **Explain a rule…**: why the rule matters, what it flags and how to fix it.
- **Re-check now**.

## Settings

- `stateward.inlayHints.throws`, `stateward.inlayHints.catchVariable`: the grey hints (both on).
- `stateward.serverPath`: a language server you built yourself.

The extension runs your project's config, so it stays off in a workspace you have not trusted.
View › Output, then "Stateward", shows which copy of stateward started and any error.

Docs, every rule and the command line: https://github.com/khoing1111/ts-stateward#readme
