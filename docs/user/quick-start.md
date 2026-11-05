# Quick start

Install stateward in your app, run it, and read what it reports. You need Node 20 or newer and
your app's packages installed, so stateward can follow its imports.

## Install and check

In your app's folder:

```bash
npm install --save-dev stateward
```

```bash
npx stateward init --yes
```

`init --yes` picks the packs that fit your `package.json`, writes `stateward.config.ts`, and
prints the command that installs those packs. Run that command, then:

```bash
npx stateward check
```

For yarn, pnpm or bun, and the VS Code extension, see [install.md](install.md). Without `--yes`,
`init` asks which packs to use and how strict to be.

## Read a finding

```text
$ npx stateward check
error[unions/default-hides-cases]: this `default` hides 3 cases of `status`: "failed", "loading", "ready"
 --> src/status.ts:7:5
  |
7 |     default:
  |     ^^^^^^^
  = fix: list the cases, then put `status satisfies never;` in the `default`, or if these 3 cases all mean the same, say which:
        default: status satisfies "failed" | "loading" | "ready";
  = docs: stateward explain unions/default-hides-cases

1 error, 2 warnings in 3 files (1.0 s). Run `stateward explain <rule>` for details.
```

Each finding gives the severity and rule, what is wrong, where, and the change to make.
`npx stateward explain <rule>` shows the rule's page: why it matters, what it flags, how to fix it.

Where stateward cannot decide (a type it cannot follow, a package it cannot read), it does not
pass the code silently. It counts those places in one line above the summary:

```text
12 places not checked (react/dependency-changes-every-render 12); list them with `--verbose` or `stateward coverage`
```

`stateward coverage` lists them per pack, with the change that would let stateward check them.

`check` exits with 0 when there is no error, 1 when there is one, and 2 when it could not run or a rule failed.

## Next

- A big app can print hundreds of findings. Turn the rules on one at a time and accept what is
  there today: [work-through-findings.md](work-through-findings.md).
- Every rule, grouped by pack, with what it finds and its severity: [the rules index](../rules/README.md).
- Choose packs, rules and severities: [config.md](config.md).
- Check every pull request: [ci.md](ci.md). Check before each commit: [pre-commit.md](pre-commit.md).
- How often stateward is right on real projects: [real-world-results.md](real-world-results.md).

Something not working? See [install.md](install.md#if-it-goes-wrong). A finding you think is
wrong is a bug: [send it](https://github.com/khoing1111/ts-stateward/issues) as printed, with the
smallest code that causes it.
