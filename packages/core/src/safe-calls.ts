/**
 * Calls of the platform that do not throw on values their types allow: the closed list the proofs
 * share. An entry holds only on the platform's own types, as the type checker sees them: the value
 * a method is called on is typed by the platform's type itself (not an interface or a class of the
 * project, and not a type the project extends), and the arguments' types make the call safe
 * (`String(x)` on a primitive, `join` on an array of primitives). Every other call of the platform
 * or a package may throw (`new URL("x")`, `[].reduce(add)`, `JSON.parse(text)`, `n.toString(36)`,
 * `headers.set(…)`). A function of the project is not on the list: a proof reads it, or counts it
 * as a call that may throw. Core knows no library; these are the language's own built-ins.
 */
import ts from "typescript";
import type { TypeQueries } from "./types.js";

/** What the arguments of a call on the list must be. */
type Arguments =
  /** Anything its type allows. */
  | "any"
  /** None. */
  | "none"
  /** Primitives (not a symbol): a value converted to a string or number cannot run code. */
  | "primitive"
  /** Numbers (not a `bigint`). */
  | "number"
  /** An array of primitives, or none. */
  | "primitive-array"
  /** Primitives, or a function written in place (the caller reads it), or a `RegExp`. */
  | "primitive-or-callback"
  /** One value whose type is known: not `any` or `unknown` (`Object.keys(null)` throws). */
  | "known"
  /** One number literal from 0 to 100: the digits `toFixed` accepts. */
  | "digits"
  /** One array, or an iterator of a `Map` or `Set` (`m.values()`). */
  | "iterated";

/** Global functions, by name. */
const GLOBALS: ReadonlyMap<string, Arguments> = new Map([
  ["setTimeout", "any"],
  ["clearTimeout", "any"],
  ["setInterval", "any"],
  ["clearInterval", "any"],
  ["queueMicrotask", "any"],
  ["String", "primitive"],
  ["Number", "primitive"],
  ["Boolean", "any"],
  ["isNaN", "number"],
  ["isFinite", "number"],
  ["parseInt", "primitive"],
  ["parseFloat", "primitive"],
]);

/** Constructors, by the platform's name of the constructor's type. */
const CONSTRUCTORS: ReadonlyMap<string, Arguments> = new Map([
  ["PromiseConstructor", "any"],
  ["MapConstructor", "none"],
  ["SetConstructor", "primitive-array"],
  ["WeakMapConstructor", "none"],
  ["WeakSetConstructor", "none"],
  ["ErrorConstructor", "primitive"],
  ["DateConstructor", "primitive"],
  ["AbortControllerConstructor", "none"],
]);

/** Methods, by the platform's name of the type they are called on, then by name. */
const METHOD_TABLE = {
  Console: [["*", "any"]],
  Math: [["*", "number"]],
  ObjectConstructor: [
    ["keys", "known"],
    ["values", "known"],
    ["entries", "known"],
    ["freeze", "any"],
    ["is", "any"],
  ],
  ArrayConstructor: [
    ["isArray", "any"],
    ["from", "iterated"],
  ],
  DateConstructor: [["now", "none"]],
  NumberConstructor: [
    ["isFinite", "any"],
    ["isNaN", "any"],
    ["isInteger", "any"],
    ["isSafeInteger", "any"],
    ["parseInt", "primitive"],
    ["parseFloat", "primitive"],
  ],
  PromiseConstructor: [
    ["resolve", "primitive"],
    ["allSettled", "any"],
  ],
  Promise: [
    ["then", "any"],
    ["catch", "any"],
    ["finally", "any"],
  ],
  AbortController: [["abort", "any"]],
  Array: arrayMethods(),
  ReadonlyArray: arrayMethods(),
  Map: mapMethods(),
  ReadonlyMap: [
    ["get", "any"],
    ["has", "any"],
    ["keys", "none"],
    ["values", "none"],
    ["entries", "none"],
  ],
  Set: [
    ["add", "any"],
    ["has", "any"],
    ["delete", "any"],
    ["clear", "none"],
    ["keys", "none"],
    ["values", "none"],
    ["entries", "none"],
    ["forEach", "any"],
  ],
  ReadonlySet: [
    ["has", "any"],
    ["keys", "none"],
    ["values", "none"],
    ["entries", "none"],
  ],
  WeakMap: [
    ["get", "any"],
    ["set", "any"],
    ["has", "any"],
    ["delete", "any"],
  ],
  WeakSet: [
    ["add", "any"],
    ["has", "any"],
    ["delete", "any"],
  ],
  String: [
    ["toUpperCase", "none"],
    ["toLowerCase", "none"],
    ["trim", "none"],
    ["trimStart", "none"],
    ["trimEnd", "none"],
    ["startsWith", "primitive"],
    ["endsWith", "primitive"],
    ["includes", "primitive"],
    ["indexOf", "primitive"],
    ["split", "primitive-or-callback"],
    ["replace", "primitive-or-callback"],
    ["replaceAll", "primitive"],
    ["padStart", "primitive"],
    ["padEnd", "primitive"],
    ["charAt", "primitive"],
    ["charCodeAt", "primitive"],
    ["substring", "primitive"],
    ["slice", "primitive"],
    ["at", "primitive"],
    ["concat", "primitive"],
    ["toString", "none"],
  ],
  // The getters of a date: an invalid date gives `NaN`, it does not throw (`toISOString` does).
  Date: [
    "getTime",
    "getFullYear",
    "getMonth",
    "getDate",
    "getDay",
    "getHours",
    "getMinutes",
    "getSeconds",
    "getMilliseconds",
    "getTimezoneOffset",
    "getUTCFullYear",
    "getUTCMonth",
    "getUTCDate",
    "getUTCDay",
    "getUTCHours",
    "getUTCMinutes",
    "getUTCSeconds",
    "getUTCMilliseconds",
  ].map((name): readonly [string, Arguments] => [name, "none"]),
  Number: [
    ["toFixed", "digits"],
    ["toString", "none"],
    ["valueOf", "none"],
  ],
  Boolean: [
    ["toString", "none"],
    ["valueOf", "none"],
  ],
} satisfies Readonly<Record<string, readonly (readonly [string, Arguments])[]>>;

