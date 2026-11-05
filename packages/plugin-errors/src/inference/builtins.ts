/**
 * What the language's own functions throw. Anything of the
 * platform (TypeScript's lib files, global declarations) that is not listed here is taken not to
 * throw: errors of the engine itself (reading a property of `undefined`, a stack overflow) are not
 * modelled, as Java does not declare its unchecked exceptions.
 */

/** The error classes of the platform; their ids are `builtin:<Name>`. */
export const BUILTIN_ERRORS: ReadonlySet<string> = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "ReferenceError",
  "EvalError",
  "AggregateError",
  "DOMException",
]);

const BUILTIN = "builtin:";
const DOM_EXCEPTION = `${BUILTIN}DOMException`;

export function builtinId(name: string): string {
  return `${BUILTIN}${name}`;
}

/** A `DOMException` with one `name` (`AbortError`): caught by `instanceof DOMException`. */
export function domExceptionId(name: string): string {
  return `${DOM_EXCEPTION}:${name}`;
}

export function isBuiltin(id: string): boolean {
  return id.startsWith(BUILTIN);
}

/**
 * The class a built-in error class extends: `Error` for every other one, `DOMException` for a
 * named `DOMException`; null for `Error`.
 */
export function builtinParent(id: string): string | null {
  if (id === builtinId("Error")) return null;
  if (id.startsWith(`${DOM_EXCEPTION}:`)) return DOM_EXCEPTION;
  return builtinId("Error");
}

/** How a class is shown: `TypeError`, `AbortError (DOMException)`. */
export function builtinName(id: string): string {
  if (id.startsWith(`${DOM_EXCEPTION}:`)) {
    return `${id.slice(DOM_EXCEPTION.length + 1)} (DOMException)`;
  }
  return id.slice(BUILTIN.length);
}

/** The class an `instanceof` test names to catch it: `DOMException` for `AbortError (DOMException)`. */
export function builtinCatchName(id: string): string {
  return id.startsWith(`${DOM_EXCEPTION}:`) ? "DOMException" : id.slice(BUILTIN.length);
}

const SYNTAX = builtinId("SyntaxError");
const TYPE = builtinId("TypeError");
const RANGE = builtinId("RangeError");
const URI = builtinId("URIError");

/** Methods of the platform's interfaces, as `<interface>.<method>`, that throw synchronously. */
export const THROWING_MEMBERS: ReadonlyMap<string, readonly string[]> = new Map([
  ["JSON.parse", [SYNTAX]],
  // A circular value, or a BigInt.
  ["JSON.stringify", [TYPE]],
  // A digit count outside 0 to 100.
  ["Number.toFixed", [RANGE]],
]);

/** Global functions that throw synchronously. */
export const THROWING_GLOBALS: ReadonlyMap<string, readonly string[]> = new Map([
  ["decodeURIComponent", [URI]],
  ["decodeURI", [URI]],
  ["structuredClone", [domExceptionId("DataCloneError")]],
  ["atob", [domExceptionId("InvalidCharacterError")]],
  // A fraction (RangeError), text that is not a number (SyntaxError), a symbol (TypeError).
  ["BigInt", [RANGE, SYNTAX, TYPE]],
]);

/** Global constructors that throw. */
export const THROWING_CONSTRUCTORS: ReadonlyMap<string, readonly string[]> = new Map([
  ["URL", [TYPE]],
]);

/** `Array(n)` and `new Array(n)` with one argument: a length that is not a valid one. */
export const ARRAY_LENGTH = [RANGE];

/** What `fetch` rejects with: a network failure, and an abort when a signal is passed. */
export const FETCH_REJECTS = [TYPE];
export const FETCH_ABORT = domExceptionId("AbortError");

/** What `Promise.any` rejects with when every promise rejects. */
export const ANY_REJECTS = builtinId("AggregateError");

/**
 * Methods and functions of the platform that call a callback before they return, as
 * `<interface>.<method>` (or the global's name), with the index of the argument that is the
 * callback: what it throws, the call throws. `replace`'s second argument and `JSON.stringify`'s
 * replacer may also be a string or a list; only a function there is a callback.
 */
export const SYNC_CALLBACKS: ReadonlyMap<string, number> = new Map([
  ...["Array", "ReadonlyArray"].flatMap((owner) =>
    [
      "map",
      "forEach",
      "filter",
      "reduce",
      "reduceRight",
      "some",
      "every",
      "find",
      "findIndex",
      "findLast",
      "findLastIndex",
      "flatMap",
      "toSorted",
    ].map((method): [string, number] => [`${owner}.${method}`, 0]),
  ),
  ["Array.sort", 0],
  ...["Map", "ReadonlyMap", "Set", "ReadonlySet"].map((owner): [string, number] => [
    `${owner}.forEach`,
    0,
  ]),
  ["ArrayConstructor.from", 1],
  ["String.replace", 1],
  ["String.replaceAll", 1],
  ["JSON.parse", 1],
  ["JSON.stringify", 1],
  ["ObjectConstructor.groupBy", 1],
  ["MapConstructor.groupBy", 1],
]);

/** Calls whose result holds what the callback returned (promises, for `Promise.all`). */
export const MAPPING_METHODS: ReadonlySet<string> = new Set([
  "Array.map",
  "ReadonlyArray.map",
  "Array.flatMap",
  "ReadonlyArray.flatMap",
  "ArrayConstructor.from",
]);

/**
 * Functions and constructors of the platform, by name, that run their callback later (a timer, an
 * event, an observer) or never (`removeEventListener`): what the callback throws never reaches
 * the caller, so it is left out on purpose. Its own catches are still checked.
 */
export const DEFERRED_CALLERS: ReadonlySet<string> = new Set([
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
  "addEventListener",
  "removeEventListener",
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "PerformanceObserver",
]);

/**
 * React's built-in hooks do not throw in correct use (misuse, like a hook called conditionally, is
 * a bug the rules-of-hooks lint finds, not part of their contract), so a call to one adds nothing.
 * Without this, every component would carry "unknown (package react)". `use()` is left out: it
 * rethrows a rejected promise.
 */
const NON_THROWING_REACT_HOOKS: ReadonlySet<string> = new Set([
  "useState",
  "useReducer",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useContext",
  "useId",
  "useTransition",
  "useDeferredValue",
  "useImperativeHandle",
  "useDebugValue",
  "useSyncExternalStore",
  "useOptimistic",
  "useActionState",
  "useFormStatus",
]);

/** Whether a call into package `name`, written `callText`, is one of React's non-throwing hooks. */
export function isNonThrowingReactHook(name: string, callText: string): boolean {
  if (name !== "react" && name !== "react-dom") return false;
  const callee = /([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(?/.exec(
    callText.split(".").pop() ?? "",
  )?.[1];
  return callee !== undefined && NON_THROWING_REACT_HOOKS.has(callee);
}
