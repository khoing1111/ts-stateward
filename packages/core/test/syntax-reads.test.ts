import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createChecker,
  emptyCache,
  parseConfig,
  parseSnapshot,
  toSnapshot,
} from "../src/internal.js";
import type { Plugin, ResultCache, Rule, TypeQueries } from "../src/internal.js";

/**
 * Results that read another file's syntax (`TypeQueries.declarationOf`) beyond its shape: each
 * kind of read the rules make (docs/architecture.md, "Incremental runs") is reused only while the
 * file it read is the same, and a warm run always gives a cold run's findings.
 */

let root = "";

const FILES: Readonly<Record<string, string>> = {
  "y.ts": "export function inner(n: number): number {\n  return n + 1;\n}\n",
  "x.ts": [
    'import { inner } from "./y.js";',
    "export function outer(n: number): number {",
    "  return inner(n);",
    "}",
    "export const limit: number = 3;",
    "",
  ].join("\n"),
  "f.ts": 'import { outer, limit } from "./x.js";\nexport const a = outer(limit);\n',
  "g.ts": 'import { outer } from "./x.js";\nexport const b = outer(1);\n',
  "h.ts": 'import * as x from "./x.js";\nexport const c = typeof x;\n',
  "z.ts": "export const unrelated = 1;\n",
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "stateward-reads-"));
  writeFileSync(path.join(root, "package.json"), '{ "type": "module" }');
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        noEmit: true,
        types: [],
      },
      include: ["*.ts"],
    }),
  );
  for (const [name, text] of Object.entries(FILES)) writeFileSync(path.join(root, name), text);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const at = (name: string): string => path.join(root, name);

const meta = {
  description: "d",
  defaultSeverity: "error",
  tier: "core",
  group: "g",
  explain: "d",
} as const;

/** The declaration of what `node` names, when another file declares it. */
function declared(ctx: { file: string; types: TypeQueries }, node: ts.Node): ts.Node | undefined {
  const symbol = ctx.types.symbolAt(node);
  const found = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  return found === undefined || found.file === ctx.file ? undefined : found.node;
}

function eachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => {
    eachNode(child, visit);
  });
}

/** Reads the body of each function a file calls (as the errors pack infers what a call throws). */
function bodyProbe(ran: string[]): Rule {
  return {
    kind: "file",
    meta,
    check(ctx) {
      ran.push(path.basename(ctx.file));
      eachNode(ctx.sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        const callee = declared(ctx, node.expression);
        if (callee !== undefined && ts.isFunctionDeclaration(callee) && callee.body) {
          ctx.report({ node, message: `body ${callee.body.getText()}`, hint: "h" });
        }
      });
    },
  };
}

/** Reads the initializer of each `const` a file names (as the reducers pack reads an initial state). */
const initializerProbe: Rule = {
  kind: "project",
  meta,
  summarize(ctx) {
    const found: string[] = [];
    eachNode(ctx.sourceFile, (node) => {
      if (!ts.isIdentifier(node)) return;
      const declaration = declared(ctx, node);
      if (declaration !== undefined && ts.isVariableDeclaration(declaration)) {
        found.push(`${node.text} = ${declaration.initializer?.getText() ?? ""}`);
      }
    });
    return found.length === 0 ? undefined : found;
  },
  check(summaries, ctx) {
    for (const [file, summary] of summaries) {
      ctx.report({
        message: `initializers ${JSON.stringify(summary)}`,
        hint: "h",
        location: { file, start: 0, end: 0 },
      });
    }
  },
};

/** Reads the statements of each module a file imports (as the react-context pack walks a module). */
const moduleProbe: Rule = {
  kind: "file",
  meta,
  check(ctx) {
    for (const statement of ctx.sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const module = declared(ctx, statement.moduleSpecifier);
      if (module !== undefined && ts.isSourceFile(module)) {
        ctx.report({
          node: statement,
          message: `module of ${String(module.statements.length)} statements, ${String(module.text.length)} characters`,
          hint: "h",
        });
      }
    }
  },
};

/**
 * Follows a call into the callee's body and from there into the next file, keeping what it found
 * per program and callee: the second file that calls the same function is handed only the first
 * declaration, and reads the rest from the memo.
 */
