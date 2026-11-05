import type { FactSource, Json } from "@stateward/core";

/**
 * The throws facts of one file: JSON, so the engine can cache it
 * under the file's dependency fingerprint. Every id is a qualified id (`src/api.ts#Api.get`) or,
 * for the language's own error classes, `builtin:<Name>` (`builtin:TypeError`,
 * `builtin:DOMException:AbortError` for a named `DOMException`).
 */

/** A start and end offset in the summarized file. */
export type Span = readonly [number, number];

/**
 * A class that is thrown or caught in the file, with the class it extends: `parent` is null for a
 * class that extends nothing, and `open` is true when what it extends cannot be followed (a
 * mixin call, an unresolved name), so whether an `instanceof` test catches it is not known.
 */
export type ClassFact = {
  readonly id: string;
  readonly name: string;
  readonly parent: string | null;
  readonly open: boolean;
};

/** Which part of a called function's result a call adds: what it throws, rejects, or both. */
export type Part = "throws" | "rejects" | "both";

/** One side of a package function's facts: the classes it gives, and why the rest is unknown. */
export type Side = { readonly classes: readonly string[]; readonly unknown: readonly string[] };

/**
 * What a call into a package throws and rejects with, and where that is known from
 *: class ids are `builtin:<Name>` or `package:<package>#<Name>`; an
 * unknown is one of the fixed reasons (`UNKNOWN_REASONS`, packages.ts).
 */
export type PackageFacts = {
  readonly name: string;
  /** "" when the package's version cannot be read. */
  readonly version: string;
  /** The function's path in the package's types: `remote`, `Client.get`. */
  readonly fn: string;
  readonly source: FactSource;
  readonly throws: Side;
  readonly rejects: Side;
};

/** Something that adds to what the code around it throws. */
export type Leaf =
  /** `throw new X(…)`, or a built-in that throws X; `text` is the call that does, null for a `throw`. */
  | { readonly k: "class"; readonly id: string; readonly text: string | null; readonly at: Span }
  /** What cannot be followed, and why (`no declaration`, `callback of unknown origin`, …). */
  | { readonly k: "unknown"; readonly reason: string; readonly text: string; readonly at: Span }
  /**
   * A callback handed to a call of the platform that may or may not run it before it returns:
   * unknown, for `reason`, when `body` (what the callback throws and rejects with) is not empty.
   */
  | {
      readonly k: "maybe";
      readonly reason: string;
      readonly text: string;
      readonly body: readonly Effect[];
      readonly at: Span;
    }
  /** A call of a function of the project: adds `part` of what it throws. */
  | {
      readonly k: "call";
      readonly id: string;
      readonly part: Part;
      readonly text: string;
      readonly at: Span;
    }
  /** A call into a package: adds `part` of its facts (`throws` where it is called, `rejects` when awaited). */
  | {
      readonly k: "package";
      readonly facts: PackageFacts;
      readonly part: "throws" | "rejects";
      readonly text: string;
      readonly at: Span;
    }
  /**
   * `throw e` of the variable of the catch that starts at `of`: rethrows what reaches it there.
   * `maybe` when the throw sits under a test this analysis does not read.
   */
  | { readonly k: "rethrow"; readonly of: number; readonly maybe: boolean; readonly at: Span };

/** One `if (e instanceof A || e instanceof B)` link, or one `case` of a `switch (true)`. */
export type Branch = {
  /** The classes the test names; `exact` when the test is only `instanceof` tests joined by `||`. */
  readonly classes: readonly string[];
  readonly exact: boolean;
  readonly body: readonly Effect[];
  /** Ends with `return` or `throw`: the statements after the chain do not run for it. */
  readonly exits: boolean;
};

export type Handler = {
  /** The `catch` keyword. */
  readonly at: Span;
  /** The catch's `{ … }` block, braces included (the quick fix wraps what is inside). */
  readonly block: Span;
  /** Where the catch variable is declared, the key of its rethrows; -1 for `catch {`. */
  readonly of: number;
  readonly variable: string | null;
  /** How the catch branches on the error: an `if` chain or a `switch (true)` (`if` when it does not). */
  readonly dispatch: "if" | "switch";
  /** The statements before the `instanceof` chain or switch. */
  readonly pre: readonly Effect[];
  readonly branches: readonly Branch[];
  /** The final `else` or `default`; null when there is none. */
  readonly otherwise: readonly Effect[] | null;
  readonly otherwiseExits: boolean;
  /** The statements after the chain (the whole block when the catch has no chain). */
  readonly after: readonly Effect[];
  /** Whether what the chain does not handle reaches a `throw` (a rethrow or a wrap). */
  readonly restThrows: boolean;
  /**
   * Whether what the chain does not handle reaches code that uses the caught variable (passes it
   * on, logs it, stores it, reads a property): a final `else` or the code after the chain.
   */
  readonly restUsed: boolean;
};

export type Try = {
  readonly k: "try";
  readonly at: Span;
  readonly body: readonly Effect[];
  readonly handler: Handler | null;
  readonly fin: readonly Effect[];
};

