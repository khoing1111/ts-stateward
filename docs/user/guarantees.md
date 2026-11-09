# Guarantees

A guarantee, or trait, is a property of the code that the code states, such as "this context
always has a Provider above it" or "what this function returns must be released". stateward then
proves it on every use. A use it cannot prove is an error with the path to it, never "not checked".
Without the statement, stateward infers the property from patterns in the code, which can be wrong
in both directions.

![How a guarantee works: you state it in a type, stateward checks every use of it, and each use is proven or reported as an error with the path](images/guarantee-proof.svg)

## How a trait is stated

The plainest statement wins, in this order:

1. **A standard type that already says it:** `Disposable` (the value must be released), an
   `AbortSignal` parameter (the request can be cancelled). Nothing to write.
2. **A marker type in the project's `src/guarantees.ts`:** a type with an optional
   `"__guarantee:<name>"` property. It needs no package, and the property exists only in the type,
   so nothing changes at run time.
3. **A `facts` line in the config,** for code the project cannot edit (a package).

```ts
// src/guarantees.ts
export type Owned<T = unknown> = T & { readonly "__guarantee:owned"?: true };
export type Release<T = unknown> = T & { readonly "__guarantee:release"?: true };
```

- **It is kept through refactors.** stateward reads the type, not its name: a local alias, a
  generic, a re-export, or a type from another package of the monorepo keeps it.
- **Traits combine.** Each marker has its own property, so a type states several by intersection:
  `RequiredContext<Store> & SingleProvider`. A marker's first parameter defaults to `unknown`, so
  the bare name is the trait alone; `Settings & Owned & Opaque<…>` reads the same flat or nested.
- **In a monorepo or a layered app,** a package that cannot import the app's `src/guarantees.ts`
  declares its own copy of the marker, or writes the property inline
  (`Settings & { readonly "__guarantee:owned"?: true }`): stateward reads the property, not where
  the type is declared.
- **A quick fix states it** on the finding that suggests it, offered only when the result
  compiles. `check --fix` never applies it: stating a trait is the developer's decision.
- **stateward 1.1's form** (`{ readonly __guarantee?: "owned" }`) is still read. Two traits in that
  form cannot combine (their intersection is `never`), so the lightbulb on such a marker offers
  "Rewrite the guarantee markers to the 1.2 form" for the whole file.

## The catalog

