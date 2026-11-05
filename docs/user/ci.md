# Run it in CI

Run `stateward check` on every pull request, and each finding shows on the line it is about.
stateward must be in your app's `devDependencies` ([install.md](install.md)).

## GitHub Actions

From your app's folder:

```bash
npx stateward init --ci github
```

It writes `.github/workflows/stateward.yml` (and `stateward.config.ts` if you have none), and never
replaces an existing file. The workflow runs on pull requests and on pushes to the default branch.
It sets up Node (from `engines.node`, `.nvmrc` or `.node-version`, else 22) and your lockfile's
package manager, installs your packages, restores stateward's cache, and runs:

```bash
npx --no stateward check --format github
```

`--format github` prints annotations that GitHub turns into messages on the pull request, with no
plugin or token:

```text
::error file=src/status.ts,line=14,col=7,endLine=14,endColumn=13,title=records/table-type-too-loose::`labels` is typed `Record<string, string>`: a fixed table or an open dictionary? — keys from outside: `Partial<Record<string, string>>`; every key known: look keys up as `keyof typeof labels`, then use `satisfies`
```

Errors show red, warnings yellow. Baselined and ignored findings are not shown. `npx --no` uses the
stateward your app installed and never downloads one.

In a monorepo, run `init --ci github` in your app's package. The workflow goes at the repository's
root, installs there, and runs stateward in your package (`working-directory: packages/app`).

If another workflow already runs `stateward check`, directly or through a `package.json` script,
`init` says so and writes nothing; `--force` writes it anyway.

## Only the files of a pull request

On a big app, report only the findings in the files a pull request changes:

```bash
npx stateward init --ci github --changed
```

Pull requests then run the line below, and pushes to the default branch still report everything:

```bash
npx --no stateward check --format github --changed origin/${{ github.base_ref }}
```

stateward still checks the whole project, but reports only findings in changed files, or that point
into one. The exit code follows what is reported.

```text
1 error in 3 changed files (12 problems elsewhere not shown, 2.1 s).
```

`--changed` needs the branch's history: set `fetch-depth: 0` on `actions/checkout` (the generated
workflow does).

## Other CI systems

Run `npx --no stateward check`. The default output reads fine in any log, and the exit code fails
the job:

| Code | Meaning                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------- |
| 0    | No errors, and no more warnings than `--max-warnings` allows.                                             |
| 1    | At least one error, or more warnings than `--max-warnings`.                                               |
| 2    | stateward could not run (bad command line, broken config, out of memory), or a rule failed. |

`--format json` gives the findings for a script.

## Fail on warnings

Warnings do not fail the job by default. To allow none:

```bash
npx --no stateward check --format github --max-warnings 0
```

A number above 0 allows that many.

## Code that already has findings

Accept today's findings once, and commit `stateward.baseline.json`; the job then fails only on new
ones ([Accept what is there today](work-through-findings.md#accept-what-is-there-today)).

```bash
npx stateward baseline
```

## The cache

stateward remembers what it found in each file and next time looks again only at changed files. It
keeps this in `node_modules/.cache/stateward` (or `STATEWARD_CACHE_DIR`). The generated workflow
saves that folder under a key made from your lockfile, config and stateward version.

What libraries throw is cached once per package version, for all your projects, in
`~/.cache/stateward/packages` (or `STATEWARD_PACKAGE_CACHE_DIR`). Each cache keeps under 200 MB
(`STATEWARD_CACHE_MAX_MB`, `STATEWARD_PACKAGE_CACHE_MAX_MB`), dropping what was used longest ago.

```bash
npx stateward cache stats
```

`stateward cache clean` empties both. `check --no-cache` ignores the results cache for one run.

## Big projects

stateward raises Node's memory limit itself, to 4 GB or three quarters of the machine's memory if
that is less. If it still runs out, it says so and exits with 2. Give it more:

```bash
npx --no stateward check --format github --max-memory 6144
```

Or set `maxMemory: 6144` in the config. Keep it below the machine's memory. `--max-memory` wins over
`NODE_OPTIONS`, which wins over the config; `STATEWARD_NO_RESPAWN=1` keeps Node's own limit.

## Why is it slow?

`check --timing` prints where the time went after the summary:

```text
Timing (the check took 24,213 ms; peak memory 1840.5 MB):
  building programs        2,950 ms   12.2%  parsing and binding
  rules                   19,830 ms   81.9%
    in type questions     12,410 ms   51.3%  the type checking the rules ask for
  ...
       time  share       type  allocated  rule
   6,104 ms  25.2%   4,870 ms   410.2 MB  errors/catch-misses-error (summarize 5,820 ms, check 284 ms); 513 files
```

- **type** is the rule's time in type questions. The first rule to need a file's types pays for
  them and the others reuse them, so turning that rule off saves less than its line says.
- **allocated** is memory allocated while the rule ran, mostly freed again. **peak memory** is the
  most the process held.

A large share in building programs means many files: look at `include` and `exclude`. A rule slow
without much type time is slow in its own code; please
[report it](https://github.com/khoing1111/ts-stateward/issues) with this output.
