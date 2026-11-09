import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option, type FileContext } from "@stateward/core";

const REACT_PACKAGE = /[\\/]node_modules[\\/](?:@types[\\/])?react[\\/]/;

const EXPLAIN = `# react-context/fake-default-value

Reports a context created with a cast or an empty object as its default (\`{} as Theme\`, \`null!\`): a component rendered outside the Provider reads that value, and its type says it is complete.

\`\`\`tsx example-bad
import { createContext, useContext } from "react";

type Theme = { colors: { text: string } };

const ThemeContext = createContext({} as Theme);

export function Title() {
  return <h1 style={{ color: useContext(ThemeContext).colors.text }}>Hello</h1>;
}
\`\`\`

Create the context with \`undefined\`, so its type says the value can be missing, and read it through a hook that throws when it is missing:

\`\`\`tsx example-good
import { createContext, useContext } from "react";

type Theme = { colors: { text: string } };

const ThemeContext = createContext<Theme | undefined>(undefined);

function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === undefined) throw new Error("useTheme needs a ThemeContext Provider");
  return theme;
}

export function Title() {
  return <h1 style={{ color: useTheme().colors.text }}>Hello</h1>;
}
\`\`\`

No quick fix makes this change, because every reader changes with it. Once the context's type says the value can be missing, \`react-context/provider-missing\` checks that every component that reads it has a Provider above it. Its quick fix can then state the context required (\`requiredContext<Theme>()\`), and the readers need no check.

## Why it matters

With \`createContext({} as Theme)\` or \`createContext<Theme>(null!)\`, a component rendered without the Provider reads \`{}\` or \`null\`, while its type says it reads a \`Theme\`. \`useContext(ThemeContext).colors.text\` then throws a \`TypeError\` in that component, far from the place where the Provider is missing, or the component renders with empty values.

## What it does not catch

It reads React's \`createContext\` (also \`React.createContext\`) called with a cast (\`{} as Theme\`, \`[] as Item[]\`, \`null!\`, \`<Theme>{}\`) or an empty object \`{}\`. It does not report:

- a real default: \`createContext({ colors: defaultColors })\`, or \`createContext([])\`;
- \`createContext<Callbacks>({})\` when no property of \`Callbacks\` is required: \`{}\` is then a complete value of the type;
- \`undefined\` or \`null\` as the default (\`createContext<Theme | null>(null)\`, \`createContext(null as Theme | null)\`): the type then says the value can be missing, and TypeScript makes the readers check it. \`null!\` and \`undefined as unknown as Theme\` hide that, and are reported;
- a cast deeper inside the default (\`{ user: null as User }\`): only the value as a whole is read;
- contexts from other libraries' \`createContext\`;
- the one cast of a helper that returns a \`RequiredContext\` (\`requiredContext<T>()\` in your \`guarantees.ts\`): \`react-context/provider-missing\` proves every reader of such a context is under its Provider, so its default is never read. A context stated required but made with a cast anywhere else is still reported, and the fix line points at the helper.

## Turn it on or off

It is an info under \`recommended\` (shown in the editor, it does not fail \`check\`) and an error under \`strict\`. Turn it off when the defaults are real values (a default theme, a logger that does nothing):

\`\`\`ts
rules: { "react-context/fake-default-value": "off" } // or "warning"
rules: { "react-context/fake-default-value": ["error", { severities: { empty: "info" } }] } // only casts are errors
\`\`\`
`;

function calleeName(call: ts.CallExpression): ts.Node | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee;
  return ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
}

function isReactDeclaration(declaration: { file: string } | undefined): boolean {
  return declaration !== undefined && REACT_PACKAGE.test(declaration.file);
}

/**
 * `const { createContext } = React`: the checker gives the binding itself as the declaration, so
 * the property is resolved against the initializer. A renamed property has its own name node to
 * ask; a shorthand has none, so the initializer must resolve into React and the property key
 * (not the local name, which is the same text only because it is a shorthand) must be createContext.
 */
function isReactBinding(binding: ts.BindingElement, ctx: FileContext): boolean {
  if (binding.propertyName !== undefined) {
    const symbol = ctx.types.symbolAt(binding.propertyName);
    return symbol?.name === "createContext" && isReactDeclaration(ctx.types.declarationOf(symbol));
  }
  const pattern = binding.parent;
  const declaration = pattern.parent;
  if (!ts.isObjectBindingPattern(pattern) || !ts.isVariableDeclaration(declaration)) return false;
  if (declaration.initializer === undefined || !ts.isIdentifier(binding.name)) return false;
  if (binding.name.text !== "createContext") return false;
  const owner = ctx.types.symbolAt(declaration.initializer);
  return owner !== undefined && isReactDeclaration(ctx.types.declarationOf(owner));
}

