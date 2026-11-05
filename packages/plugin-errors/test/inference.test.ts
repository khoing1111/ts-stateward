import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import type { Checker, Json, Plugin, RuleSetting } from "@stateward/core";
import { errors } from "../src/index.js";
import { catchMissesError } from "../src/catch-misses-error.js";
import { analyse } from "../src/inference/solve.js";
import { throwsOf } from "../src/react/boundaries.js";
import { isNonThrowingReactHook } from "../src/inference/builtins.js";
import { fixture } from "./helpers.js";

const DIR = fixture("inference");

function checker(plugins: readonly Plugin[], rules: Record<string, RuleSetting> = {}): Checker {
  const parsed = parseConfig({ preset: "recommended", plugins, rules }, DIR);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({ config: parsed.value, cwd: DIR });
}

/** The hover on the `occurrence`-th `name` in `file` (0 for the first). */
function hoverOn(target: Checker, file: string, name: string, occurrence = 0): string | undefined {
  const full = path.join(DIR, file);
  const text = readFileSync(full, "utf8");
  let at = -1;
  for (let i = 0; i <= occurrence; i++) at = text.indexOf(name, at + 1);
  return target.hover(full, at).join("\n\n") || undefined;
}

const solved = checker([errors()]);
solved.check();

const cases: readonly (readonly [string, string, string, string])[] = [
  ["direct throws", "direct.ts", "function direct", "throws: NotFoundError"],
  ["built-ins", "direct.ts", "function builtins", "throws: SyntaxError | URIError"],
  ["nothing", "direct.ts", "function nothing", "throws nothing stateward can see"],
  ["a method of a built-in type", "direct.ts", "const arrow", "throws: RangeError"],
  [
    "calls into another file",
    "calls.ts",
    "function viaCalls",
    "throws: NotFoundError | SyntaxError | URIError",
  ],
  [
    "a catch with no rethrow",
    "caught.ts",
    "function caughtAll",
    "throws nothing stateward can see",
  ],
  ["a partial instanceof chain", "caught.ts", "function partial", "throws: SyntaxError | URIError"],
  [
    "caught and rethrown",
    "caught.ts",
    "function rethrowAll",
    "throws: NotFoundError | SyntaxError | URIError",
  ],
  ["caught and wrapped", "caught.ts", "function wrapsIt", "throws: ParseError"],
  ["an else that rethrows the rest", "caught.ts", "function chain", "throws: URIError"],
  ["async rejections", "async.ts", "function load", "rejects: NotFoundError | TypeError"],
  ["an awaited call in a try", "async.ts", "function loadSafe", "throws nothing stateward can see"],
  [
    "a returned call is not caught",
    "async.ts",
    "function loadUnawaited",
    "rejects: NotFoundError | TypeError",
  ],
  ["a floating promise", "async.ts", "function floating", "throws nothing stateward can see"],
  ["then", "async.ts", "function withThen", "rejects: NotFoundError | SyntaxError | TypeError"],
  ["catch", "async.ts", "function withCatch", "throws nothing stateward can see"],
  ["Promise.all over map", "async.ts", "function loadAll", "rejects: NotFoundError | TypeError"],
  ["a held promise", "async.ts", "function held", "rejects: NotFoundError | TypeError"],
  [
    "fetch with a signal",
    "async.ts",
    "function abortable",
    "rejects: AbortError (DOMException) | TypeError",
  ],
  ["map's callback", "callbacks.ts", "function parseAll", "throws: SyntaxError"],
  ["forEach with a function", "callbacks.ts", "function findEach", "throws: NotFoundError"],
  [
    "a callback parameter",
    "callbacks.ts",
    "function callsBack",
    "throws: others stateward cannot see (from fn: callback of unknown origin)",
  ],
  ["recursion", "recursion.ts", "function isOdd", "throws: RangeError"],
  ["@throws {never}", "documented.ts", "function safe", "throws nothing stateward can see"],
  ["@throws overrides", "documented.ts", "function usesDeclared", "throws: ParseError"],
  [
    "an interface method",
    "unknowns.ts",
    "function user",
    "rejects: others stateward cannot see (from api.getUser: no body (interface or abstract method))",
  ],
  [
    "a dynamic call",
    "unknowns.ts",
    "function dynamic",
    "throws: others stateward cannot see (from fns[0]: dynamic call)",
  ],
  [
    "a package",
    "unknowns.ts",
    "function fromPackage",
    "throws: others stateward cannot see (from remote: fake-lib: no readable source)",
  ],
  [
    "five sources at most",
    "unknowns.ts",
    "function many",
    "throws: others stateward cannot see (from a: callback of unknown origin; b: callback of unknown origin; c: callback of unknown origin; d: callback of unknown origin; e: callback of unknown origin; and 1 more)",
  ],
  // From an earlier review: promises held in a const.
  [
    "Promise.all of held promises",
    "review.ts",
    "function joined",
    "rejects: NotFoundError | ParseError",
  ],
  ["a held promise returned", "review.ts", "function returned", "rejects: NotFoundError"],
  ["then on a held promise", "review.ts", "function chained", "rejects: NotFoundError"],
  ["Promise.race of a held promise", "review.ts", "function raced", "rejects: NotFoundError"],
  ["Promise.any of a held promise", "review.ts", "function anyOf", "rejects: AggregateError"],
  [
    "Promise.allSettled of a held promise",
    "review.ts",
    "function settled",
    "throws nothing stateward can see",
  ],
  ["a const of a const", "review.ts", "function relayed", "rejects: NotFoundError"],
  [
    "a const at the top of the module",
    "review.ts",
    "function fromModule",
    "rejects: NotFoundError",
  ],
  [
    "a reassigned let",
    "review.ts",
    "function reassigned",
    "rejects: others stateward cannot see (from p: promise held in a variable)",
  ],
  [
    "a promise parameter",
    "review.ts",
    "function fromParameter",
    "rejects: others stateward cannot see (from p: promise held in a variable)",
  ],
  [
    "a promise property",
    "review.ts",
    "function fromProperty",
    "rejects: others stateward cannot see (from box.p: promise held in a variable)",
  ],
  // From an earlier review: callbacks of the platform.
  ["sort's comparator", "review.ts", "function sorted", "throws: ParseError"],
  ["Array.from's mapper", "review.ts", "function fromList", "throws: ParseError"],
  ["replace with a function", "review.ts", "function replaced", "throws: ParseError"],
  [
    "replace with a string",
    "review.ts",
    "function replacedByText",
    "throws nothing stateward can see",
  ],
  ["JSON.parse's reviver", "review.ts", "function revived", "throws: ParseError | SyntaxError"],
  [
    "timers and microtasks run later",
    "review.ts",
    "function later",
    "throws nothing stateward can see",
  ],
  ["an observer runs later", "review.ts", "function observed", "throws nothing stateward can see"],
  [
    "another call of the platform with a throwing callback",
    "review.ts",
    "function applied",
    "throws: others stateward cannot see (from Reflect.apply: callback passed to `Reflect.apply` may run during the call)",
  ],
  [
    "another call of the platform with a quiet callback",
    "review.ts",
    "function appliedQuiet",
    "throws nothing stateward can see",
  ],
  // From an earlier review: fetch's options.
  ["fetch with RequestInit passed on", "review.ts", "function passedOn", "rejects: TypeError"],
  ["fetch with a spread RequestInit", "review.ts", "function spread", "rejects: TypeError"],
  [
    "fetch with a signal in the options' type",
    "review.ts",
    "function withSignal",
    "rejects: AbortError (DOMException) | TypeError",
  ],
  // From an earlier review: @throws on a function that returns a promise.
  [
    "@throws on a function returning a Promise",
    "review.ts",
    "function getUser",
    "rejects: NotFoundError",
  ],
];