const METHODS: ReadonlyMap<string, ReadonlyMap<string, Arguments>> = new Map(
  Object.entries(METHOD_TABLE).map(([owner, methods]): [string, ReadonlyMap<string, Arguments>] => [
    owner,
    new Map(methods),
  ]),
);

function arrayMethods(): (readonly [string, Arguments])[] {
  return [
    ["map", "any"],
    ["filter", "any"],
    ["forEach", "any"],
    ["some", "any"],
    ["every", "any"],
    ["find", "any"],
    ["findIndex", "any"],
    ["findLast", "any"],
    ["findLastIndex", "any"],
    ["includes", "any"],
    ["indexOf", "any"],
    ["lastIndexOf", "any"],
    ["slice", "any"],
    ["push", "any"],
    ["pop", "none"],
    ["shift", "none"],
    ["unshift", "any"],
    ["flat", "any"],
    ["flatMap", "any"],
    ["keys", "none"],
    ["values", "none"],
    ["entries", "none"],
    ["at", "any"],
    ["reverse", "none"],
  ];
}

function mapMethods(): (readonly [string, Arguments])[] {
  return [
    ["get", "any"],
    ["set", "any"],
    ["has", "any"],
    ["delete", "any"],
    ["clear", "none"],
    ["keys", "none"],
    ["values", "none"],
    ["entries", "none"],
    ["forEach", "any"],
  ];
}

function stripped(expression: ts.Expression): ts.Expression {
  let node = expression;
  while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
    node = node.expression;
  }
  return node;
}

function isWrittenFunction(node: ts.Expression): boolean {
  const inner = stripped(node);
  return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner);
}

function argumentsAllowed(
  call: ts.CallExpression | ts.NewExpression,
  allowed: Arguments,
  types: TypeQueries,
): boolean {
  const given = call.arguments ?? [];
  if (given.some(ts.isSpreadElement)) return false;
  switch (allowed) {
    case "any":
      return true;
    case "none":
      return given.length === 0;
    case "primitive":
      // A value typed `never` is in code the types say does not run (`String(unexpected)`).
      return given.every((one) => types.isPrimitive(one) || types.typeTextOf(one) === "never");
    case "number":
      return given.every((one) => types.isNumber(one));
    case "primitive-array":
      return given.every((one) => types.arrayElementsOf(one) === "primitives");
    case "primitive-or-callback":
      return given.every(
        (one) =>
          types.isPrimitive(one) ||
          isWrittenFunction(one) ||
          types.platformTypeOf(one) === "RegExp",
      );
    case "known":
      return given.length === 1 && given.every((one) => !OPEN_TYPES.has(types.typeTextOf(one)));
    case "digits":
      return given.length === 1 && given.every(isDigits);
    case "iterated":
      return (
        given.length === 1 &&
        given.every(
          (one) => types.arrayElementsOf(one) !== undefined || isCollectionIterator(one, types),
        )
      );
  }
}

