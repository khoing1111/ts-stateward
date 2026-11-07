import ts from "@stateward/core/typescript";
import { defineRule, option, type FileContext, type Fix, type OptionsOf } from "@stateward/core";
import { stripParentheses } from "./syntax.js";
import { codeList, fitted, oneLine, withExample } from "./text.js";

/** The group the rule belongs to in the docs and in `stateward status`. */
export const GROUP = "catch";

const EXPLAIN = `# errors/catch-hides-unexpected

A \`catch\` that tests some error classes and has no last branch ignores every other error, bugs included; rethrowing the rest keeps them visible.

\`\`\`ts example-bad
class NotFoundError extends Error {}
class AuthError extends Error {}

declare function save(order: string): Promise<void>;

export async function submit(order: string, show: (text: string) => void): Promise<void> {
  try {
    await save(order);
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("This order no longer exists.");
    } else if (e instanceof AuthError) {
      show("Please sign in again.");
    }
  }
}
\`\`\`

End the chain with a branch for every other error, which rethrows it or handles it:

\`\`\`ts example-good
class NotFoundError extends Error {}
class AuthError extends Error {}

declare function save(order: string): Promise<void>;

export async function submit(order: string, show: (text: string) => void): Promise<void> {
  try {
    await save(order);
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("This order no longer exists.");
    } else if (e instanceof AuthError) {
      show("Please sign in again.");
    } else {
      throw e;
    }
  }
}
\`\`\`

A quick fix adds \`else { throw e; }\` to an \`if\` chain. For a \`switch (true)\`, add \`default: throw e;\` yourself; the message shows it. Wrapping the error with \`{ cause: e }\`, or any statement after the chain, counts too, since it runs for every error.

## Why it matters

A \`catch\` that handles \`NotFoundError\` and \`AuthError\` and has no last branch ignores every other error: a bug, a network failure, a string someone threw. \`save(order)\` fails with a \`TypeError\`, neither branch matches, and the code carries on as if the order was saved. The rule needs no knowledge of what the \`try\` throws, so it works even where \`errors/catch-misses-error\` cannot see.

## What it does not catch

- A chain that tests another value, or tests with something other than \`instanceof\`.
- A \`catch\` with no parameter, or a destructured one.
- A last \`else\` that does something but still ignores the error (\`else { showGenericError(); }\`): it counts as handling the rest, unless you set \`restUsesError\`. \`errors/catch-misses-error\` looks at what that \`else\` does with the error.

## Turn it on or off

\`\`\`ts
rules: { "errors/catch-hides-unexpected": "off" } // or "warning"
rules: { "errors/catch-hides-unexpected": ["error", { restUsesError: true }] } // the last branch must use the error
\`\`\`
`;

/** The statements of a branch or block, without empty statements; a comment is not a statement. */
const OPTIONS = {
  restUsesError: option.boolean({
    default: false,
    description:
      "The branch for the other errors must use the error (rethrow it, wrap it, report it); a generic message alone does not count.",
  }),
};

type Settings = OptionsOf<typeof OPTIONS>;

function realStatements(node: ts.Statement | undefined): readonly ts.Statement[] {
  if (node === undefined) return [];
  const statements = ts.isBlock(node) ? node.statements : [node];
  return statements.filter((statement) => !ts.isEmptyStatement(statement));
}

/** The classes of the `instanceof` tests on `variable` in a condition, in source order. */
function instanceOfClasses(
  condition: ts.Expression,
  variable: string,
  sourceFile: ts.SourceFile,
): readonly string[] {
  const node = stripParentheses(condition);
  if (!ts.isBinaryExpression(node)) return [];
  const operator = node.operatorToken.kind;
  if (operator === ts.SyntaxKind.InstanceOfKeyword) {
    const subject = stripParentheses(node.left);
    return ts.isIdentifier(subject) && subject.text === variable
      ? [oneLine(stripParentheses(node.right).getText(sourceFile))]
      : [];
  }
  if (
    operator === ts.SyntaxKind.BarBarToken ||
    operator === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return [
      ...instanceOfClasses(node.left, variable, sourceFile),
      ...instanceOfClasses(node.right, variable, sourceFile),
    ];
  }
  return [];
}

/** An `if` / `else if` chain, from its first `if` to its last link. */
function linksOf(start: ts.IfStatement): readonly ts.IfStatement[] {
  const links = [start];
  for (
    let last = start;
    last.elseStatement !== undefined && ts.isIfStatement(last.elseStatement);
  ) {
    last = last.elseStatement;
    links.push(last);
  }
  return links;
}

/** A branch point on the caught value: an `if` chain or a `switch (true)`, and where it ends. */
type Dispatch = {
  /** The statement that starts it, where the finding is shown. */
  start: ts.Statement;
  classes: readonly string[];
  /** The statements of the last `else` or `default`: what runs for the rest; empty when none does. */
  rest: readonly ts.Statement[];
  /** The last link, when it is an `if` chain that ends without any `else`. */
  openChainEnd: ts.IfStatement | undefined;
  kind: "if" | "switch";
};

