import type { Fix, RelatedLocation } from "@stateward/core";
import { locationOf, type Resolved, type Wrap } from "./resolve.js";
import type { Dependency, Target } from "./summary.js";
import { fitted, MAX_HEADLINE, MAX_HINT, type Cut } from "./text.js";
import type { Fresh } from "./value.js";

/** How a message names a kind of value: "a new function", "a new object". */
export function noun(what: Fresh): string {
  return what === "function" ? "function" : what === "array" ? "array" : "object";
}

/** The hook that keeps a value of this kind between renders. */
export function wrapper(what: Fresh): string {
  return what === "function" ? "useCallback" : "useMemo";
}

/** What a new value each render costs where it is used. */
function consequence(target: Target, cut: (text: string) => string): string {
  if (target.kind === "memo-prop") return `\`<${cut(target.component)}>\` re-renders every time`;
  switch (target.hook) {
    case "useMemo":
      return "this `useMemo` reruns every render";
    case "useCallback":
      return "this callback changes every render";
    default:
      return "this effect runs after every render";
  }
}

type FreshValue = Extract<Resolved, { kind: "fresh" }>;
type UnknownValue = Extract<Resolved, { kind: "unknown" }>;

/**
 * The headline of a dependency made anew each render. The dependency is what the developer looks
 * at, so the call and the component are cut first; the dependency only when that is not enough.
 */
function headline(dependency: Dependency, source: string, what: Fresh): string {
  const build = (cut: Cut, dependencyCut: (text: string) => string): string =>
    `\`${dependencyCut(dependency.text)}\` from \`${cut.name(source)}\` is a new ${noun(what)} every render, so ${consequence(dependency.target, cut.name)}`;
  const kept = fitted((cut) => build(cut, (text) => text));
  return kept.length <= MAX_HEADLINE ? kept : fitted((cut) => build(cut, cut.name));
}

/**
 * The fix for a value a plain function returns: wrap the call to it in `useMemo` where it is
 * made, its arguments as dependencies; or, when an argument is itself new every render, say so,
 * since memoizing the call would not help.
 */
export function wrapCallHint(wrap: Wrap): string {
  const { call } = wrap;
  const place = (cut: Cut): string =>
    wrap.in.kind === "here"
      ? ""
      : ` inside \`${cut.name(wrap.in.owner.name)}\` (${cut.path(`${wrap.in.owner.relative}:${String(call.at.line)}`)}),`;
  const fresh = call.freshArgs[0];
  if (fresh !== undefined) {
    return fitted(
      (cut) =>
        `\`${cut.name(fresh)}\`, an argument of \`${cut.name(call.text)}\`, is new every render too: make it stable first, then wrap the call in \`useMemo\``,
    );
  }
  const memo = `useMemo(() => ${call.text}, [${call.args.join(", ")}])`;
  const full = fitted(
    (cut) => `wrap the call in \`useMemo\`${place(cut)} on its inputs: \`${memo}\``,
  );
  if (full.length <= MAX_HINT) return full;
  return fitted(
    (cut) =>
      `wrap \`${cut.name(call.text)}\` in \`useMemo\`${place(cut)} with its arguments as dependencies`,
  );
}

/** `a`, `a` and `b`, `a`, `b` and `c`. */
function listed(names: readonly string[]): string {
  const quoted = names.map((name) => `\`${name}\``);
  const last = quoted.at(-1) ?? "";
  return quoted.length < 2 ? last : `${quoted.slice(0, -1).join(", ")} and ${last}`;
}

/** The most names a "make them parameters" fix names. */
const MAX_PARAMETERS = 3;

type Advice = { hint: string; fixes: Fix[]; derived?: readonly string[] };

/** What the project says about a hook that keeps the latest handler in a ref: a name in `stableHooks`. */
function refHook(stableHooks: readonly string[]): string | undefined {
  return stableHooks.find((name) => /^use[A-Z0-9]\w*$/.test(name));
}

/**
 * The fix that matches why a value is new each render: a closure that captures nothing moves to
 * module scope; a result of a module-level function is wrapped in `useMemo`; a closure that
 * captures only parameters of its owner takes them as its own; a handler for a `memo` child is kept
 * in a ref; a value built from the state that caused the render is not worth stabilising.
 */