describe("errors: what a function throws, on hover", () => {
  it.each(cases)("%s", (_name, file, name, expected) => {
    expect(hoverOn(solved, file, name.split(" ")[1] ?? name)).toBe(expected);
  });

  it("answers on a call as on the declaration", () => {
    expect(hoverOn(solved, "calls.ts", "direct", 2)).toBe("throws: NotFoundError");
    expect(hoverOn(solved, "calls.ts", "builtins", 1)).toBe("throws: SyntaxError | URIError");
  });

  it("says nothing on a name that is not a function, or when the inference rules are off", () => {
    expect(hoverOn(solved, "async.ts", "response")).toBeUndefined();
    const off = checker([errors()], {
      "errors/catch-misses-error": "off",
      "errors/throws-doc-mismatch": "off",
      // The React rules solve the same facts, so the hover reads them too.
      "errors/render-throw-without-boundary": "off",
    });
    off.check();
    expect(hoverOn(off, "direct.ts", "direct")).toBeUndefined();
  });
});

describe("errors: early cut-off", () => {
  it("computes the edited file's functions, and their callers only when a result changes", () => {
    const computed: number[] = [];
    const probe: Plugin = {
      name: "probe",
      description: "counts what each solve computes",
      rules: {
        facts: {
          ...catchMissesError,
          check(summaries: ReadonlyMap<string, Json>) {
            computed.push(analyse(throwsOf(summaries)).computed);
          },
        },
      },
    };
    const target = checker([probe]);
    const file = path.join(DIR, "direct.ts");
    const text = readFileSync(file, "utf8");
    // The solve is kept between checks of the process (the language server's full passes), so
    // this first one may already reuse the hover tests' solve.
    target.check();

    // A comment above every function: their facts change (offsets), their results do not.
    target.check(new Map([[file, `// edited\n${text}`]]));
    expect(computed[1]).toBe(5);

    // `nothing` now throws: it and its callers (none) are computed, and the hover follows.
    const throwing = text.replace(
      "return a + 1;",
      'if (a < 0) throw new RangeError("a");\n  return a + 1;',
    );
    target.check(new Map([[file, throwing]]));
    expect(computed[2]).toBe(5);

    // `direct` throws something new: its callers in other files are computed again.
    const grown = text.replace(
      'if (id === "") throw new NotFoundError(id);',
      'if (id === "") throw new NotFoundError(id);\n  if (id === "?") throw new ParseError(id);',
    );
    target.check(new Map([[file, grown]]));
    expect(computed[3]).toBeGreaterThan(5);
  });
});

describe("React's built-in hooks", () => {
  it("add nothing to what a component throws, so components are not all unknown", () => {
    expect(isNonThrowingReactHook("react", "useState(0)")).toBe(true);
    expect(isNonThrowingReactHook("react", "React.useEffect(() => {}, [])")).toBe(true);
    expect(isNonThrowingReactHook("react", "useMemo<number>(() => 1, [])")).toBe(true);
  });

  it("leave use(), other React functions and other packages as unknown", () => {
    expect(isNonThrowingReactHook("react", "use(promise)")).toBe(false);
    expect(isNonThrowingReactHook("react", 'createElement("div")')).toBe(false);
    expect(isNonThrowingReactHook("swr", "useState(0)")).toBe(false);
  });
});