function memoProbe(ran: string[]): Rule {
  const memos = new WeakMap<TypeQueries, Map<string, string>>();
  return {
    kind: "file",
    meta,
    check(ctx) {
      ran.push(path.basename(ctx.file));
      const memo = memos.get(ctx.types) ?? new Map<string, string>();
      memos.set(ctx.types, memo);
      eachNode(ctx.sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        const id = ctx.types.symbolAt(node.expression)?.id;
        const callee = declared(ctx, node.expression);
        if (id === undefined || callee === undefined || !ts.isFunctionDeclaration(callee)) return;
        let found = memo.get(id);
        if (found === undefined) {
          const texts: string[] = [];
          eachNode(callee, (inner) => {
            if (!ts.isCallExpression(inner)) return;
            const next = declared({ file: ctx.file, types: ctx.types }, inner.expression);
            if (next !== undefined && ts.isFunctionDeclaration(next) && next.body) {
              texts.push(next.body.getText());
            }
          });
          found = texts.join(" ");
          memo.set(id, found);
        }
        ctx.report({ node, message: `follows ${found}`, hint: "h" });
      });
    },
  };
}

/** Reads what an `X.y = …` in another file assigns, through the access that declares `y`. */
function expandoProbe(ran: string[]): Rule {
  return {
    kind: "file",
    meta,
    check(ctx) {
      ran.push(path.basename(ctx.file));
      eachNode(ctx.sourceFile, (node) => {
        if (!ts.isPropertyAccessExpression(node)) return;
        const declaration = declared(ctx, node.name);
        const assignment = declaration?.parent;
        if (assignment !== undefined && ts.isBinaryExpression(assignment)) {
          ctx.report({ node, message: `expando ${assignment.right.getText()}`, hint: "h" });
        }
      });
    },
  };
}

/** Points at each callee's declaration: its findings keep another file's offsets. */
const relatedProbe: Rule = {
  kind: "file",
  meta,
  check(ctx) {
    eachNode(ctx.sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return;
      const callee = declared(ctx, node.expression);
      if (callee !== undefined) {
        ctx.report({
          node,
          message: "calls",
          hint: "h",
          related: [{ node: callee, message: "here" }],
        });
      }
    });
  },
};

function checkerOf(rules: Record<string, Rule>, cache: ResultCache | false) {
  const plugins: Plugin[] = [{ name: "p", description: "p", rules }];
  const parsed = parseConfig({ preset: "recommended", plugins }, root);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({ config: parsed.value, cwd: root, cache });
}

const allRules = (ran: string[], followed: string[]): Record<string, Rule> => ({
  body: bodyProbe(ran),
  initializers: initializerProbe,
  modules: moduleProbe,
  memo: memoProbe(followed),
  related: relatedProbe,
  expando: expandoProbe([]),
});

/** The findings of a run that reuses nothing. */
function coldFindings(overlays: ReadonlyMap<string, string>): string {
  return JSON.stringify(checkerOf(allRules([], []), false).check(overlays).findings);
}

