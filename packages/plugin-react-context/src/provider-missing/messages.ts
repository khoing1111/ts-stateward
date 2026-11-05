/** Every message of the rule, written once. Code is quoted in backticks. */

import type { ComputedFix, Origin } from "./summary.js";

export type Message = { message: string; hint: string };

function code(text: string): string {
  return `\`${text}\``;
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
    hint: `wrap it in ${code(`<${context}.Provider value={…}>`)}, or render it inside a component that provides it`,
  };
}

const DYNAMIC_HINTS: Readonly<Record<Exclude<ComputedFix, object>, string>> = {
  plain:
    "render the component directly; constant maps are checked by the dynamic-components add-on",
  "add-addon": `add ${code('"react-context/dynamic-components"')} to ${code("addons")} in your stateward config`,
  narrow: `render the component directly, or pick it from a ${code("const")} object by a key of a finite type`,
};

export function computedComponent(tag: string, fix: ComputedFix): Message {
  return {
    message: `stateward cannot tell which component ${code(`<${tag}>`)} is`,
    hint:
      typeof fix === "string"
        ? DYNAMIC_HINTS[fix]
        : `if ${code(fix.name)} loads the page with ${code("lazy")}, add ${code(`lazyFunctions: [${JSON.stringify(fix.name)}]`)} to the options of ${code("react-context/provider-missing")}`,
  };
}

export function classComponent(tag: string): Message {
  return {
    message: `stateward does not check class components like ${code(`<${tag}>`)}`,
    hint: "render the components that read contexts as function components inside it",
  };
}

export function routerNotFollowed(): Message {
  return {
    message: "stateward does not follow React Router routes without the react-router add-on",
    hint: `add ${code('"react-context/react-router"')} to ${code("addons")} in your stateward config`,
  };
}

export function externalContext(name: string): Message {
  return {
    message: `${code(name)} is declared outside the checked files, so its Providers are not checked`,
    hint: "add the package that declares it to the tsconfig stateward checks",
  };
}

export function escapingJsx(tag: string, sink: string): Message {
  return {
    message: `${code(`<${tag}>`)} is passed to ${code(sink)}, so stateward cannot tell where it renders`,
    hint: "render it in JSX under the Provider it needs",
  };
}

export function unreachableComponent(component: string, contexts: readonly string[]): Message {
  return {
    message: `${code(component)} needs ${codeList(contexts)}, but no entry point renders it`,
    hint: `render it from your app, or list it in ${code("entries")} in the react-context options`,
  };
}

export function noEntryPoint(contexts: readonly string[]): Message {
  const verb = contexts.length === 1 ? "is" : "are";
  return {
    message: `stateward found no entry point, so ${codeList(contexts)} ${verb} not checked`,
    hint: `render your app with ${code("createRoot(…).render(<App/>)")}, or list it in ${code("entries")} in the react-context options`,
  };
}

export function entryMatchesNoComponent(file: string, exportName: string): Message {
  return {
    message: `entry ${code(`${file}#${exportName}`)} matches no component`,
    hint: `check the file and export name in ${code("entries")}`,
  };
}

export function providesMatchesNoContext(file: string, exportName: string, name: string): Message {
  return {
    message: `entry ${code(`${file}#${exportName}`)} provides ${code(name)}, which is not a required context`,
    hint: `check the names in ${code("provides")} against your required contexts (made with no default, read through a check)`,
  };
}

export const notes = {
  rendered: (tag: string): string => `${code(`<${tag}>`)} is rendered here`,
  called: (hook: string): string => `${code(hook)} is called here`,
  reads: (reader: string, context: string): string => `${code(reader)} reads ${code(context)}`,
  slot: (owner: string, slot: string): string =>
    `${code(owner)} renders its ${code(slot)} here, not under the Provider`,
  /** Why a dynamic tag renders `target`: `panels["profile"] is <Profile>`, `Panel may be <A>`. */
  origin: (origin: Origin, target: string): string =>
    `${code(origin.label)} ${origin.kind === "entry" ? "is" : "may be"} ${code(`<${target}>`)}`,
  more: (count: number): string => `… ${String(count)} more steps …`,
};
