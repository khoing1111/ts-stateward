# Work through the findings

Your first run printed more than you can fix today. Turn the rules on one at a time, accept the
findings you already have so only new ones fail, and fix what can be fixed in bulk. Commands run in
your app's folder, with stateward installed ([install.md](install.md)).

## See where to start

```bash
npx stateward plan
```

`plan` lists every rule by group, with how many places it flags and how many it can fix. The
number on the left is the suggested order: rules that flag nothing come first, since they cost
nothing to turn on.

```text
order  rule                                  findings  fixable  protects

unions/cases
1      unions/if-chain-misses-case                   0        0  An if / else if chain over a union handles every case, so a value added later fails to compile. (nothing to fix, turns on clean)
18     unions/default-hides-cases            1        0  A switch over a union handles every case, so a value added later fails to compile instead of falling into the default.
...
```

## Turn the rules on one at a time

Set `rollout: true` in `stateward.config.ts` (`init` offers to, and does when your app has many
findings). Then:

```bash
npx stateward next
```

`next` turns on the next rule that flags something, plus every rule that flags nothing. Only the
rules you turned on run, in the terminal and in VS Code. They are kept in `stateward.rollout.json`;
commit it.

```text
$ npx stateward next
also on, nothing to fix: unions/if-chain-misses-case, records/lookup-misses-key, ...
on: unions/default-hides-cases (1 finding, 0 fixable)
A switch over a union handles every case, so a value added later fails to compile instead of falling into the default.
```

Run `npx stateward check`, fix the findings, then run `next` again. `next` waits while the last
rule still has findings; `next --anyway` moves on regardless.

To look at one rule or one group (the headings in `plan`) without rollout:

```bash
npx stateward check --rule records/lookup-misses-key
```

```bash
npx stateward check --group unions/cases
```

`--max 5` shows only the five most serious findings.

## Accept what is there today

When a rule has more findings than you can fix now, accept them so only new ones fail:

```bash
npx stateward baseline
```

```text
$ npx stateward check
No problems in 3 files (0.0 s) (1 baselined: `stateward baseline --prune` after fixing them).
```

The accepted findings go in `stateward.baseline.json`; commit it. Each is remembered by its rule and
the code on its line, not the line number, so moving code keeps it accepted and changing the line
makes it new. `baseline --prune` drops the ones you have fixed, and `check --no-baseline` shows them
all again. `next --baseline` turns on the next rule and accepts its findings in one step.

## Fix in bulk

Some fixes cannot change how your code runs, such as adding `status satisfies never;` to a
`default`. Commit first, then preview and apply them:

```bash
npx stateward check --fix --dry-run
```

```bash
npx stateward check --fix
```

```text
Fixed 7 problems in 4 files; 3 problems need a decision (run without --fix to see them).
```

- Only fixes marked safe are applied. One that could change behaviour stays a quick fix in VS Code,
  for you to review.
- Each fix is verified first: it is applied to a copy of your code, and one that adds a TypeScript
  error on the lines it changes is not applied or offered. The changed files are then checked
  again.
- `--rule`, `--group` and `--changed` limit what is fixed. Baselined and ignored findings are left
  alone.
- The exit code follows what is left, so it works in a script.

## Ignore one case

When the code is meant to be that way, put a comment above the line, with the rule and why:

```ts
// stateward-ignore records/lookup-misses-key: keys come from the server's fixed list
const label = labels[status];
```

Use this as a last resort: a baseline is for "fix later", a comment for "this is intended".

- Name several rules with commas. `// stateward-ignore-file <rule>: <why>`, above the file's first
  statement, covers the whole file.
- A comment without a reason, one that no longer covers a finding, or one that names an unknown rule
  is reported ([`ignores`](config.md#ignores) sets how strictly).
- `check --no-ignores` shows what the comments cover. `stateward explain stateward/ignore` has the
  details.

## In VS Code

With the extension installed ([install.md](install.md#vs-code)), findings show as squiggles and in
the Problems view as you type, and baselined findings show faintly. The lightbulb offers the fixes,
"Explain", and "Ignore this case here", which writes the comment. The status bar shows where the
rollout is (`Stateward: rule 2 of 9 · 3 left`); click it to turn on the next rule.
[The extension's page](../../packages/vscode/README.md) has the rest.

## Limits

Every check reads the TypeScript you already write. Some only look at one common way of writing a
thing: for example, the Provider check covers contexts created with no default
(`createContext<User | undefined>(undefined)`). Each [rule page](../rules/) says what the rule does
not catch.