describe("a result that read another file's syntax", () => {
  it("runs again when the function body it read changes, though the file's shape did not", () => {
    const ran: string[] = [];
    const checker = checkerOf({ body: bodyProbe(ran) }, emptyCache());
    checker.check();
    ran.length = 0;
    const overlays = new Map([
      [at("x.ts"), FILES["x.ts"]?.replace("inner(n)", "inner(n * 2)") ?? ""],
    ]);
    const edited = checker.check(overlays);
    expect(ran.sort()).toEqual(["f.ts", "g.ts", "x.ts"]);
    expect(JSON.stringify(edited.findings)).toBe(
      JSON.stringify(checkerOf({ body: bodyProbe([]) }, false).check(overlays).findings),
    );
    expect(edited.findings.map((finding) => finding.message)).toContain(
      "body {\n  return inner(n * 2);\n}",
    );
  });

  it("runs again when the initializer of a declared const it read changes", () => {
    const checker = checkerOf({ initializers: initializerProbe }, emptyCache());
    checker.check();
    const overlays = new Map([[at("x.ts"), FILES["x.ts"]?.replace("= 3", "= 4") ?? ""]]);
    const messages = checker.check(overlays).findings.map((finding) => finding.message);
    // f.ts names `limit` twice: in its import and in its call.
    expect(messages).toEqual(['initializers ["limit = 4","limit = 4"]']);
  });

  it("runs again when the module it walked changes in a part no importer sees", () => {
    const checker = checkerOf({ modules: moduleProbe }, emptyCache());
    const before = checker.check().findings.map((finding) => finding.message);
    const overlays = new Map([[at("x.ts"), `${FILES["x.ts"] ?? ""}function unused() {}\n`]]);
    const after = checker.check(overlays).findings.map((finding) => finding.message);
    expect(after).not.toEqual(before);
    expect(JSON.stringify(after)).toBe(
      JSON.stringify(
        checkerOf({ modules: moduleProbe }, false)
          .check(overlays)
          .findings.map((finding) => finding.message),
      ),
    );
  });

  it("runs again when a file it followed into from the file it read changes, read from a memo", () => {
    const ran: string[] = [];
    const checker = checkerOf({ memo: memoProbe(ran) }, emptyCache());
    checker.check();
    ran.length = 0;
    // y.ts's shape is the same: only reads see this edit.
    const overlays = new Map([[at("y.ts"), FILES["y.ts"]?.replace("n + 1", "n + 2") ?? ""]]);
    const edited = checker.check(overlays);
    expect(ran.sort()).toEqual(["f.ts", "g.ts", "x.ts", "y.ts"]);
    // f.ts and g.ts follow outer into inner; x.ts calls inner, whose body calls nothing.
    expect(edited.findings.filter((finding) => finding.message.includes("n + 2"))).toHaveLength(2);
  });

  it("is reused when nothing it read changed", () => {
    const ran: string[] = [];
    const checker = checkerOf({ body: bodyProbe(ran) }, emptyCache());
    checker.check();
    ran.length = 0;
    const overlays = new Map([[at("z.ts"), "// a comment\nexport const unrelated = 1;\n"]]);
    checker.check(overlays);
    expect(ran).toEqual(["z.ts"]);
    // A comment at the end of y.ts: x.ts read `inner` there (it calls it), whose text is the same;
    // f.ts and g.ts reach y.ts only through x.ts's types. All keep their results.
    ran.length = 0;
    overlays.set(at("y.ts"), `${FILES["y.ts"] ?? ""}// note\n`);
    checker.check(overlays);
    expect(ran.sort()).toEqual(["y.ts"]);
  });
});

/** A small deterministic generator, so a failing sequence can be run again. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Edits a run can make, each a change of one file's text. */
const EDITS: readonly ((files: Record<string, string>, n: number) => void)[] = [
  (files) => {
    files["y.ts"] = `// note\n${files["y.ts"] ?? ""}`;
  },
  (files, n) => {
    files["y.ts"] = (files["y.ts"] ?? "").replace(/n \+ \d+/, `n + ${String(n)}`);
  },
  (files, n) => {
    files["x.ts"] = (files["x.ts"] ?? "").replace(
      /limit: number = \d+/,
      `limit: number = ${String(n)}`,
    );
  },
  (files, n) => {
    files["x.ts"] = (files["x.ts"] ?? "").replace(/inner\(n[^)]*\)/, `inner(n * ${String(n)})`);
  },
  (files) => {
    files["x.ts"] =
      `${files["x.ts"] ?? ""}function helper${String(Object.keys(files).length)}() {}\n`;
  },
  (files) => {
    const text = files["y.ts"] ?? "";
    files["y.ts"] = text.includes("): number")
      ? text.replace("): number", "): number | string")
      : text.replace("): number | string", "): number");
  },
  (files) => {
    const text = files["g.ts"] ?? "";
    files["g.ts"] = text.includes("outer(1)") ? text.replace("outer(1)", "outer(2)") : text;
  },
  (files) => {
    files["z.ts"] = `/** doc */\n${files["z.ts"] ?? ""}`;
  },
  // A helper's other function: added, then its body edited.
  (files, n) => {
    const text = files["y.ts"] ?? "";
    files["y.ts"] = text.includes("spare")
      ? text.replace(/return \d+;/, `return ${String(n)};`)
      : `${text}export function spare(): number {\n  return 0;\n}\n`;
  },
  // The read function's JSDoc, on and off.
  (files) => {
    const text = files["y.ts"] ?? "";
    files["y.ts"] = text.includes("/** @throws")
      ? text.replace("/** @throws {Error} */\n", "")
      : text.replace("export function inner", "/** @throws {Error} */\nexport function inner");
  },
  // The read function renamed (its old name kept as an alias), and back.
  (files) => {
    const text = files["y.ts"] ?? "";
    files["y.ts"] = text.includes("innerImpl")
      ? text
          .replace("function innerImpl(", "export function inner(")
          .replace("export const inner = innerImpl;\n", "")
      : `${text.replace("export function inner(", "function innerImpl(")}export const inner = innerImpl;\n`;
  },
  // An `X.y = …` added above the others (the first one declares `y`), read from x.ts.
  (files, n) => {
    const text = files["y.ts"] ?? "";
    const at = text.indexOf("inner.label");
    const line = `inner.label = "${String(n)}";\n`;
    files["y.ts"] = at < 0 ? `${text}${line}` : `${text.slice(0, at)}${line}${text.slice(at)}`;
    const x = files["x.ts"] ?? "";
    if (!x.includes("inner.label")) files["x.ts"] = `${x}export const tag = inner.label;\n`;
  },
  // A comment and a blank line just above the first of them.
  (files) => {
    files["y.ts"] = (files["y.ts"] ?? "").replace(/^inner\.label/m, "// why\n\ninner.label");
  },
  // The first of them removed.
  (files) => {
    files["y.ts"] = (files["y.ts"] ?? "").replace(/^inner\.label = "\d+";\n/m, "");
  },
];