export type Effect = Leaf | Try;

/** One class a `@throws` tag names: its id, or null when the name resolves to no class. */
export type DocEntry = { readonly id: string | null; readonly name: string; readonly at: Span };

/** The `@throws` tags of a function. */
export type Doc = {
  readonly entries: readonly DocEntry[];
  /** A tag without a type (`@throws when …`): it says the function throws, not what. */
  readonly untyped: readonly Span[];
};

export type FunctionFact = {
  readonly id: string;
  readonly name: string;
  /** The function's name. */
  readonly at: Span;
  readonly async: boolean;
  /**
   * Its `@throws` says what the promise it returns rejects with: it is `async`, or it has a
   * `@throws` and returns a promise (declared or inferred). False for an undocumented function
   * that is not `async`, whose body's own throws are synchronous whatever it returns.
   */
  readonly promise: boolean;
  readonly doc: Doc | null;
  /** A function or arrow declared inside another function: only that function's code can call it. */
  readonly local: boolean;
  /** What runs when it is called: thrown where it happens. */
  readonly body: readonly Effect[];
  /** What the promise it returns rejects with (`return fetch(…)`), outside any `try`. */
  readonly returns: readonly Effect[];
};

export type ThrowsSummary = {
  readonly classes: readonly ClassFact[];
  readonly functions: readonly FunctionFact[];
  /** The code at the top of the module, outside any function: its catches are checked too. */
  readonly module: readonly Effect[];
};

// ---- reading summaries back ---------------------------------------------------------------------

export type Fields = Readonly<Record<string, Json>>;