| Trait | States | Stated with | Proven by |
| --- | --- | --- | --- |
| [required context](#requiredcontext-every-reader-is-under-the-provider) | every reader is under the Provider | `RequiredContext<T>` | `react-context/provider-missing` |
| [owned](#owned-only-its-module-changes-it) | only its module changes the value | a read-only view, or `Owned<T>` | `ownership/state-written-outside-owner` |
| [opaque](#opaque-values-are-built-only-in-its-module) | values are built only in its module | `Opaque<T, Name>` | `ownership/brand-built-outside-owner` |
| [release](#release-the-value-must-be-released) | the value must be released | `Disposable`, `Release<T>` or a `facts` line | `ownership/resource-not-released` |
| [pending](#pending-work-in-progress-settles) | work in progress always settles, and does not start twice | `Pending<T, Running>` | `async/pending-state-stuck-on-failure` |
| [single provider](#singleprovider-the-provider-appears-once) | the context's Provider appears once on any render path | `SingleProvider` on the context's type | `react-context/provider-nested` |
| [stable](#stable-the-context-value-never-changes) | the context value never changes | `Stable` on the context's type | `react-context/provider-value-changes-every-render` |
| [open union](#openunion-a-union-that-can-gain-members) | the union can gain members at run time | `OpenUnion<T>` | `unions/non-exhaustive-switch` |
| [latest wins](#requests-where-the-latest-answer-wins) | an old answer never replaces a newer one | an `AbortSignal` parameter | `react/effect-response-race` |

## `RequiredContext`: every reader is under the Provider

**Use it** for a context with no meaningful default, whose hook throws when its Provider is
missing. **Not** for a context with a real default value.

```tsx
export const ThemeContext = requiredContext<Theme>();
```

The quick fix **Declare ThemeContext required: `requiredContext<Theme>()`**, on the declaration or
on a missing-Provider finding, writes the marker and its helper into `src/guarantees.ts` and
rewrites the declaration. Every component that reads the context (`useContext`, `use`,
`<ThemeContext.Consumer>`) must then be rendered under its Provider. A place stateward cannot
follow (a component picked at run time, a class component, JSX passed to a function, an app with
no entry point it can find) is an error that says what makes it provable:

```text
error[react-context/provider-missing]: `ThemeContext` (stated required) is not proven: the component behind `<Picked>` cannot be followed
  --> settings.tsx:20:10
   = fix: pass the value as a prop, or render the component directly; constant maps are checked by the dynamic-components add-on
   = note: settings.tsx:23: `<Page>` is rendered
   = note: settings.tsx:6: `ThemeContext` is stated required: every reader must be proven under its Provider
```

Once every reader is proven, the hook's run-time check is reported as an info with the fix **Remove
the run-time check in useTheme**. `react-context/fake-default-value` allows the one cast in
`requiredContext`. Tests are not part of the proof: wrap renders in the Provider in one helper.

## `SingleProvider`: the Provider appears once

**Use it** for a context that holds one instance (a store, a cache, a session): a second Provider
below the first would give part of the tree another instance. **Not** for a context that is
overridden on purpose (a theme for one panel).

```ts
export const StoreContext: RequiredContext<Store> & SingleProvider = requiredContext<Store>();
```

The marker goes on the context's type, not on the value: `Context<Store | undefined> &
SingleProvider` or `RequiredContext<Store> & SingleProvider`. `react-context/provider-nested`
then reports a Provider of it rendered under another one, with the outer Provider as a note.

## `Stable`: the context value never changes

**Use it** for a context whose value never changes, such as an "actions" context. **Not** for a
context that carries state.

The Provider's value must then be provably stable: `useMemo` or `useCallback` with stable
dependencies, a `dispatch`, a module constant, state whose setter is never used
(`const [store] = useState(createStore)`). Anything else is an error of
`react-context/provider-value-changes-every-render`, the strict form of what that rule reports
without the marker.

## `Owned`: only its module changes it

**Use the plain TypeScript pattern first:** keep the mutable value private, and export a read-only
view (`readonly` at every level) with the functions that change it. TypeScript then rejects a
change from any other file, with no marker:

```ts
const state = { theme: "light", fontSize: 14 };

export const settings: { readonly theme: string; readonly fontSize: number } = state;

export function setTheme(theme: "light" | "dark"): void {
  state.theme = theme;
}
```

**Use `Owned`** for code that is not restructured that way, for changes `readonly` does not see (a
cast, a method of a `Map`), or to have each change proven. **Not** for a store class whose methods
other modules call: each such call changes the owned object from another module.

On a finding of `ownership/state-written-outside-owner`, the quick fix **Declare settings owned by
src/settings.ts** writes `Owned` into `src/guarantees.ts` and marks the declaration. Every change
from another module is then an error, through an alias, a destructured part, an element, a
function that returns it, a re-export or a cast; handing it to another module's function that
changes its argument is one too:

```text
error[ownership/state-written-outside-owner]: `session` is changed outside its owner, `session.ts`
 --> header.ts:5:3
  = fix: call `signOut` from `session.ts` instead: it owns the value
  = note: header.ts:4: `current` is `session`
  = note: session.ts:3: `session` is declared owned: only `session.ts` may change it
```

A place stateward cannot follow is an error that says why: a package function given the value
(pass a copy, or take a `Readonly` parameter), a callee picked at run time, a value cast to `any`,
a parameter typed `Owned`. Copies (`{ ...settings }`) are new values. Files listed under the rule's
`owners` option count as the owner.

## `Opaque`: values are built only in its module

**Use it** for a branded type whose values must pass a check (`OrderId`, `Positive`): only its
module builds one. **Not** for a label brand that any code may write.

```ts
// src/guarantees.ts
export type Opaque<T, Name extends string> = T & { readonly "__guarantee:opaque"?: Name };

// src/order-id.ts
export type OrderId = Opaque<string, "OrderId">;

export function orderId(raw: string): OrderId | undefined {
  return raw.startsWith("o-") ? raw : undefined;
}
```

The marker is optional, so TypeScript accepts a plain `string` where an `OrderId` is expected.
`ownership/brand-built-outside-owner` reports every value of the type built outside its module: a
cast, a plain value, an object literal, an `any`:

```text
error[ownership/brand-built-outside-owner]: `OrderId` is built from `"o-2"` outside `./order-id.ts`
  --> orders.ts:12:8
   = fix: build it with `orderId()` from `./order-id.ts`
   = note: order-id.ts:3: `OrderId` is stated `Opaque` here
```

A brand written in the usual shape (`string & { readonly __brand: "OrderId" }`) keeps the rule's
1.1 behaviour, which reports casts only. Its finding offers the quick fix **State `OrderId` opaque**,
which rewrites the declaration to `Opaque<string, "OrderId">` and writes the marker. A value whose
type holds the brand (`string[]` given where `OrderId[]` is expected) is not followed.

## `Release`: the value must be released

**Use it** for a subscription, a listener, a connection: a value that keeps running until it is
released. **Not** for a value that ends by itself (a one-shot timer, a finished request).

The trait is stated in the plainest way that fits:

- **a standard type:** a value with `[Symbol.dispose]` or `[Symbol.asyncDispose]` (`Disposable`,
  `AsyncDisposable`). Node's own types are left out: they add these to child processes, streams
  and timers, which end by themselves;
- **the marker, on the project's own function:**

  ```ts
  export function watchPrices(onPrice: (price: number) => void): Release<() => void> {
    const id = setInterval(() => onPrice(read()), 1000);
    return () => clearInterval(id);
  }
  ```

- **a `facts` line for a package,** next to the `throws` facts: `"release"` calls the returned
  function, `{ release: "<method>" }` calls that method on it:

  ```ts
  facts: {
    "firebase/firestore": { onSnapshot: { returns: "release" } },
    rxjs: { "Observable.subscribe": { returns: { release: "unsubscribe" } } },
  }
  ```

The ownership pack ships facts for Firebase `onSnapshot`, RxJS `Observable.subscribe`, Redux
`Store.subscribe` and zustand `StoreApi.subscribe`; a config line for the same function wins.
An `await` between the start and the release is a way out when it fails, except an `await` of a
promise stated `neverRejects: true` in `facts` (shipped for RTK Query's `cacheEntryRemoved`, so
`await cacheEntryRemoved; unsubscribe();` in `onCacheEntryAdded` is a release on every way out).
`ownership/resource-not-released` then requires a release on every way out of the function that
holds the value: calling it (or its method, or `using`), returning it, passing it to a parameter
typed `Release`, or storing it in a place the file releases. The note names where the trait comes
from:

```text
error[ownership/resource-not-released]: `unsubscribe` from `onSnapshot(…)` is never released
  --> src/flagged.ts:65:9
   = fix: one of
       - call `unsubscribe()` when it is no longer needed
       - or return it, so the caller releases it
   = note: `onSnapshot` returns a release function (stateward's facts for firebase/firestore)
```

In a React effect, `react/effect-missing-cleanup` reads the same trait: such a value not released
in the cleanup is reported whatever the function is called.

**A value that lives as long as the app,** such as a store subscription started once at startup,
is never released on purpose. At the top of a module it is not reported. Started in a function
(`startConnectors()`), it is: say so on the line above, with the reason, so a reader sees the
choice:

```ts
export function startConnectors(): void {
  // stateward-ignore ownership/resource-not-released: lives as long as the app
  useToolStore.subscribe(ensureConnectors);
}
```

## `Pending`: work in progress settles

**Use it** for a state that marks work in progress (`saving`, `status: "saving"`). **Not** for a
data library's status (React Query, SWR), which settles by itself.

```ts
// src/guarantees.ts
export type Pending<T, Running extends T = Extract<T, true>> = T & {
  readonly "__guarantee:pending"?: Running;
};

const [saving, setSaving] = useState<Pending<boolean>>(false); // true means running
status: Pending<"idle" | "saving" | "saved" | "failed", "saving"> = "idle"; // "saving" means running
```

For `boolean`, `true` means running; for any other type, name the running values (a `Pending`
without them is reported). `async/pending-state-stuck-on-failure` then proves, for every function
that sets it running, that every way out leaves another value (any `await` may fail), and that an
async function returns early while it runs. The fixes name the values from the type:

```text
error[async/pending-state-stuck-on-failure]: `status` stays `"saving"` when `post()` fails
  --> save.ts:24:5
   = fix: one of
       - set `status` back in `finally`: `finally { this.status = "idle"; }`
       - or set it to "failed" in a `catch`: `catch (error) { this.status = "failed"; throw error; }`
   = note: save.ts:20: `status` is stated `Pending` here
```

These findings are errors, since the trait is stated; a state without the marker keeps the rule's
shape-based check, as warnings.

## `OpenUnion`: a union that can gain members

**Use it** for a union that comes from outside the code (a status from a server, an event type from
a package). **Not** for a union the code owns.

```ts
// src/guarantees.ts
export type OpenUnion<T = unknown> = T & { readonly "__guarantee:open-union"?: true };

// src/orders.ts
export type OrderStatus = OpenUnion<"pending" | "paid" | "shipped">;
```

`unions/non-exhaustive-switch` then requires every `switch` on an `OrderStatus` to have a
`default` that handles a value it does not list:

```text
error[unions/non-exhaustive-switch]: `switch` on `order.status` does not handle a value outside `OrderStatus`, which is open
 --> src/orders.ts:10:3
  = fix: add `default:` that handles an unknown status
  = note: src/orders.ts:4: `OrderStatus` is stated open (`OpenUnion`)
```

No quick fix writes `OpenUnion`: add the line to `src/guarantees.ts`.

**`OpenUnion` or a parse at the boundary.** When the data is parsed where it enters, by a schema
that rejects an unknown status, the parsed value is closed: type it with the closed union, and
`OpenUnion` is not needed. Use `OpenUnion` when values reach the code without such a parse, or
when the parse lets unknown values through (a plain string cast to the union, a schema with a
fallback).

## Requests where the latest answer wins

**Use it** for a loader an effect calls with inputs that change. The statement is plain
TypeScript: the loader takes an `AbortSignal` (`fetch`, axios's config, any `signal` parameter or
option).

```ts
export async function fetchUser(id: string, signal?: AbortSignal): Promise<User> {
  const response = await fetch(`/api/users/${id}`, { signal });
  return (await response.json()) as User;
}
```

`react/effect-response-race` then requires every effect that calls it and sets state from its
answer to abort it in the cleanup, or to check a flag the cleanup sets. The quick fix **Abort
fetchUser(…) when the effect is cleaned up** writes the controller, the signal and the abort:

```text
error[react/effect-response-race]: `fetchUser(…)` takes an AbortSignal the effect never passes: an answer for an old `userId` can overwrite a newer one
 --> profile.tsx:8:5
  = fix: create a controller in the effect, pass its signal to `fetchUser(…)`, and abort it in the cleanup:
        const controller = new AbortController();
        fetchUser(…, controller.signal)
        return () => controller.abort();
```

An effect that runs once needs none of this, and TanStack Query, SWR and RTK Query cancel their own
requests. A loader with no signal states nothing; the add-on `react/effect-race` reports the
clearest case as a warning.

## List them

`stateward guarantees` lists every trait the code states, where it is stated, whether it is
proven, and what it covers:

```text
$ npx stateward guarantees
ThemeContext: RequiredContext<Theme>  src/contexts.ts:6
  stated by the project's marker
  proven for 2 readers
  readers:
    <Header>  src/Readers.tsx:4
    <Footer>  src/Readers.tsx:8

watchFeed: Release  src/feed.ts:3
  stated by the project's marker
  proven for 1 caller
  callers:
    feed.ts  src/feed.ts:9

session: Owned<{ user: string | null }>  src/session.ts:3
  stated by the project's marker
  not proven: 1 error
    src/toolbar.ts:9  `session` is changed outside its owner, `src/session.ts`
  writers:
    session.ts  src/session.ts:6
    toolbar.ts  src/toolbar.ts:9

3 guarantees: 2 proven, 1 not proven. `stateward check` shows each error with the path to it.
```

A release trait from a type or from facts is listed at each call, with its source: "stated by its
type, `Disposable`", "stated by stateward's facts for rxjs", "stated by the config's facts for
my-client".

- **Proven**: its rule ran and found nothing against it.
- **Not proven**: the errors against it, each at the place it fails. A baselined error still counts.
- **Unused**: nothing uses it, so there is nothing to prove; use it or drop the marker.
- **Not checked**: its rule is not on yet (with `rollout`); `stateward next` turns it on.

`--format json` prints the same for scripts, each entry with its `source`. The exit code is 1 when
a guarantee is not proven, so it can run in CI next to `check`.

## In the editor

In VS Code, a stated declaration shows its proof, from the last check:

- **Hover** the name: "Guaranteed: every reader is rendered under its Provider; proven for 2
  readers", or the first error and the steps that lead to it. For a trait from a type or facts, the
  hover names the source.
- **A code lens** above it, "2 readers proven · show", lists the places it covers; errors first.
- **Show proof path**, in the lightbulb of an error against a guarantee, steps through the path.