/** Types that say nothing of the value. */
const OPEN_TYPES: ReadonlySet<string> = new Set(["any", "unknown"]);

/** A whole number literal from 0 to 100, as `toFixed` accepts. */
function isDigits(node: ts.Expression): boolean {
  const inner = stripped(node);
  if (!ts.isNumericLiteral(inner)) return false;
  const value = Number(inner.text);
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

/** The collections whose `keys()`, `values()` and `entries()` iterate without running code. */
const COLLECTIONS: ReadonlySet<string> = new Set(["Map", "ReadonlyMap", "Set", "ReadonlySet"]);

/**
 * Whether an expression is `keys()`, `values()` or `entries()` called on the platform's own
 * `Map` or `Set` (`m.values()`): an iterator that runs no code of the project.
 */
function isCollectionIterator(node: ts.Expression, types: TypeQueries): boolean {
  const call = stripped(node);
  if (!ts.isCallExpression(call) || call.arguments.length > 0) return false;
  const callee = stripped(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.name)) return false;
  const owner = types.platformTypeOf(stripped(callee.expression));
  return (
    ["keys", "values", "entries"].includes(callee.name.text) &&
    owner !== undefined &&
    COLLECTIONS.has(owner) &&
    types.isPlatformName(callee.name)
  );
}

/**
 * Whether a `for…of` over an expression runs no code of the project and cannot throw: over the
 * platform's array, a string, or an iterator of a `Map` or `Set` (`for (const v of m.values())`).
 */
export function iteratesPlainly(node: ts.Expression, types: TypeQueries): boolean {
  return (
    types.arrayElementsOf(node) !== undefined ||
    types.platformTypeOf(node) === "String" ||
    isCollectionIterator(node, types)
  );
}

/** The methods of an array whose arguments decide whether they can throw. */
function arrayCallIsSafe(
  call: ts.CallExpression,
  name: string,
  receiver: ts.Expression,
  types: TypeQueries,
): boolean | undefined {
  const given = call.arguments;
  switch (name) {
    // Converts each element to a string.
    case "join":
    case "toString":
      return (
        types.arrayElementsOf(receiver) === "primitives" &&
        given.every((one) => types.isPrimitive(one))
      );
    // An empty array with no first value throws.
    case "reduce":
    case "reduceRight":
      return given.length === 2;
    // With no comparer, each element is converted to a string.
    case "sort":
      return given.length === 1 || types.arrayElementsOf(receiver) === "primitives";
    // Reads `Symbol.isConcatSpreadable` of each argument.
    case "concat":
      return given.every(
        (one) => types.isPrimitive(one) || types.arrayElementsOf(one) !== undefined,
      );
    default:
      return undefined;
  }
}

/**
 * Whether a call or `new` is on the closed list of the platform's calls that do not throw, on the
 * platform's own types: `console.log(…)`, `Math.max(a, b)` on numbers, `Object.keys(…)` on a
 * known type, `new Map()`, `list.push(…)` on an array, `String(x)` on a primitive, `d.getTime()`,
 * `n.toFixed(2)`, `Array.from(xs)` on an array, a string method on a branded string. The caller checks what a
 * callback given to the call does.
 */
export function isSafePlatformCall(
  node: ts.CallExpression | ts.NewExpression,
  types: TypeQueries,
): boolean {
  const callee = stripped(node.expression);
  if (ts.isNewExpression(node)) {
    const owner = types.platformTypeOf(callee);
    const allowed = owner === undefined ? undefined : CONSTRUCTORS.get(owner);
    return allowed !== undefined && argumentsAllowed(node, allowed, types);
  }
  if (ts.isIdentifier(callee)) {
    const allowed = GLOBALS.get(callee.text);
    return (
      allowed !== undefined &&
      types.isPlatformName(callee) &&
      argumentsAllowed(node, allowed, types)
    );
  }
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.name)) return false;
  const name = callee.name.text;
  const receiver = stripped(callee.expression);
  const owner = types.platformTypeOf(receiver);
  if (owner === undefined || !types.isPlatformName(callee.name)) return false;
  if (owner === "Array" || owner === "ReadonlyArray") {
    const decided = arrayCallIsSafe(node, name, receiver, types);
    if (decided !== undefined) return decided;
  }
  const methods = METHODS.get(owner);
  const allowed = methods?.get(name) ?? methods?.get("*");
  return allowed !== undefined && argumentsAllowed(node, allowed, types);
}