function adviceFor(
  dependency: Dependency,
  value: FreshValue,
  stableHooks: readonly string[],
): Advice | undefined {
  const { label, closure, derived } = value;
  if (derived.length > 0 && dependency.target.kind === "memo-prop") {
    return {
      hint: fitted(
        (cut) =>
          `stabilising it gains nothing: it really changes with ${listed(derived.map(cut.name))}`,
      ),
      fixes: [],
      derived,
    };
  }
  if (value.what !== "function" || closure === null || label === null) return undefined;
  if (closure.captures.length === 0 && !closure.hooks) {
    const { move } = closure;
    const fixes: Fix[] =
      move === null
        ? []
        : [
            {
              title: `Move \`${label}\` to module scope`,
              edits: [
                {
                  location: { file: value.owner.file, start: move.anchor, end: move.anchor },
                  newText: move.text,
                },
                {
                  location: {
                    file: value.owner.file,
                    start: move.remove.start,
                    end: move.remove.end,
                  },
                  newText: "",
                },
              ],
            },
          ];
    return {
      hint: fitted(
        (cut) =>
          `move \`${cut.name(label)}\` to module scope; it then never changes${fixes.length > 0 ? " (quick fix)" : ""}`,
      ),
      fixes,
    };
  }
  if (
    closure.params &&
    dependency.called &&
    closure.captures.length <= MAX_PARAMETERS &&
    !closure.hooks
  ) {
    const hint = fitted(
      (cut) =>
        `make ${listed(closure.captures.map(cut.name))} parameters of \`${cut.name(label)}\` and pass them where it is called`,
    );
    return { hint, fixes: [] };
  }
  if (dependency.target.kind === "memo-prop" && /^on[A-Z0-9]/.test(dependency.target.prop)) {
    const named = refHook(stableHooks);
    return {
      hint: fitted((cut) =>
        named === undefined
          ? "keep the latest handler in a ref (React's `useEffectEvent`, or your own hook)"
          : `keep the latest handler in a ref with \`${cut.name(named)}\``,
      ),
      fixes: [],
    };
  }
  return undefined;
}

/** `dependency-changes-every-render`: a dependency that is a new value each render. */
export function freshDependency(
  dependency: Dependency,
  source: string,
  value: FreshValue,
  stableHooks: readonly string[],
): { message: string; hint: string; related: RelatedLocation[]; fixes: Fix[]; derived: boolean } {
  const { owner, label, what, at } = value;
  const where = `${owner.relative}:${String(at.line)}`;
  const every = value.ownerHook ? "render" : "call";
  const advice = adviceFor(dependency, value, stableHooks);
  const state = advice?.derived;
  return {
    message:
      state === undefined
        ? headline(dependency, source, what)
        : fitted(
            (cut) =>
              `\`${cut.name(dependency.text)}\` from \`${cut.name(source)}\` is built from ${listed(state.map(cut.name))}, so it changes whenever ${state.length === 1 ? "that does" : "they do"}`,
          ),
    hint:
      advice?.hint ??
      (value.wrap !== null
        ? wrapCallHint(value.wrap)
        : fitted((cut) =>
            label === null
              ? `wrap the ${noun(what)} in \`${wrapper(what)}\` inside \`${cut.name(owner.name)}\` (${cut.path(where)})`
              : `wrap \`${cut.name(label)}\` in \`${wrapper(what)}\` inside \`${cut.name(owner.name)}\` (${cut.path(where)})`,
          )),
    fixes: advice?.fixes ?? [],
    derived: state !== undefined,
    related: [
      // Made in a hook by a plain function's call: the hook is where it is fixed, once for every caller.
      ...(value.wrap?.in.kind === "hook"
        ? [
            {
              location: locationOf(value.wrap.in.owner.file, value.wrap.call.at),
              message: `\`${value.wrap.call.text}\` makes it anew on every render of \`${value.wrap.in.owner.name}\``,
            },
          ]
        : []),
      {
        location: locationOf(owner.file, at),
        message:
          label === null
            ? `a new ${noun(what)} is created here on every ${every} of \`${owner.name}\``
            : `\`${label}\` is created here on every ${every} of \`${owner.name}\``,
      },
    ],
  };
}

/** `dependency-changes-every-render`: a dependency whose value comes from code stateward cannot follow. */
export function unknownDependency(
  dependency: Dependency,
  source: string,
  value: UnknownValue | undefined,
): { message: string; hint: string } {
  return {
    message: fitted(
      (cut) =>
        `stateward cannot tell whether \`${cut.name(dependency.text)}\` from \`${cut.name(source)}\` is a new value each render`,
    ),
    hint: fitted((cut) =>
      value === undefined
        ? `declare \`${cut.name(source.replace(/\(…?\)$/, ""))}\` as a function at module level (\`function useX() { … }\`) to make it checkable`
        : `\`${cut.name(value.owner.name)}\` gets it from \`${cut.name(value.text)}\` (${cut.path(`${value.owner.relative}:${String(value.at.line)}`)}); wrap that in \`useMemo\` to make it checkable`,
    ),
  };
}
