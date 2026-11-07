# Before each commit or push

A git hook can check the staged changes and stop the commit when there is an error. stateward must
be in the app's `devDependencies` ([install.md](install.md)). It checks the whole project each time,
so on a large project a pre-commit hook can take tens of seconds; a pre-push hook runs less often.

## Set up a hook

From your app's folder:

```bash
npx stateward init --hook
```

It uses the hook tool the app already has:

| The app has               | It does                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| husky (a `.husky` folder) | adds `npx --no stateward check --staged` to `.husky/pre-commit`  |
| lefthook (`lefthook.yml`) | adds a `stateward` command to its `pre-commit` section           |
| lint-staged               | writes nothing, and prints the line to add ([below](#with-lint-staged)) |
| none of these             | writes `.git/hooks/pre-commit`                                   |

It never overwrites a hook. If it cannot add the line safely, or the hook already runs stateward
through a `package.json` script, it says so; `--force` adds the line anyway.

For a pre-push hook instead (husky, lefthook or `.git/hooks`):

```bash
npx stateward init --hook pre-push
```

Skip a hook once with `git commit --no-verify` or `git push --no-verify`.

## What the hooks run

The pre-commit hook runs:

```bash
npx --no stateward check --staged
```

It checks the staged version of each staged file, and reports only findings in staged files or that
point into one:

```text
error[unions/default-hides-cases]: "failed" of `status` is not listed; `default` handles it
 --> src/status.ts:9:5
...
1 error in 1 changed file (4 problems elsewhere not shown, 0.4 s).
```

`--fix` does not go with `--staged`. Run `npx --no stateward check --fix`, then stage the result.

The pre-push hook runs `npx --no stateward check --changed <upstream>`, where `<upstream>` is the
branch you push to, or for a new branch the default branch (`origin/HEAD`, else `main`).

## With lint-staged

lint-staged adds file names to its commands, but stateward checks the whole project. To leave the
names out, use a function in `lint-staged.config.mjs`:

```js
export default { "*.{ts,tsx}": () => "npx --no stateward check --staged" };
```

A JSON config cannot do this; use husky or `init --hook`.

## Without a hook

```bash
npx --no stateward check --changed
```

This reports findings in files changed on the branch since it was created from `main`, and in files
not committed yet. To compare with another base, name it: `--changed origin/develop`.
