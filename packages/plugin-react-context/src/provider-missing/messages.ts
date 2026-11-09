/** Every message of the rule, written once. Code is quoted in backticks. */

import type { ComputedFix, Origin } from "./summary.js";

export type Message = { message: string; hint: string };

/** A place not checked: what is not checked, why, and what would make it checkable. */
export type Unchecked = { what: string; why: string; hint: string };

/** The message of a place not checked (M19): `not checked: <what>: <why>`. */
export function notChecked(unchecked: Unchecked): Message {
  return { message: `not checked: ${unchecked.what}: ${unchecked.why}`, hint: unchecked.hint };
}

function code(text: string): string {
  return `\`${text}\``;
}

/** A fix with alternatives (M22): `one of`, then one bullet per way, each after the first with `or`. */
function oneOf(first: string, ...rest: readonly string[]): string {
  return ["one of", `- ${first}`, ...rest.map((way) => `- or ${way}`)].join("\n");
}

/** `A`, `A` and `B`, `A`, `B` and `C`. */
export function codeList(names: readonly string[]): string {
  const quoted = names.map(code);
  const last = quoted.at(-1) ?? "";
  return quoted.length < 2 ? last : `${quoted.slice(0, -1).join(", ")} and ${last}`;
}

export function missingProvider(component: string, context: string): Message {
  return {
    message: `${code(`<${component}>`)} is rendered without ${code(`${context}.Provider`)}`,
    hint: oneOf(
      `wrap it in ${code(`<${context}.Provider value={…}>`)}`,
      `render it inside a component that provides ${code(context)}`,
    ),
  };
}

const DYNAMIC_HINTS: Readonly<Record<Exclude<ComputedFix, object>, string>> = {
  plain:
    "render the component directly; constant maps are checked by the dynamic-components add-on",
  "add-addon": `add ${code('"react-context/dynamic-components"')} to ${code("addons")} in your stateward config`,
  narrow: oneOf(
    "render the component directly",
    `pick it from a ${code("const")} object by a key with a fixed set of values`,
  ),
};

export function computedComponent(tag: string, fix: ComputedFix): Unchecked {
  return {
    what: `the component behind ${code(`<${tag}>`)}`,
    why: "it is chosen at run time",
    hint:
      typeof fix === "string"
        ? DYNAMIC_HINTS[fix]
        : `if ${code(fix.name)} loads the page with ${code("lazy")}, add ${code(`lazyFunctions: [${JSON.stringify(fix.name)}]`)} to the options of ${code("react-context/provider-missing")}`,
  };
}

export function classComponent(tag: string): Unchecked {
  return {
    what: `the components under ${code(`<${tag}>`)}`,
    why: "it is a class component, and class components are not followed",
    hint: "render the components that read contexts as function components inside it",
  };
}

export function routerNotFollowed(): Unchecked {
  return {
    what: "the components of React Router routes",
    why: "the react-router add-on is off",
    hint: `add ${code('"react-context/react-router"')} to ${code("addons")} in your stateward config`,
  };
}

export function externalContext(name: string): Message {
  return {
    message: `not checked: the Providers of ${code(name)}: it is declared outside the checked files`,
    hint: "add the package that declares it to the tsconfig stateward checks",
  };
}

export function escapingJsx(tag: string, sink: string): Unchecked {
  return {
    what: `where ${code(`<${tag}>`)} renders`,
    why: `it is passed to ${code(sink)}`,
    hint: "render it in JSX under the Provider it needs",
  };
}

export function unreachableComponent(component: string, contexts: readonly string[]): Message {
  return {
    message: `not checked: whether ${code(component)} is under the ${contexts.length === 1 ? "Provider" : "Providers"} of ${codeList(contexts)}: no entry point renders it`,
    hint: oneOf(
      "render it from the app",
      `list it in ${code("entries")} in the react-context options`,
    ),
  };
}

export function noEntryPoint(contexts: readonly string[]): Message {
  return {
    message: `not checked: the Providers of ${codeList(contexts)}: no entry point is found`,
    hint: oneOf(
      `render the app with ${code("createRoot(…).render(<App/>)")}`,
      `list the entry point in ${code("entries")} in the react-context options`,
    ),
  };
}

export function entryMatchesNoComponent(file: string, exportName: string): Message {
  return {
    message: `not checked: entry ${code(`${file}#${exportName}`)}: it matches no component`,
    hint: `check the file and export name in ${code("entries")}`,
  };
}

export function providesMatchesNoContext(file: string, exportName: string, name: string): Message {
  return {
    message: `not checked: ${code(name)} from entry ${code(`${file}#${exportName}`)}: it is not a required context`,
    hint: `use the name of a required context in ${code("provides")}: one created with no default and read through a check, or stated ${code("RequiredContext")}`,
  };
}

export const notes = {
  rendered: (tag: string): string => `${code(`<${tag}>`)} is rendered`,
  called: (hook: string): string => `${code(hook)} is called`,
  reads: (reader: string, context: string): string => `${code(reader)} reads ${code(context)}`,
  slot: (owner: string, slot: string): string =>
    `${code(owner)} renders its ${code(slot)} outside the Provider`,
  /** Why a dynamic tag renders `target`: `panels["profile"] is <Profile>`, `Panel may be <A>`. */
  origin: (origin: Origin, target: string): string =>
    `${code(origin.label)} ${origin.kind === "entry" ? "is" : "may be"} ${code(`<${target}>`)}`,
  more: (count: number): string => `… ${String(count)} more steps …`,
};

/** The guarantee a `RequiredContext` states, as messages name it. */
const STATED = "stated required";

/** `AuthCtx` (stated required), `AuthCtx` and `ThemeCtx` (stated required). */
function statedList(contexts: readonly string[]): string {
  return `${codeList(contexts)} (${STATED})`;
}

export function unreachableStated(component: string, contexts: readonly string[]): Message {
  return {
    message: `${code(component)} reads ${statedList(contexts)}, but no entry point renders it`,
    hint: oneOf(
      "render it from the app, under the Provider",
      `list it in ${code("entries")} in the react-context options`,
    ),
  };
}

export function noEntryPointStated(contexts: readonly string[]): Message {
  return {
    message: `${statedList(contexts)} cannot be proven: no entry point is found`,
    hint: oneOf(
      `render the app with ${code("createRoot(…).render(<App/>)")}`,
      `list the entry point in ${code("entries")} in the react-context options`,
    ),
  };
}

/**
 * A place that cannot be followed, where a stated context is not proven: the "not checked"
 * message of that place, now an error, with how to make it provable.
 */
const PROP = "pass the value to the component as a prop instead of through the context";

export function unprovable(base: Unchecked, contexts: readonly string[]): Message {
  const verb = contexts.length === 1 ? "is" : "are";
  return {
    message: `${statedList(contexts)} ${verb} not proven: ${base.what} cannot be followed`,
    hint: base.hint.startsWith("one of\n") ? `${base.hint}\n- or ${PROP}` : oneOf(base.hint, PROP),
  };
}

export function guardNotNeeded(hook: string, context: string): Message {
  return {
    message: `${code(hook)} checks ${code(context)} at run time, but every reader is proven under its Provider`,
    hint: `remove the check: ${code(context)} is ${STATED}, so its value is always there`,
  };
}

export const fixTitles = {
  declare: (context: string, call: string): string => `State ${context} required: ${call}`,
  dropGuard: (hook: string): string => `Remove the run-time check in ${hook}`,
};

export const guaranteeNotes = {
  stated: (context: string): string =>
    `${code(context)} is ${STATED}: every reader must be proven under its Provider`,
};
