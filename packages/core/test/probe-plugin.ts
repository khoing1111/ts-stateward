import path from "node:path";
import ts from "typescript";
import type { FileRule, Plugin, Rule, RuleMeta } from "../src/internal.js";

export const meta: RuleMeta = {
  description: "probe",
  defaultSeverity: "warning",
  tier: "core",
  group: "probes",
  explain: "probe explain",
};

export function plugin(rules: Record<string, Rule>): Plugin {
  return { name: "probe", description: "probe plugin", rules };
}

/** Reports, for every call, what the type queries say about its callee and first argument. */
export const callProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const symbol = ctx.types.symbolAt(node.expression);
        const declaration = symbol && ctx.types.declarationOf(symbol);
        const argument = node.arguments[0];
        const found = argument ? ctx.types.literalsOf(argument) : "none";
        const values =
          typeof found === "string" ? found : found.map((literal) => literal.label).join(",");
        ctx.report({
          node,
          hint: "probe hint",
          message: [
            node.expression.text,
            symbol?.name,
            declaration && path.basename(declaration.file),
            declaration && ctx.types.isOwnFile(declaration.file),
            values,
          ].join("|"),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

/** Reports `<name>: <labels>` for every variable or parameter named `probe*`. */
export const literalProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (
        (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text.startsWith("probe")
      ) {
        const found = ctx.types.literalsOf(node.name);
        const labels = typeof found === "string" ? found : found.map((l) => l.label).join(",");
        ctx.report({ node, hint: "probe hint", message: `${node.name.text}: ${labels}` });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};