describe("warm runs after a sequence of edits", () => {
  it("give a cold run's findings, run after run, in memory", () => {
    const next = random(7);
    const checker = checkerOf(allRules([], []), emptyCache());
    const files: Record<string, string> = { ...FILES };
    for (let step = 0; step < 24; step++) {
      const edit = EDITS[Math.floor(next() * EDITS.length)];
      edit?.(files, step);
      const overlays = new Map(Object.entries(files).map(([name, text]) => [at(name), text]));
      expect(JSON.stringify(checker.check(overlays).findings), `step ${String(step)}`).toBe(
        coldFindings(overlays),
      );
    }
  });

  it("give a cold run's findings across `X.y = …` added, commented above and removed", () => {
    const checker = checkerOf(allRules([], []), emptyCache());
    const files: Record<string, string> = { ...FILES };
    const steps = EDITS.slice(-3);
    const [added, commented, removed] = steps;
    const seen: string[] = [];
    for (const [step, edit] of [added, added, commented, removed, commented, removed].entries()) {
      edit?.(files, step);
      const overlays = new Map(Object.entries(files).map(([name, text]) => [at(name), text]));
      const findings = checker.check(overlays).findings;
      seen.push(...findings.filter((f) => f.message.startsWith("expando")).map((f) => f.message));
      expect(JSON.stringify(findings), `step ${String(step)}`).toBe(coldFindings(overlays));
    }
    expect(seen).toEqual([
      'expando "0"',
      'expando "1"',
      'expando "1"',
      'expando "0"',
      'expando "0"',
    ]);
  });

  it("keep the result that read an `X.y = …` when a comment above an unrelated statement moves it", () => {
    const ran: string[] = [];
    const checker = checkerOf({ expando: expandoProbe(ran) }, emptyCache());
    const files: Record<string, string> = {
      ...FILES,
      "y.ts": `export const first = 0;\n${FILES["y.ts"] ?? ""}`,
    };
    const [added] = EDITS.slice(-3);
    added?.(files, 0);
    added?.(files, 1);
    const overlays = (): Map<string, string> =>
      new Map(Object.entries(files).map(([name, text]) => [at(name), text]));
    checker.check(overlays());
    ran.length = 0;
    // Its id counts the same-named ones before it, not its offset: x.ts's fingerprint and its
    // read of `inner.label` (its statement and those related by name) are as they were.
    files["y.ts"] = (files["y.ts"] ?? "").replace(
      "export const first",
      "// note\n\nexport const first",
    );
    checker.check(overlays());
    expect(ran).toEqual(["y.ts"]);
  });

  it("give a cold run's findings with a cache saved and read back between runs, as the CLI", () => {
    const next = random(11);
    const files: Record<string, string> = { ...FILES };
    let saved: unknown = JSON.parse(JSON.stringify(toSnapshot(emptyCache())));
    for (let step = 0; step < 12; step++) {
      const edit = EDITS[Math.floor(next() * EDITS.length)];
      edit?.(files, step);
      for (const [name, text] of Object.entries(files)) writeFileSync(at(name), text);
      const cache = parseSnapshot(saved);
      const warm = checkerOf(allRules([], []), cache).check();
      expect(JSON.stringify(warm.findings), `step ${String(step)}`).toBe(coldFindings(new Map()));
      saved = JSON.parse(JSON.stringify(toSnapshot(cache)));
    }
  });
});