function isReactCreateContext(call: ts.CallExpression, ctx: FileContext): boolean {
  const name = calleeName(call);
  const symbol = name && ctx.types.symbolAt(name);
  if (!symbol) return false;
  const declaration = ctx.types.declarationOf(symbol);
  if (declaration === undefined) return false;
  if (ts.isBindingElement(declaration.node)) return isReactBinding(declaration.node, ctx);
  return symbol.name === "createContext" && isReactDeclaration(declaration);
}

/**
 * A fake default is a cast at the top of the default value (so a cast `[]` too, while a plain
 * `[]` is a real default) or `{}`. `null`, `undefined` and no default are honest: the context's
 * type says the value can be missing. Only the argument's own wrapper chain is read: a cast
 * inside a property, element, function or call is not a placeholder.
 */
function placeholderKind(argument: ts.Expression | undefined): "cast" | "empty" | undefined {
  if (argument === undefined) return undefined;
  if (statesMissing(argument)) return undefined;
  let inner = argument;
  let cast = false;
  for (;;) {
    if (ts.isParenthesizedExpression(inner) || ts.isSatisfiesExpression(inner)) {
      inner = inner.expression;
    } else if (ts.isAsExpression(inner) && ts.isConstTypeReference(inner.type)) {
      inner = inner.expression;
    } else if (
      ts.isAsExpression(inner) ||
      ts.isTypeAssertionExpression(inner) ||
      ts.isNonNullExpression(inner)
    ) {
      cast = true;
      inner = inner.expression;
    } else break;
  }
  if (cast) return "cast";
  return ts.isObjectLiteralExpression(inner) && inner.properties.length === 0 ? "empty" : undefined;
}

/**
 * Whether `{}` is a complete value of the context's type: the type is given (`createContext<T>({})`)
 * and has no required property (`{ onSelect?: … }`, `Record<string, number>`). Without a type
 * argument the type is the empty object itself, which reads as a placeholder.
 */
function completeEmpty(call: ts.CallExpression, ctx: FileContext): boolean {
  const [given] = call.typeArguments ?? [];
  if (given === undefined) return false;
  const keys = ctx.types.propertyKeysOf(given);
  return typeof keys === "object" && keys.required.length === 0;
}

/** `null` or `undefined` (`void 0` too), through parentheses. */
function missingLiteral(expression: ts.Expression): "null" | "undefined" | undefined {
  let inner = expression;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  if (inner.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isVoidExpression(inner) || (ts.isIdentifier(inner) && inner.text === "undefined")) {
    return "undefined";
  }
  return undefined;
}

/** Whether a type, as written, includes `null` or `undefined`: `Theme | null`. */
function includesMissing(type: ts.TypeNode, missing: "null" | "undefined"): boolean {
  if (ts.isParenthesizedTypeNode(type)) return includesMissing(type.type, missing);
  if (ts.isUnionTypeNode(type))
    return type.types.some((member) => includesMissing(member, missing));
  return missing === "null"
    ? ts.isLiteralTypeNode(type) && type.literal.kind === ts.SyntaxKind.NullKeyword
    : type.kind === ts.SyntaxKind.UndefinedKeyword;
}

/**
 * `null as Theme | null` or `undefined as Theme | undefined`: a cast that keeps the missing value
 * in the type states an optional or required context (principle 5), the same as
 * `createContext<Theme | null>(null)`.
 */
function statesMissing(argument: ts.Expression): boolean {
  let outer = argument;
  while (ts.isParenthesizedExpression(outer)) outer = outer.expression;
  if (!ts.isAsExpression(outer) && !ts.isTypeAssertionExpression(outer)) return false;
  let inner: ts.Expression = outer;
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isTypeAssertionExpression(inner)
  ) {
    inner = inner.expression;
  }
  const missing = missingLiteral(inner);
  return missing !== undefined && includesMissing(outer.type, missing);
}

const MAX_ARGUMENT_LENGTH = 30;

/** The name of a context that initialises no variable, as the `ignore` option matches it. */
const UNNAMED = "this context";

/** The variable the call initialises (`const X = createContext(...)`), else `UNNAMED`. */
function contextName(call: ts.CallExpression): string {
  const parent = call.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : UNNAMED;
}

/** The argument on one line and at most 30 characters. */
function argumentText(argument: ts.Expression, sourceFile: ts.SourceFile): string {
  const oneLine = argument.getText(sourceFile).replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_ARGUMENT_LENGTH
    ? `${oneLine.slice(0, MAX_ARGUMENT_LENGTH - 1)}\u2026`
    : oneLine;
}

/** Code is written in backticks, so the message standard reads only the prose around it. */
function headline(name: string, argument: string, kind: "cast" | "empty"): string {
  const context = name === UNNAMED ? "context" : `\`${name}\``;
  return kind === "cast"
    ? `${context} defaults to \`${argument}\`, a cast that is not a real value`
    : `${context} defaults to \`${argument}\`, an empty object typed as the full value`;
}

