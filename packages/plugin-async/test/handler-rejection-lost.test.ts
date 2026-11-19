import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check, parseConfig } from "@stateward/core";
import { typeErrorsOfText } from "@stateward/core/testing";
import type { Finding, PackageFactsConfig } from "@stateward/core";
import { asyncFlow } from "../src/index.js";
import { checkOnly, fixture, says, shown } from "./handler-helpers.js";

const RULE = "handler-rejection-lost";

function flagged(): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE);
}

function failure(name: string, role: "handler" | "listener" | "callback"): string {
  return `unhandled rejection: nothing catches a failure of the async \`${name}\` ${role}`;
}

type Role = "handler" | "listener" | "callback";

/** What a hint offers: the statement shown wrapped, the function it can tag, the prop it can list. */
type Offer = { statement?: string; tag?: string; prop?: string };

/** The fix of a handler nothing awaits: wrap the failure, then the readings that state a purpose. */
function hintFor(role: Role, { statement, tag, prop }: Offer): string {
  const where = `catch inside the ${role}, since nothing awaits it`;
  const ways: string[] = [
    statement === undefined
      ? `- ${where}: wrap the statement that fails, and those that use its result, in a \`try\` with a \`catch\``
      : `- ${where}: wrap the call that fails, and keep the other statements\n    try { ${statement} } catch (error) { … }`,
  ];
  if (tag !== undefined) {
    ways.push(
      `- or, if \`${tag}\` shows or records its own failures, tag it with \`@neverRejects\` in its JSDoc: stateward then proves the tag and trusts it at its callers`,
    );
  }
  if (prop !== undefined) {
    ways.push(
      `- or, if the component given \`${prop}\` awaits it itself, list the prop under the rule's \`ignoreProps\` option`,
    );
  }
  return ways.length === 1 ? (ways[0] ?? "").replace(/^- /, "") : ["one of", ...ways].join("\n");
}

const SAVE = "await save();";

function at(file: string, message: string, hint: string) {
  return says(file, message, hint);
}

describe(`async/${RULE}: an async function that nothing awaits`, () => {
  it("names the JSX attribute: await, for await, return of a promise, and an await in a catch or finally", () => {
    const found = shown(flagged()).slice(0, 12);
    const file = "handlers.tsx";
    expect(found).toEqual([
      at(
        file,
        failure("onClick", "handler"),
        hintFor("handler", { statement: SAVE, tag: "save", prop: "onClick" }),
      ),
      // `const items = await load()`: the code after it uses `items`, so no example is written.
      at(
        file,
        failure("onSubmit", "handler"),
        hintFor("handler", { tag: "load", prop: "onSubmit" }),
      ),
      // A handler with no block body has no statement to wrap.
      at(file, failure("onSave", "handler"), hintFor("handler", { tag: "save", prop: "onSave" })),
      // `fetch` and `Promise.all` are the language's: no function to tag, no package for facts.
      at(file, failure("onSave", "handler"), hintFor("handler", { prop: "onSave" })),
      at(
        file,
        failure("onSave", "handler"),
        hintFor("handler", { tag: "saveAll", prop: "onSave" }),
      ),
      at(
        file,
        failure("onSave", "handler"),
        hintFor("handler", { tag: "saveLater", prop: "onSave" }),
      ),
      at(file, failure("onSave", "handler"), hintFor("handler", { prop: "onSave" })),
      at(
        file,
        failure("onChange", "handler"),
        hintFor("handler", { statement: SAVE, tag: "save", prop: "onChange" }),
      ),
      at(
        file,
        failure("onBlur", "handler"),
        hintFor("handler", { statement: SAVE, tag: "save", prop: "onBlur" }),
      ),
      at(
        file,
        failure("onFocus", "handler"),
        hintFor("handler", {
          statement: "for await (const item of stream()) setItems([item]);",
          prop: "onFocus",
        }),
      ),
      at(
        file,
        failure("onKeyDown", "handler"),
        hintFor("handler", { tag: "save", prop: "onKeyDown" }),
      ),
      at(
        file,
        failure("onInput", "handler"),
        hintFor("handler", { statement: 'return await fetch("/api");', prop: "onInput" }),
      ),
    ]);
  });

  it("names the call for addEventListener and the timers, once per handler", () => {
    const found = shown(flagged()).slice(12);
    const file = "handlers.tsx";
    const listener = hintFor("listener", { statement: SAVE, tag: "save" });
    const callback = hintFor("callback", { statement: SAVE, tag: "save" });
    expect(found).toEqual([
      at(file, failure("addEventListener", "listener"), listener),
      at(file, failure("addEventListener", "listener"), listener),
      at(file, failure("setTimeout", "callback"), callback),
      at(file, failure("setInterval", "callback"), callback),
      at(file, failure("queueMicrotask", "callback"), callback),
      at(file, failure("setTimeout", "callback"), callback),
      at(file, failure("setTimeout", "callback"), callback),
      at(file, failure("addEventListener", "listener"), listener),
      at(
        "partly-caught.tsx",
        failure("onClick", "handler"),
        hintFor("handler", {
          statement: "await removeThenReload();",
          tag: "removeThenReload",
          prop: "onClick",
        }),
      ),
      at(
        "partly-caught.tsx",
        failure("onClick", "handler"),
        hintFor("handler", { statement: "await rethrows();", tag: "rethrows", prop: "onClick" }),
      ),
      // A `.then` callback does not catch; `then` is the language's, so there is nothing to tag.
      at(
        "then.ts",
        failure("setTimeout", "callback"),
        hintFor("callback", { statement: 'await save().then(() => showError("saved"));' }),
      ),
      at(
        "then.ts",
        failure("addEventListener", "listener"),
        hintFor("listener", {
          statement: 'await saveEverything("the first argument", "the second argument");',
          tag: "saveEverything",
        }),
      ),
    ]);
  });

  it("is an error shown on the first place that can fail, with no quick fix", () => {
    const shownText = flagged().map((finding) =>
      readFileSync(finding.location.file, "utf8").slice(
        finding.location.start,
        finding.location.end,
      ),
    );
    expect(shownText).toEqual([
      "await",
      "await",
      "await",
      'fetch("/api")',
      "saveAll()",
      "saveLater()",
      "Promise.all([save(), save()])",
      "await",
      "await",
      "await",
      "await",
      'fetch("/api")',
      ...Array<string>(12).fill("await"),
    ]);
    for (const finding of flagged()) {
      expect(finding).toMatchObject({
        kind: "problem",
        ruleId: `async/${RULE}`,
        severity: "error",
        fixes: [],
      });
    }
  });

  it("never passes 100 characters in a headline or 140 on the fix line", () => {
    for (const finding of flagged()) {
      // Only quoted names may push a line past its limit.
      expect(finding.message.replace(/`[^`]*`/g, "").length).toBeLessThanOrEqual(100);
      expect(finding.hint.split("\n")[0]?.replace(/`[^`]*`/g, "").length).toBeLessThanOrEqual(140);
    }
  });
});