function dispatchOf(
  statement: ts.Statement,
  variable: string,
  sourceFile: ts.SourceFile,
): Dispatch | undefined {
  if (ts.isIfStatement(statement)) {
    const links = linksOf(statement);
    const classes = links.flatMap((link) =>
      instanceOfClasses(link.expression, variable, sourceFile),
    );
    const end = links[links.length - 1];
    if (classes.length === 0 || end === undefined) return undefined;
    return {
      start: statement,
      classes,
      rest: realStatements(end.elseStatement),
      openChainEnd: end.elseStatement === undefined ? end : undefined,
      kind: "if",
    };
  }
  if (ts.isSwitchStatement(statement)) {
    if (stripParentheses(statement.expression).kind !== ts.SyntaxKind.TrueKeyword) return undefined;
    const classes = statement.caseBlock.clauses.flatMap((clause) =>
      ts.isCaseClause(clause) ? instanceOfClasses(clause.expression, variable, sourceFile) : [],
    );
    if (classes.length === 0) return undefined;
    const fallback = statement.caseBlock.clauses.find((clause) => ts.isDefaultClause(clause));
    return {
      start: statement,
      classes,
      rest: (fallback?.statements ?? []).filter((inner) => !ts.isEmptyStatement(inner)),
      openChainEnd: undefined,
      kind: "switch",
    };
  }
  return undefined;
}

/** Whether any of `nodes` names `variable` (a nested function's own `e` counts too: rare, and safe). */
function mentions(nodes: readonly ts.Node[], variable: string): boolean {
  const visit = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && node.text === variable) || ts.forEachChild(node, visit) === true;
  return nodes.some(visit);
}

function ignoringHeadline(classes: readonly string[], variable: string): string {
  return fitted(
    (cut) =>
      `\`catch\` handles errors other than ${codeList(classes, cut)} without looking at \`${variable}\``,
  );
}

function headline(classes: readonly string[]): string {
  return fitted((cut) => `\`catch\` ignores errors other than ${codeList(classes, cut)}`);
}

function hint(dispatch: Dispatch, variable: string): string {
  if (dispatch.kind === "switch") {
    return withExample(
      "end the switch with a case that rethrows the rest, so they reach the caller:",
      ["default:", `  throw ${variable};`],
    );
  }
  return withExample(
    "end the chain with a branch that rethrows the rest, so they reach the caller:",
    ["} else {", `  throw ${variable};`, "}"],
  );
}

/** The whitespace at the start of the line that holds `position`. */
function indentationAt(position: number, text: string): string {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, position))?.[0] ?? "";
}

/** `else { throw e; }` after the last branch, at the indentation of the chain. */
function rethrowFix(
  start: ts.Statement,
  end: ts.IfStatement,
  variable: string,
  sourceFile: ts.SourceFile,
): Fix {
  const indent = indentationAt(start.getStart(sourceFile), sourceFile.text);
  const step = indent.includes("\t") ? "\t" : "  ";
  const at = end.thenStatement.getEnd();
  return {
    title: `Rethrow the other errors with \`else { throw ${variable}; }\``,
    edits: [
      {
        location: { file: sourceFile.fileName, start: at, end: at },
        newText: ` else {\n${indent}${step}throw ${variable};\n${indent}}`,
      },
    ],
  };
}

function checkCatch(clause: ts.CatchClause, ctx: FileContext<Settings>): void {
  const declaration = clause.variableDeclaration;
  if (declaration === undefined || !ts.isIdentifier(declaration.name)) return;
  const variable = declaration.name.text;
  const statements = clause.block.statements;

  let last: { dispatch: Dispatch; index: number } | undefined;
  const classes: string[] = [];
  for (const [index, statement] of statements.entries()) {
    const dispatch = dispatchOf(statement, variable, ctx.sourceFile);
    if (dispatch === undefined) continue;
    last = { dispatch, index };
    for (const name of dispatch.classes) if (!classes.includes(name)) classes.push(name);
  }
  if (last === undefined) return;
  const { dispatch, index } = last;
  // A branch for the rest, or any statement that runs for every error after the chain.
  const after = statements.slice(index + 1).filter((statement) => !ts.isEmptyStatement(statement));
  const rest = [...dispatch.rest, ...after];
  if (rest.length > 0) {
    if (!ctx.options.restUsesError || mentions(rest, variable)) return;
    ctx.report({
      node: dispatch.start.getFirstToken(ctx.sourceFile) ?? dispatch.start,
      message: ignoringHeadline(classes, variable),
      hint: withExample("rethrow the rest, or pass the error on where you handle it:", [
        `throw ${variable};`,
      ]),
    });
    return;
  }

  const fixes =
    dispatch.openChainEnd === undefined
      ? []
      : [rethrowFix(dispatch.start, dispatch.openChainEnd, variable, ctx.sourceFile)];
  ctx.report({
    node: dispatch.start.getFirstToken(ctx.sourceFile) ?? dispatch.start,
    message: headline(classes),
    hint: hint(dispatch, variable),
    fixes,
  });
}

export const catchHidesUnexpected = defineRule({
  kind: "file",
  meta: {
    description:
      "A `catch` that tests some error classes and has no last branch ignores every other error, bugs included; rethrowing the rest keeps them visible.",
    summary: "a `catch` that handles some error classes with `instanceof` and ignores the rest",
    defaultSeverity: "error",
    tier: "core",
    group: GROUP,
    options: OPTIONS,
    explain: EXPLAIN,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isCatchClause(node)) checkCatch(node, ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
