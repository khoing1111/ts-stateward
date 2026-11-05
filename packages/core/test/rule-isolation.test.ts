import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * Rules stay separate: a pack loads a rule's module only when the rule is on, so
 * no rule's module may reach another rule's module, or the pack's plugin.ts (which lists them
 * all), through its imports. Shared code lives in the pack's own helper modules.
 */

const packages = fileURLToPath(new URL("../..", import.meta.url));
const packs = readdirSync(packages)
  .filter((name) => name.startsWith("plugin-"))
  .sort();

/** The relative module specifiers a file imports: static, `export … from` and `import()`. */
function relativeImports(file: string): readonly string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.filter((specifier) => specifier.startsWith("."));
}

/** `./x.js` from `dir` is `dir/x.ts` (or `dir/x/index.ts`). */
function resolve(dir: string, specifier: string): string {
  const base = path.resolve(dir, specifier.replace(/\.js$/, ""));
  return existsSync(`${base}.ts`) ? `${base}.ts` : path.join(base, "index.ts");
}

/** The rule modules a pack's plugin.ts loads lazily: its `import()` calls. */
function ruleModules(src: string): readonly string[] {
  const plugin = path.join(src, "plugin.ts");
  const text = readFileSync(plugin, "utf8");
  return [...text.matchAll(/import\("(\.[^"]+)"\)/g)].map((match) => resolve(src, match[1] ?? ""));
}

/** Every module `file` reaches through relative imports, itself left out. */
function reached(file: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const pending = [file];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const specifier of relativeImports(next)) {
      const target = resolve(path.dirname(next), specifier);
      if (target === file || seen.has(target)) continue;
      seen.add(target);
      pending.push(target);
    }
  }
  return seen;
}

describe.each(packs)("%s: rules stay separate", (pack) => {
  const src = path.join(packages, pack, "src");
  const rules = ruleModules(src);

  it("loads each rule from a module of its own", () => {
    expect(rules.length).toBeGreaterThan(0);
    expect(new Set(rules).size).toBe(rules.length);
  });

  it.each(rules.map((rule) => path.relative(src, rule)))(
    "%s reaches no other rule's module and not the plugin",
    (relative) => {
      const own = path.join(src, relative);
      const forbidden = new Set([
        ...rules.filter((rule) => rule !== own),
        path.join(src, "plugin.ts"),
        path.join(src, "index.ts"),
      ]);
      const crossings = [...reached(own)]
        .filter((file) => forbidden.has(file))
        .map((file) => path.relative(src, file));
      expect(crossings).toEqual([]);
    },
  );
});