/**
 * Reads are by declaration: a result that read a declaration of another file holds while that
 * declaration, and what it is related to by name in its file, is as it was; any other edit of
 * the file (a comment, another function's body) leaves it alone.
 */
describe("a read of one declaration", () => {
  const HELPERS: Readonly<Record<string, string>> = {
    "helpers.ts": [
      "/** Doubles. */",
      "export function double(n: number): number {",
      "  return n * 2;",
      "}",
      "",
      "export function other(n: number): number {",
      "  return n - 1;",
      "}",
      "",
      "const LIMIT = 5;",
      "export function capped(n: number): number {",
      "  return n > LIMIT ? LIMIT : n;",
      "}",
      "",
      "export function pick(a: string): string;",
      "export function pick(a: number): number;",
      "export function pick(a: unknown): unknown {",
      "  return a;",
      "}",
      "",
      "export class Box {",
      "  open(): number {",
      "    return 1;",
      "  }",
      "  close(): number {",
      "    return 2;",
      "  }",
      "}",
      "",
    ].join("\n"),
    "user.ts": [
      'import { Box, capped, double, pick } from "./helpers.js";',
      "export const d = double(1) + capped(2) + pick(3) + new Box().open();",
      "",
    ].join("\n"),
    "bystander.ts": 'import { other } from "./helpers.js";\nexport const o = other(1);\n',
  };

  beforeEach(() => {
    for (const [name, text] of Object.entries(HELPERS)) writeFileSync(path.join(root, name), text);
  });

  /** What a rule can learn from a callee's declaration besides its body, each probe one way. */
  function calleeProbe(
    ran: string[],
    learn: (callee: ts.Node, types: TypeQueries) => string,
  ): Rule {
    return {
      kind: "file",
      meta,
      check(ctx) {
        if (path.basename(ctx.file) !== "user.ts") return;
        ran.push(path.basename(ctx.file));
        eachNode(ctx.sourceFile, (node) => {
          const named = ts.isCallExpression(node)
            ? node.expression
            : ts.isPropertyAccessExpression(node)
              ? node.name
              : undefined;
          const callee = named === undefined ? undefined : declared(ctx, named);
          if (callee !== undefined) {
            ctx.report({ node, message: learn(callee, ctx.types), hint: "h" });
          }
        });
      },
    };
  }

  /** Its text with the comments before it (JSDoc tags are read). */
  const fullText = (callee: ts.Node): string => callee.getFullText();
  /** The literal types in its body: what a name it uses is declared as, elsewhere in the file. */
  const literals = (callee: ts.Node, types: TypeQueries): string => {
    const found: string[] = [];
    eachNode(callee, (node) => {
      if (ts.isIdentifier(node) && node.text === "LIMIT")
        found.push(JSON.stringify(types.literalsOf(node)));
    });
    return found.join(" ");
  };
  /** The implementation of an overload, a sibling statement (as the errors pack finds it). */
  const implementation = (callee: ts.Node): string => {
    if (!ts.isFunctionDeclaration(callee) || !ts.isSourceFile(callee.parent)) return "";
    const name = callee.name?.text;
    const body = callee.parent.statements.find(
      (statement) =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body,
    );
    return body?.getText() ?? "";
  };
  /** A method's class: its other members. */
  const owner = (callee: ts.Node): string =>
    ts.isClassDeclaration(callee.parent) ? callee.parent.getText() : "";

  /** The probes that read declarations by id only (no offsets). */
  const byDeclaration = (ran: string[]): Record<string, Rule> => ({
    text: calleeProbe(ran, fullText),
    literals: calleeProbe(ran, literals),
    implementation: calleeProbe(ran, implementation),
    owner: calleeProbe(ran, owner),
  });
  const probes = (ran: string[]): Record<string, Rule> => ({
    ...byDeclaration(ran),
    positions: relatedProbe,
  });

  /** Runs the probes warm after `edit` of helpers.ts; says whether user.ts ran again. */
  function afterEdit(
    edit: (text: string) => string,
    rules: (ran: string[]) => Record<string, Rule> = probes,
  ) {
    const ran: string[] = [];
    const checker = checkerOf(rules(ran), emptyCache());
    checker.check();
    ran.length = 0;
    const text = HELPERS["helpers.ts"] ?? "";
    const edited = edit(text);
    expect(edited).not.toBe(text);
    const overlays = new Map([[at("helpers.ts"), edited]]);
    const warm = JSON.stringify(checker.check(overlays).findings);
    expect(warm).toBe(JSON.stringify(checkerOf(rules([]), false).check(overlays).findings));
    return ran.length > 0;
  }

  it("is reused after an edit of another function's body", () => {
    expect(afterEdit((text) => text.replace("n - 1", "n - 2"), byDeclaration)).toBe(false);
  });

  it("is reused after a comment elsewhere in the file", () => {
    const edit = (text: string): string =>
      text.replace("export function other", "// a note\nexport function other");
    expect(afterEdit(edit, byDeclaration)).toBe(false);
  });

  it("runs again after a comment above it when a rule keeps the file's offsets", () => {
    // The rule whose findings point into helpers.ts reads all of it, so user.ts runs again (reads
    // are per file entry), and its findings move with the comment (checked against a cold run).
    const edit = (text: string): string =>
      text.replace("export function other", "// a note\nexport function other");
    expect(afterEdit(edit)).toBe(true);
  });

  it("runs again after an edit of the body it read", () => {
    expect(afterEdit((text) => text.replace("n * 2", "n * 3"), byDeclaration)).toBe(true);
  });

  it("runs again after an edit of its JSDoc", () => {
    expect(
      afterEdit(
        (text) => text.replace("/** Doubles. */", "/** Doubles. @throws {RangeError} */"),
        byDeclaration,
      ),
    ).toBe(true);
  });

  it("runs again after an edit of a declaration its body names, which no importer sees", () => {
    expect(
      afterEdit((text) => text.replace("const LIMIT = 5;", "const LIMIT = 6;"), byDeclaration),
    ).toBe(true);
  });

  it("runs again after an edit of a sibling overload's body", () => {
    expect(afterEdit((text) => text.replace("return a;", "return [a];"), byDeclaration)).toBe(true);
  });

  it("runs again after an edit of another member of a method's class", () => {
    expect(afterEdit((text) => text.replace("return 2;", "return 3;"), byDeclaration)).toBe(true);
  });

  it("runs again when a declaration added shadows a name its body uses", () => {
    // `Math` is a global in `double`'s file until a local of that name is declared.
    const ran: string[] = [];
    const rules = {
      text: calleeProbe(ran, (callee, types) => {
        const found: string[] = [];
        eachNode(callee, (node) => {
          if (ts.isIdentifier(node) && node.text === "Math")
            found.push(types.symbolAt(node)?.id ?? "none");
        });
        return found.join(" ");
      }),
    };
    const checker = checkerOf(rules, emptyCache());
    const text = (HELPERS["helpers.ts"] ?? "").replace("n * 2", "Math.abs(n) * 2");
    const overlays = new Map([[at("helpers.ts"), text]]);
    checker.check(overlays);
    ran.length = 0;
    overlays.set(at("helpers.ts"), `${text}\nconst Math = { abs: (n: number): number => n };\n`);
    const warm = checker.check(overlays).findings.map((finding) => finding.message);
    expect(ran).toEqual(["user.ts"]);
    expect(warm.some((message) => message.includes("helpers.ts#Math"))).toBe(true);
  });

  it("runs again when the declaration it read is renamed or moved", () => {
    const renamed = (text: string): string =>
      text
        .replace("export function double", "function twice")
        .replace("/** Doubles. */", "/** Doubles. */\nexport const double = twice;");
    expect(afterEdit(renamed, byDeclaration)).toBe(true);
    const moved = (text: string): string =>
      text.replace(
        /\/\*\* Doubles\. \*\/\nexport function double[^}]*}\n/,
        'export { double } from "./more.js";\n',
      );
    writeFileSync(
      at("more.ts"),
      "/** Doubles. */\nexport function double(n: number): number {\n  return n * 2;\n}\n",
    );
    expect(afterEdit(moved, byDeclaration)).toBe(true);
  });
});