function isList(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

export function fieldsOf(value: Json): Fields | undefined {
  if (typeof value !== "object" || value === null || isList(value)) return undefined;
  return value;
}

function listOf(value: Json | undefined): readonly Json[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function isString(value: Json | undefined): value is string {
  return typeof value === "string";
}

export function spanOf(value: Json | undefined): Span | undefined {
  const list = listOf(value);
  if (list?.length !== 2) return undefined;
  const [start, end] = list;
  return typeof start === "number" && typeof end === "number" ? [start, end] : undefined;
}

export function each<T>(
  value: Json | undefined,
  read: (item: Json) => T | undefined,
): T[] | undefined {
  const list = listOf(value);
  if (list === undefined) return undefined;
  const out: T[] = [];
  for (const item of list) {
    const one = read(item);
    if (one === undefined) return undefined;
    out.push(one);
  }
  return out;
}

function readPart(value: Json | undefined): Part | undefined {
  return value === "throws" || value === "rejects" || value === "both" ? value : undefined;
}

export function readStrings(value: Json | undefined): string[] | undefined {
  return each(value, (item) => (isString(item) ? item : undefined));
}

function readSide(value: Json | undefined): Side | undefined {
  const f = value === undefined ? undefined : fieldsOf(value);
  const classes = readStrings(f?.classes);
  const unknown = readStrings(f?.unknown);
  return classes === undefined || unknown === undefined ? undefined : { classes, unknown };
}

const SOURCES = ["config", "declared", "inferred", "unknown"] as const;

function readSource(value: Json | undefined): FactSource | undefined {
  return SOURCES.find((source) => source === value);
}

/** Package facts as `PackageFacts` writes them; undefined for anything else. */
export function readPackageFacts(value: Json | undefined): PackageFacts | undefined {
  const f = value === undefined ? undefined : fieldsOf(value);
  if (f === undefined || !isString(f.name) || !isString(f.version) || !isString(f.fn)) {
    return undefined;
  }
  const source = readSource(f.source);
  const throws = readSide(f.throws);
  const rejects = readSide(f.rejects);
  if (source === undefined || throws === undefined || rejects === undefined) return undefined;
  return { name: f.name, version: f.version, fn: f.fn, source, throws, rejects };
}

function readEffect(value: Json): Effect | undefined {
  const f = fieldsOf(value);
  const at = spanOf(f?.at);
  if (f === undefined || at === undefined || !isString(f.k)) return undefined;
  switch (f.k) {
    case "class":
      return isString(f.id) && (f.text === null || isString(f.text))
        ? { k: "class", id: f.id, text: f.text, at }
        : undefined;
    case "unknown":
      return isString(f.reason) && isString(f.text)
        ? { k: "unknown", reason: f.reason, text: f.text, at }
        : undefined;
    case "call": {
      const part = readPart(f.part);
      return isString(f.id) && isString(f.text) && part !== undefined
        ? { k: "call", id: f.id, part, text: f.text, at }
        : undefined;
    }
    case "package": {
      const facts = readPackageFacts(f.facts);
      return facts !== undefined &&
        isString(f.text) &&
        (f.part === "throws" || f.part === "rejects")
        ? { k: "package", facts, part: f.part, text: f.text, at }
        : undefined;
    }
    case "maybe": {
      const body = each(f.body, readEffect);
      return isString(f.reason) && isString(f.text) && body !== undefined
        ? { k: "maybe", reason: f.reason, text: f.text, body, at }
        : undefined;
    }
    case "rethrow":
      return typeof f.of === "number" && typeof f.maybe === "boolean"
        ? { k: "rethrow", of: f.of, maybe: f.maybe, at }
        : undefined;
    case "try": {
      const body = each(f.body, readEffect);
      const fin = each(f.fin, readEffect);
      const handler = f.handler === null ? null : readHandler(f.handler);
      return body === undefined || fin === undefined || handler === undefined
        ? undefined
        : { k: "try", at, body, handler, fin };
    }
    default:
      return undefined;
  }
}

function readBranch(value: Json): Branch | undefined {
  const f = fieldsOf(value);
  if (f === undefined) return undefined;
  const classes = each(f.classes, (item) => (isString(item) ? item : undefined));
  const body = each(f.body, readEffect);
  if (classes === undefined || body === undefined) return undefined;
  if (typeof f.exact !== "boolean" || typeof f.exits !== "boolean") return undefined;
  return { classes, exact: f.exact, body, exits: f.exits };
}

function readHandler(value: Json | undefined): Handler | undefined {
  const f = value === undefined ? undefined : fieldsOf(value);
  const at = spanOf(f?.at);
  const block = spanOf(f?.block);
  if (f === undefined || at === undefined || block === undefined) return undefined;
  const pre = each(f.pre, readEffect);
  const branches = each(f.branches, readBranch);
  const after = each(f.after, readEffect);
  const otherwise = f.otherwise === null ? null : each(f.otherwise, readEffect);
  if (pre === undefined || branches === undefined || after === undefined) return undefined;
  if (otherwise === undefined || typeof f.of !== "number") return undefined;
  if (typeof f.otherwiseExits !== "boolean" || typeof f.restThrows !== "boolean") return undefined;
  if (typeof f.restUsed !== "boolean") return undefined;
  if (f.variable !== null && !isString(f.variable)) return undefined;
  if (f.dispatch !== "if" && f.dispatch !== "switch") return undefined;
  return {
    at,
    block,
    of: f.of,
    variable: f.variable,
    dispatch: f.dispatch,
    pre,
    branches,
    otherwise,
    otherwiseExits: f.otherwiseExits,
    after,
    restThrows: f.restThrows,
    restUsed: f.restUsed,
  };
}

function readDoc(value: Json | undefined): Doc | null | undefined {
  if (value === null) return null;
  const f = value === undefined ? undefined : fieldsOf(value);
  if (f === undefined) return undefined;
  const entries = each(f.entries, (item): DocEntry | undefined => {
    const entry = fieldsOf(item);
    const at = spanOf(entry?.at);
    if (entry === undefined || at === undefined || !isString(entry.name)) return undefined;
    if (entry.id !== null && !isString(entry.id)) return undefined;
    return { id: entry.id, name: entry.name, at };
  });
  const untyped = each(f.untyped, spanOf);
  return entries === undefined || untyped === undefined ? undefined : { entries, untyped };
}

function readFunction(value: Json): FunctionFact | undefined {
  const f = fieldsOf(value);
  const at = spanOf(f?.at);
  if (f === undefined || at === undefined || !isString(f.id) || !isString(f.name)) return undefined;
  const doc = readDoc(f.doc);
  const body = each(f.body, readEffect);
  const returns = each(f.returns, readEffect);
  if (doc === undefined || body === undefined || returns === undefined) return undefined;
  if (typeof f.async !== "boolean" || typeof f.promise !== "boolean") return undefined;
  if (typeof f.local !== "boolean") return undefined;
  return {
    id: f.id,
    name: f.name,
    at,
    async: f.async,
    promise: f.promise,
    doc,
    local: f.local,
    body,
    returns,
  };
}

export function readClass(value: Json): ClassFact | undefined {
  const f = fieldsOf(value);
  if (f === undefined || !isString(f.id) || !isString(f.name)) return undefined;
  if ((f.parent !== null && !isString(f.parent)) || typeof f.open !== "boolean") return undefined;
  return { id: f.id, name: f.name, parent: f.parent, open: f.open };
}

/** Read once per summary object: the engine hands out the same frozen object while it is unchanged. */
const read = new WeakMap<object, ThrowsSummary | null>();

/**
 * The summary as this pack wrote it, or undefined for anything else (a cache file that does not
 * hold what this version writes): such a file then contributes no facts.
 */
export function readSummary(value: Json): ThrowsSummary | undefined {
  const f = fieldsOf(value);
  if (f === undefined) return undefined;
  const known = read.get(f);
  if (known !== undefined) return known ?? undefined;
  const classes = each(f.classes, readClass);
  const functions = each(f.functions, readFunction);
  const module = each(f.module, readEffect);
  const summary =
    classes === undefined || functions === undefined || module === undefined
      ? undefined
      : { classes, functions, module };
  read.set(f, summary ?? null);
  return summary;
}