describe(`async/${RULE}: the handler's own code`, () => {
  it("wraps only the call that fails, and never writes a name the project does not have", () => {
    const dir = fixture(`${RULE}/keeps`);
    const [one, ...rest] = shown(checkOnly(dir, RULE));
    expect(rest).toEqual([]);
    // `event` and `preventDefault()` stay where they are: only `await save(id);` is shown.
    expect(one?.hint).toBe(
      hintFor("handler", { statement: "await save(id);", tag: "save", prop: "onSubmit" }),
    );
    expect(one?.hint).not.toContain("showError");
    expect(one?.hint).not.toContain("async () => {");
    // The shown line, put in the handler where its statement was (`…` filled in), compiles.
    const shownLine = one?.hint.split("\n")[2]?.trim().replace("…", "void error;") ?? "";
    expect(shownLine).toContain("try { await save(id); }");
    expect(
      typeErrorsOfText(
        [
          "declare function save(id: string): Promise<void>;",
          "declare const id: string;",
          "export const onSubmit = async (event: { preventDefault(): void }) => {",
          "  event.preventDefault();",
          `  ${shownLine}`,
          "};",
        ].join("\n"),
      ),
    ).toBe("");
    for (const finding of flagged()) {
      expect(finding.hint).not.toContain("showError(e)");
      expect(finding.hint).not.toContain("catch (e)");
    }
  });
});

describe(`async/${RULE}: not flagged`, () => {
  it("accepts a try with a catch, a .catch on the awaited call, a prop that asks for a promise, handlers passed by name, non-async functions and other attributes", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });
});

describe(`async/${RULE}: the project's own functions are read`, () => {
  it("accepts a call that cannot reject: a .catch chain, a function that awaits only those, one that awaits nothing, or catches its own; reports one that can or that it cannot see into", () => {
    const dir = fixture(`${RULE}/follows`);
    const text = readFileSync(path.join(dir, "handlers.tsx"), "utf8");
    const lines = checkOnly(dir, RULE).map((finding) => {
      const line = text.slice(0, finding.location.start).split("\n").length;
      return `${path.basename(finding.location.file)}:${String(line)}: ${finding.message}`;
    });
    // Lines 6-12 call functions that cannot reject (a chain 5 deep, read in any order); lines 20-32 call ones that can.
    expect(lines).toEqual(
      [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].map(
        (line) => `handlers.tsx:${String(line)}: ${failure("onClick", "handler")}`,
      ),
    );
  });
});

