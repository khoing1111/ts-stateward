# How stateward does on real projects

In November 2026, stateward was run on eight open-source projects with every pack and add-on on,
tried by a first-time user on two apps it had never seen, and compared with 1.0 on eleven projects.

## The projects

| Project                                                              | Files checked | What it is                                                           |
| -------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------- |
| [bulletproof-react](https://github.com/alan2207/bulletproof-react)   | 104           | Small reference app, very clean                                      |
| [shadcn-admin](https://github.com/satnaing/shadcn-admin)             | 209           | Small dashboard                                                      |
| [memos](https://github.com/usememos/memos) (web)                     | 443           | Mid-size notes app                                                   |
| [excalidraw](https://github.com/excalidraw/excalidraw)               | 513           | Large, mature, strictly typed                                        |
| [outline](https://github.com/outline/outline)                        | 1,957         | Large full-stack app, looser typing                                  |
| [react-admin](https://github.com/marmelab/react-admin) (core)        | 397           | Library with many contexts and hooks                                 |
| [tldraw](https://github.com/tldraw/tldraw)                           | 349           | Library; its own packages were not built, so many types were missing |
| [mattermost-webapp](https://github.com/mattermost/mattermost-webapp) | 2,175         | Large Redux app, archived in 2023, partly JavaScript                 |

## Speed

The goal is a first check that takes at most 1.3 times as long as `tsc --noEmit` and at most 1.5
times its memory.

- **First check:** 0.9 to 1.3 times `tsc` on four of the eight projects (memos, mattermost-webapp,
  shadcn-admin, tldraw), and 1.5 to 1.8 times on the other four (outline, excalidraw,
  bulletproof-react, react-admin). The goal is not met on those four yet; speed is the next piece of
  work after 1.1.
- **Next check with nothing changed:** one or two seconds (excalidraw five), from the cache.
- **Memory:** within the goal with Node's normal memory limit (excalidraw: 1.2 times `tsc`).
- **First run on a new machine** also works out what each installed package can throw, once per
  package version, cached for every project.

## Accuracy of the findings

376 findings were read by hand to judge whether the code has the problem the message names. Every
rule on by default was right in at least 86% of the cases that could be judged.

| What the rule finds                                                      | Read | Right          | Notes                                                                                                     |
| ------------------------------------------------------------------------ | ---- | -------------- | --------------------------------------------------------------------------------------------------------- |
| A `switch` `default` that hides cases                                    | 45   | 45             | The most common finding. When the `default` stands for many cases on purpose, the message says how to keep it |
| An `if` chain that misses a case                                         | 17   | 17             |                                                                                                           |
| A lookup that can miss a key                                             | 32   | 31 (1 unclear) | Registries like `actions["zoom-in"]` that a user can override                                             |
| A table typed looser than its keys                                       | 21   | 19             | One "table" was a bag of URL parameters                                                                   |
| A context created with a placeholder value                               | 12   | 12             |                                                                                                           |
| A value that is new on every render (effects, `useMemo`, context values) | 35   | 35             | Two fix lines had a wrong dependency; fixed                                                               |
| An effect that never cleans up a timer or listener                       | 21   | 21             | Real, though mostly with little effect (a focus after 100 ms)                                                          |
| State copied from a prop                                                 | 9    | 7 (2 unclear)  |                                                                                                           |
| Shared state changed from another file                                   | 7    | 7              | Two real bugs (one writes into a shared theme constant); five by design                                   |
| An async handler whose failure is not caught                             | 19   | 9 (10 unclear) | The unclear ones await actions that report errors in their result instead of failing                      |
| Catches that miss or hide some errors                                    | 6    | 6              |                                                                                                           |

The add-ons, which are off by default:

| Add-on rule                                                                                            | Right                | Notes                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A `try` that also catches bugs in the lines after the risky call (`errors/narrow-try`)                 | 32 of 44 (7 unclear) | The message sometimes names a toast instead of the request                                                                    |
| A slow response that can overwrite a newer one, from a call that takes no signal (`react/effect-race`) | 6 of 6 (1 unclear)   | Measured again for 1.1.0 on these projects and two more apps; a call that takes an `AbortSignal` is now proven, on by default |

Removed in 1.1 after these measurements: `errors/catch-without-intent` (0 of 31 right on these
projects, 0 of 14 on two more apps), `records/keyed-maps-out-of-sync` (1 of 8 right) and
`react/flags-allow-impossible-combos` (16 right, 10 wrong).

Every wrong finding that could be fixed was fixed, each with a test made from the code that caused
it.

## Two apps it had never seen

A developer new to stateward followed the [quick start](quick-start.md) on two apps outside the
projects above: [umami](https://github.com/umami-software/umami) (a Next.js analytics app, 1,194
files) and the dashboard of [Infisical](https://github.com/Infisical/infisical) (Vite and React
19, 4,330 files), and read every finding of the default rules by hand.

| What the rule finds                          | Read | Right | Wrong |
| -------------------------------------------- | ---- | ----- | ----- |
| A `switch` `default` that takes cases        | 118  | 117   | 1     |
| An `if` chain that misses a case             | 18   | 18    | 0     |
| A lookup that can miss a key                 | 16   | 11    | 5     |
| A table typed looser than its keys           | 16   | 16    | 0     |
| An async handler whose failure is not caught | 36   | 17    | 5     |
| Catches that drop some errors                | 2    | 0     | 0     |
| **All**                                      | 206  | 179   | 11    |

179 of the 190 that could be judged were right: 94%. The wrong ones were fixed, each with a test
made from the code, and the same apps then gave 2 wrong findings: 99%. The 16 unclear ones await a
library call that never fails (a query's `refetch`) or a prop, or drop errors that a global
handler shows.

The trial also changed how stateward reports what it cannot check. These apps were checked without
their packages installed, so the React rules could not run, and the output looked like a clean
result. `check` and `plan` now say "not checked: React's types are not installed" instead
([best practices](best-practices.md#what-to-do-with-not-checked)).

## From 1.0 to 1.1

The same config (every pack, `recommended`, every add-on) with 1.0.1 and 1.1.0, on the same
commits of eleven projects. The projects' packages were not installed for either run, so the
counts are lower than with an install, but the difference between the versions is exact.

| Project                                                                            | Files | Problems 1.0 → 1.1 |
| ---------------------------------------------------------------------------------- | ----- | ------------------ |
| [healthcare](https://github.com/adrianhajdin/healthcare) (a tutorial app)          | 50    | 11 → 8             |
| bulletproof-react                                                                  | 104   | 4 → 4              |
| shadcn-admin                                                                       | 209   | 18 → 16            |
| [next-shadcn-dashboard](https://github.com/Kiranism/next-shadcn-dashboard-starter) | 299   | 11 → 8             |
| tldraw                                                                             | 349   | 38 → 33            |
| react-admin                                                                        | 397   | 18 → 11            |
| memos                                                                              | 443   | 32 → 20            |
| excalidraw                                                                         | 513   | 58 → 44            |
| [umami](https://github.com/umami-software/umami)                                   | 1,193 | 30 → 23            |
| outline                                                                            | 1,957 | 182 → 132          |
| mattermost-webapp                                                                  | 2,175 | 199 → 162          |
| **Total**                                                                          |       | **601 → 461**      |

- **115 fewer** from the three rules taken out (flag combinations, catches "without intent", maps
  kept in step). Most of what they reported was intended.
- **22 → 4** for responses that can overwrite a newer one. The rule now checks only effects that
  call a loader taking an `AbortSignal` and do not abort it, and proves those. Some of those gone
  were real races on calls that take no signal (`highlight(lang, code).then(setContent)`). With a
  `signal` parameter on such a loader, the call is checked again.
- **6 fewer** lookups that can miss a key: each read was already handled (compared with a
  literal, tested first, or given a fallback).
- **1 fewer** async handler: the callback catches its own failure.
- **No new finding** outside these rules, and the time of a check did not change.

## Whether the fixes help

For right findings, the fixes usually help, with two exceptions. A `default` that stands for many
cases on purpose (an event dispatcher) should stay, and the message says so. Timer cleanups in
components that in practice outlive their timers are good hygiene but change no visible behaviour.

## Limits of these measurements

- **Very large projects** (vscode, grafana, cal.com) were not checked: `tsc` alone on vscode needed
  more than 10 GB of memory, and the other two needed more disk than the test machine had.
- **Timings** come from a shared machine and vary by 10 to 30%; `tsc` and stateward ran back to
  back, so their ratio is the more reliable number.
- **Other apps** may give other results. To report a wrong finding,
  [send it](https://github.com/khoing1111/ts-stateward/issues) as printed, with the smallest code
  that causes it.
