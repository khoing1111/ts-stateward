import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check, parseConfig } from "@stateward/core";
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

function body(code: string): string {
  return `  try { ${code} } catch (e) { showError(e); }`;
}

function jsx(name: string, code = "await save();"): string {
  return `catch inside the handler, since nothing awaits it:\n    ${name}={async () => {\n    ${body(code)}\n    }}`;
}

/** The example repeats the call the listener or callback was passed to, with its own arguments. */
function passed(
  role: "listener" | "callback",
  first: string,
  last: string,
  code = "await save();",
): string {
  return `catch inside the ${role}, since nothing awaits it:\n    ${first}\n    ${body(code)}\n    ${last}`;
}

function at(file: string, message: string, hint: string) {
  return says(file, message, hint);
}

describe(`async/${RULE}: an async function that nothing awaits`, () => {
  it("names the JSX attribute: await, for await, return of a promise, and an await in a catch or finally", () => {
    const found = shown(flagged()).slice(0, 12);
    const file = "handlers.tsx";
    expect(found).toEqual([
      at(file, failure("onClick", "handler"), jsx("onClick")),
      at(file, failure("onSubmit", "handler"), jsx("onSubmit", "await load();")),
      at(file, failure("onSave", "handler"), jsx("onSave")),
      at(file, failure("onSave", "handler"), jsx("onSave", 'await fetch("/api");')),
      at(file, failure("onSave", "handler"), jsx("onSave", "await saveAll();")),
      at(file, failure("onSave", "handler"), jsx("onSave", "await saveLater();")),
      at(file, failure("onSave", "handler"), jsx("onSave", "await Promise.all([save(), save()]);")),
      at(file, failure("onChange", "handler"), jsx("onChange")),
      at(file, failure("onBlur", "handler"), jsx("onBlur")),
      at(
        file,
        failure("onFocus", "handler"),
        jsx("onFocus", "for await (const item of stream()) { … }"),
      ),
      at(file, failure("onKeyDown", "handler"), jsx("onKeyDown")),
      at(file, failure("onInput", "handler"), jsx("onInput", 'await fetch("/api");')),
    ]);
  });

  it("names the call for addEventListener and the timers, once per handler", () => {
    const found = shown(flagged()).slice(12);
    const file = "handlers.tsx";
    const listener = (first: string, code?: string) =>
      passed("listener", `${first}, async () => {`, "});", code);
    const callback = (call: string, last: string, code?: string) =>
      passed("callback", `${call}(async () => {`, last, code);
    expect(found).toEqual([
      at(
        file,
        failure("addEventListener", "listener"),
        listener('target.addEventListener("click"'),
      ),
      at(
        file,
        failure("addEventListener", "listener"),
        listener('document.addEventListener("keydown"'),
      ),
      at(file, failure("setTimeout", "callback"), callback("setTimeout", "}, 100);")),
      at(file, failure("setInterval", "callback"), callback("setInterval", "}, 1000);")),
      at(file, failure("queueMicrotask", "callback"), callback("queueMicrotask", "});")),
      at(file, failure("setTimeout", "callback"), callback("window.setTimeout", "}, 100);")),
      at(file, failure("setTimeout", "callback"), callback("setTimeout", "}, 100);")),
      at(
        file,
        failure("addEventListener", "listener"),
        listener('someVeryLongObjectName.addEventListener("x"'),
      ),
      at(
        "partly-caught.tsx",
        failure("onClick", "handler"),
        jsx("onClick", "await removeThenReload();"),
      ),
      at("partly-caught.tsx", failure("onClick", "handler"), jsx("onClick", "await rethrows();")),
      at(
        "then.ts",
        failure("setTimeout", "callback"),
        callback("setTimeout", "});", 'await save().then(() => showError("saved"));'),
      ),
      at(
        "then.ts",
        failure("addEventListener", "listener"),
        listener(
          'button.addEventListener("click"',
          'await saveEverything("the first argument", "the second …;',
        ),
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
        jsx("onClick", 'await addTodo("bread").unwrap();'),
      ),
    ]);
  });
});

describe(`async/${RULE}: the project says a prop never rejects`, () => {
  it("accepts `@neverRejects` on the prop, its function type or the function, and a prop the component awaits in its own try", () => {
    expect(shown(checkOnly(fixture(`${RULE}/real-b`), RULE))).toEqual([
      at("search.tsx", failure("onClick", "handler"), jsx("onClick", 'await handleExport("c");')),
      at("search.tsx", failure("onSubmit", "handler"), jsx("onSubmit", "await search(query);")),
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
      'try { await send("hi"); } catch (e) { showError(e); }',
      "try { await fetchAll(); } catch (e) { showError(e); }",
    ]);
    expect(awaited(withFacts({ "quiet-client": { send: { rejects: [] } } }))).toEqual([
      "try { await fetchAll(); } catch (e) { showError(e); }",
    ]);
    // A list of errors says it does reject.
    expect(
      awaited(withFacts({ "quiet-client": { send: { rejects: ["TypeError"] } } })),
    ).toHaveLength(2);
  });
});