describe(`async/${RULE}: a function tagged \`@neverRejects\` that rejects`, () => {
  it("reports only what certainly rejects outside a try: fetch, a throw, a project function that rejects; not what it cannot see into", () => {
    const dir = fixture(`${RULE}/tags`);
    const text = readFileSync(path.join(dir, "lib.ts"), "utf8");
    const findings = checkOnly(dir, RULE);
    expect(
      findings.map((finding) => {
        const line = text.slice(0, finding.location.start).split("\n").length;
        return `${String(line)}: ${finding.message}`;
      }),
    ).toEqual([
      "5: `loadWrong` is tagged `@neverRejects`, but `fetch(…)` can reject",
      "10: `validate` is tagged `@neverRejects`, but it throws",
      "20: `outer` is tagged `@neverRejects`, but `inner(…)` can reject",
      "25: `ping` is tagged `@neverRejects`, but `fetch(…)` can reject",
      "85: `send` is tagged `@neverRejects`, but it throws",
    ]);
    expect(findings[0]?.hint).toBe(
      "one of\n- catch the failure inside the function: `try { … } catch (error) { … }`\n- or remove `@neverRejects`, so its callers handle the failure",
    );
  });
});

describe(`async/${RULE}: functions that call each other`, () => {
  it(
    "reads twelve functions that all call each other quickly, and finds nothing to report",
    { timeout: 20_000 },
    () => {
      const started = Date.now();
      expect(checkOnly(fixture(`${RULE}/recursion`), RULE)).toEqual([]);
      expect(Date.now() - started).toBeLessThan(15_000);
    },
  );
});

describe(`async/${RULE}: promises that do not reject`, () => {
  it("accepts a trigger with unwrap() that resolves to data or an error, and reports its .unwrap()", () => {
    expect(shown(checkOnly(fixture(`${RULE}/rtk`), RULE))).toEqual([
      at(
        "triggers.tsx",
        failure("onClick", "handler"),
        hintFor("handler", {
          statement: 'await addTodo("bread").unwrap();',
          tag: "unwrap",
          prop: "onClick",
        }),
      ),
    ]);
  });
});

describe(`async/${RULE}: the project says a prop never rejects`, () => {
  it("accepts `@neverRejects` on the prop, its function type or the function, and a prop the component awaits in its own try", () => {
    expect(shown(checkOnly(fixture(`${RULE}/real-b`), RULE))).toEqual([
      at(
        "search.tsx",
        failure("onClick", "handler"),
        hintFor("handler", {
          statement: 'await handleExport("c");',
          tag: "handleExport",
          prop: "onClick",
        }),
      ),
      at(
        "search.tsx",
        failure("onSubmit", "handler"),
        hintFor("handler", { statement: "await search(query);", tag: "search", prop: "onSubmit" }),
      ),
    ]);
  });
});

describe(`async/${RULE}: library facts`, () => {
  /** A project calling a package's `send` and `fetchAll` from handlers, checked with `facts`. */
  function withFacts(facts: PackageFactsConfig): readonly Finding[] {
    const dir = mkdtempSync(path.join(tmpdir(), "stateward-async-facts-"));
    try {
      cpSync(fixture(`${RULE}/rtk/tsconfig.json`), path.join(dir, "tsconfig.json"));
      cpSync(fixture(`${RULE}/rtk/jsx.d.ts`), path.join(dir, "jsx.d.ts"));
      const lib = path.join(dir, "node_modules", "quiet-client");
      mkdirSync(lib, { recursive: true });
      writeFileSync(
        path.join(lib, "package.json"),
        '{ "name": "quiet-client", "version": "1.0.0", "types": "index.d.ts" }\n',
      );
      writeFileSync(
        path.join(lib, "index.d.ts"),
        [
          "export declare function send(message: string): Promise<boolean>;",
          "export declare function fetchAll(): Promise<string[]>;",
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(dir, "app.tsx"),
        [
          'import { fetchAll, send } from "quiet-client";',
          "",
          "export function Panel() {",
          "  return (",
          "    <div>",
          '      <button onClick={async () => { await send("hi"); }} />',
          "      <button onClick={async () => { await fetchAll(); }} />",
          "    </div>",
          "  );",
          "}",
          "",
        ].join("\n"),
      );
      const rules = { [`async/${RULE}`]: "error" as const };
      const parsed = parseConfig({ plugins: [asyncFlow()], rules, facts }, dir);
      if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
      return check({ config: parsed.value, cwd: dir }).findings.filter(
        (finding) => finding.ruleId === `async/${RULE}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const awaited = (findings: readonly Finding[]): string[] =>
    findings.map((finding) => finding.hint.split("\n")[2]?.trim() ?? "");

  it("takes `rejects: []` to mean the package function never rejects", () => {
    expect(awaited(withFacts({}))).toEqual([
      'try { await send("hi"); } catch (error) { … }',
      "try { await fetchAll(); } catch (error) { … }",
    ]);
    // A package's function: the way to say it never rejects is a `facts` entry in the config.
    expect(withFacts({})[0]?.hint.split("\n")[3]).toBe(
      '- or, if `send` of `quiet-client` never rejects, state it in the config: `facts: { "quiet-client": { "send": { rejects: [] } } }`',
    );
    expect(awaited(withFacts({ "quiet-client": { send: { rejects: [] } } }))).toEqual([
      "try { await fetchAll(); } catch (error) { … }",
    ]);
    // A list of errors says it does reject.
    expect(
      awaited(withFacts({ "quiet-client": { send: { rejects: ["TypeError"] } } })),
    ).toHaveLength(2);
  });
});