/**
 * The plain TypeScript form, in the developer's names: a context created with `undefined` and a
 * hook that throws when it is missing.
 */
function hint(name: string, call: ts.CallExpression, sourceFile: ts.SourceFile): string {
  const stem = /^([A-Z]\w*)Context$/.exec(name)?.[1];
  const typeArgument = call.typeArguments?.[0]
    ?.getText(sourceFile)
    .replace(/\s*\|\s*(?:null|undefined)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const type = typeArgument !== undefined && typeArgument.length > 0 ? typeArgument : (stem ?? "T");
  const contextName = stem === undefined ? "MyContext" : name;
  const label = stem ?? "My";
  const lines = [
    `    const ${contextName} = createContext<${type} | undefined>(undefined);`,
    `    // in use${label}(): if (value === undefined) throw new Error("${contextName} needs a Provider");`,
  ].map((line) =>
    line.length <= MAX_EXAMPLE_LINE ? line : `${line.slice(0, MAX_EXAMPLE_LINE - 1)}\u2026`,
  );
  const head =
    "create it with `undefined`, and read it in a hook that throws when the Provider is missing:";
  return [head, ...lines].join("\n");
}

const MAX_EXAMPLE_LINE = 100;

/** The guarantee of a `RequiredContext` (`TypeQueries.guaranteesOf`). */
const REQUIRED_CONTEXT = "required-context";

/**
 * Whether the call is the helper's one cast: written in a function declared to return a
 * `RequiredContext` (`function requiredContext<T>(): RequiredContext<T>`), whose readers stateward
 * proves are all under a Provider, so the default is never read.
 */
function inRequiredHelper(call: ts.CallExpression, ctx: FileContext): boolean {
  let current: ts.Node = call.parent;
  while (!ts.isSourceFile(current) && !ts.isFunctionLike(current)) current = current.parent;
  if (!ts.isFunctionLike(current) || current.type === undefined) return false;
  return ctx.types.guaranteesOf(current.type).includes(REQUIRED_CONTEXT);
}

/** Whether the call initialises a variable stated required (`const X: RequiredContext<T> = …`). */
function statedRequired(call: ts.CallExpression, ctx: FileContext): boolean {
  let parent = call.parent;
  while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) parent = parent.parent;
  return (
    ts.isVariableDeclaration(parent) &&
    ctx.types.guaranteesOf(parent.name).includes(REQUIRED_CONTEXT)
  );
}

/** For a context stated required: the helper that makes one without a placeholder in sight. */
function statedHint(call: ts.CallExpression, sourceFile: ts.SourceFile): string {
  const type = call.typeArguments?.[0]?.getText(sourceFile).replace(/\s+/g, " ").trim() ?? "T";
  const line = `    requiredContext<${type}>()`;
  return [
    "create it with `requiredContext` from `guarantees.ts`, which holds the only cast:",
    line.length <= MAX_EXAMPLE_LINE ? line : `${line.slice(0, MAX_EXAMPLE_LINE - 1)}\u2026`,
  ].join("\n");
}

export const fakeDefaultValue = defineRule({
  kind: "file",
  meta: {
    description:
      "Reports a context created with a cast or an empty object as its default (`{} as Theme`, `null!`): a component rendered outside the Provider reads that value, and its type says it is complete.",
    summary:
      "a context created with a cast or `{}` as its default, such as `{} as Theme` or `null!`",
    defaultSeverity: "error",
    tier: "coverage",
    group: "defaults",
    needsTypes: { library: "React", modules: ["react"] },
    options: {
      severities: option.severities({
        kinds: {
          cast: "a cast (`{} as Theme`, `x!`): the type says a real value is there when it is not.",
          empty: "an empty object `{}`: the context's type usually shows the gap.",
        },
        description: "A severity per kind of placeholder.",
      }),
      ignore: option.strings({
        default: [],
        description: "Context names (globs like *Optional*) whose placeholder is on purpose.",
      }),
    },
    explain: EXPLAIN,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isReactCreateContext(node, ctx)) {
        const argument = node.arguments[0];
        const found = placeholderKind(argument);
        const kind = found === "empty" && completeEmpty(node, ctx) ? undefined : found;
        const name = contextName(node);
        if (
          argument !== undefined &&
          kind !== undefined &&
          !matchesName(name, ctx.options.ignore) &&
          !(kind === "cast" && inRequiredHelper(node, ctx))
        ) {
          ctx.report({
            node,
            message: headline(name, argumentText(argument, ctx.sourceFile), kind),
            hint: statedRequired(node, ctx)
              ? statedHint(node, ctx.sourceFile)
              : hint(name, node, ctx.sourceFile),
            findingKind: kind,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
