# How stateward does on real projects

Is it fast enough, are its findings right, and do its fixes help? We ran it on eight open-source
projects with every pack and add-on on (November 2026).

## The projects

| Project                                                               | Files checked | What it is                                                            |
| --------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------- |
| [bulletproof-react](https://github.com/alan2207/bulletproof-react)     | 104           | Small reference app, very clean                                       |
| [shadcn-admin](https://github.com/satnaing/shadcn-admin)               | 209           | Small dashboard                                                       |
| [memos](https://github.com/usememos/memos) (web)                       | 443           | Mid-size notes app                                                    |
| [excalidraw](https://github.com/excalidraw/excalidraw)                 | 513           | Large, mature, strictly typed                                         |
| [outline](https://github.com/outline/outline)                          | 1,957         | Large full-stack app, looser typing                                   |
| [react-admin](https://github.com/marmelab/react-admin) (core)          | 397           | Library with many contexts and hooks                                  |
| [tldraw](https://github.com/tldraw/tldraw)                             | 349           | Library; its own packages were not built, so many types were missing |
| [mattermost-webapp](https://github.com/mattermost/mattermost-webapp)   | 2,175         | Large Redux app, archived in 2023, partly JavaScript                  |

## Is it fast enough?

The goal: a first check takes at most 1.3 times as long as `tsc --noEmit`, with at most 1.5 times
its memory.

- **First check:** 0.9 to 1.3 times `tsc` on five projects; about 1.45 times on excalidraw and 1.5
  times on outline, the two large, strictly typed ones.
- **Next check with nothing changed:** one or two seconds (excalidraw five), from the cache.
- **Memory:** within the goal with Node's normal memory limit (excalidraw: 1.2 times `tsc`).
- **First run on a new machine** also works out what each installed package can throw, once per
  package version, cached for every project.

## Are the findings right?

We read 376 findings by hand: does the code really have the problem the message names? Every rule
on by default was right in at least 86% of the cases that could be judged.

| What the rule finds                                                      | Read | Right          | Notes                                                                                        |
| ------------------------------------------------------------------------ | ---- | -------------- | -------------------------------------------------------------------------------------------- |
| A `switch` `default` that hides cases                                    | 45   | 45             | The most common finding. When the `default` really stands for many cases, the message says how to keep it |
| An `if` chain that misses a case                                         | 17   | 17             |                                                                                              |
| A lookup that can miss a key                                             | 32   | 31 (1 unclear) | Registries like `actions["zoom-in"]` that a user can override                                |
| A table typed looser than its keys                                       | 21   | 19             | One "table" was a bag of URL parameters                                                      |
| A context created with a placeholder value                               | 12   | 12             |                                                                                              |
| A value that is new on every render (effects, `useMemo`, context values) | 35   | 35             | Two fix lines had a wrong dependency; fixed                                                  |
| An effect that never cleans up a timer or listener                       | 21   | 21             | Mostly harmless (a focus after 100 ms), but real                                             |
| State copied from a prop                                                 | 9    | 7 (2 unclear)  |                                                                                              |
| Shared state changed from another file                                   | 7    | 7              | Two real bugs (one writes into a shared theme constant); five by design                      |
| An async handler whose failure nobody sees                               | 19   | 9 (10 unclear) | The unclear ones await actions that report errors in their result instead of failing         |
| Catches that miss or hide some errors                                    | 6    | 6              |                                                                                              |

The add-ons, which you turn on yourself:

| Add-on rule                                                                     | Right                | Notes                                                                                |
| ------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| A `try` that also catches bugs in the lines after the risky call (`errors/narrow-try`) | 32 of 44 (7 unclear) | The message sometimes names a toast instead of the request                           |
| Two flags that allow impossible combinations (`react/flags-allow-impossible-combos`) | 73%                  | A `disabled={…}` condition no longer counts as a combination                         |
| A slow response that can overwrite a newer one (`react/effect-response-race`)    | 75%                  | If your stores come from a hook (`useStores()`), list it in `stableHooks`            |
| Two maps that should lose a key together (`records/keyed-maps-out-of-sync`)      | its one wrong case fixed | A map of work in progress (cleared in `finally` or by a timer) is no longer reported |
| A catch that only logs (`errors/catch-without-intent`)                          | 0 of 31              | Experimental: every catch read was a deliberate fallback the rule cannot see         |

Every wrong finding that could be fixed was fixed, each with a test made from the code that caused
it.

## Do the fixes help?

For right findings, usually yes. Two exceptions: a `default` that stands for many cases on purpose
(an event dispatcher), where the message says to keep it; and timer cleanups in components that in
practice outlive their timers, which are good hygiene but change nothing you would see.

## What this does not show

- **Very large projects** (vscode, grafana, cal.com) were not checked: `tsc` alone on vscode needed
  more than 10 GB of memory, and the other two needed more disk than the test machine had.
- **Timings** come from a shared machine and move by 10 to 30%; `tsc` and stateward ran back to
  back, so their ratio is the fairer number.
- **Your app.** If stateward reports something wrong in your code, please
  [send the finding](https://github.com/khoing1111/ts-stateward/issues) as printed, with the
  smallest code that causes it.
