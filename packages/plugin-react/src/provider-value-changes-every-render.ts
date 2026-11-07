import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option } from "@stateward/core";
import type { FileContext } from "@stateward/core";
import { noun, wrapper } from "./messages.js";
import { isReactCall, reactName, unwrapped, usesCompiler } from "./react.js";
import { fitted, shorten } from "./text.js";
import { RenderScope, isFunctionLike, renderFunctionOf, type Value } from "./value.js";

const EXPLAIN = `# react/provider-value-changes-every-render

A Provider value created on every render re-renders every component that reads the context, even when nothing in the value changed.

\`\`\`tsx example-bad
import { createContext, useState, type ReactNode } from "react";

type Theme = { theme: string; setTheme: (theme: string) => void };
const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState("light");
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
\`\`\`

Wrap the value in \`useMemo\`, with what it reads as dependencies:

\`\`\`tsx example-good
import { createContext, useMemo, useState, type ReactNode } from "react";

type Theme = { theme: string; setTheme: (theme: string) => void };
const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState("light");
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
\`\`\`

Use \`useCallback\` for a function. There is no quick fix. When the value reads something that is itself new on every render (a plain function in the component, an object in a \`const\`), \`useMemo\` would list it as a dependency and run again every render: the message names it, and says to make it stable first, where it is created. When the value uses the parameters of a function inside the component (a \`.map\` callback, a render prop), no hook can be called there: move the item into a component that takes them as props, and use \`useMemo\` in it.

## Why it matters

Every component that reads a context re-renders when the Provider's \`value\` changes. \`value={{ theme, setTheme }}\` is a new object on every render of the component that provides it, so every reader re-renders with it, and every effect that depends on the context runs again, even when nothing in it changed.

## What it does not catch

It looks at \`<Ctx.Provider value={…}>\`, or \`<Ctx value={…}>\` for a context from \`createContext\` (React 19), whose value is an object or array literal, an inline function or \`new X()\`, written in the prop or in a local \`const\` of the providing component. It is silent on:

- a value from a custom hook (\`value={useCartState()}\`);
- an input that is a prop the parent passes inline (\`<ThemeProvider onChange={() => …}>\`): this rule reads one file at a time, and those props are the parent's;
- \`<Ctx value>\` for a context made by a helper other than React's \`createContext\`: only its \`<Ctx.Provider>\` form is recognised;
- apps built with the React Compiler (\`babel-plugin-react-compiler\` or \`react-compiler-runtime\` in the nearest \`package.json\`), which keeps the value stable.

## Turn it on or off

\`\`\`ts
rules: { "react/provider-value-changes-every-render": "off" } // or "error"
rules: { "react/provider-value-changes-every-render": ["warning", { ignore: ["ToastContext"] }] } // a context with few readers
\`\`\`
`;

/** The context a JSX tag provides, as written (`ThemeContext`), or undefined. */
function providedContext(ctx: FileContext, tag: ts.JsxTagNameExpression): string | undefined {
  if (ts.isPropertyAccessExpression(tag) && tag.name.text === "Provider") {
    return reactName(ctx.types, tag.name) === "Provider"
      ? tag.expression.getText(ctx.sourceFile)
      : undefined;
  }
  if (!ts.isIdentifier(tag)) return undefined;
  const symbol = ctx.types.symbolAt(tag);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  const node = declaration?.node;
  return node !== undefined &&
    ts.isVariableDeclaration(node) &&
    node.initializer !== undefined &&
    isReactCall(ctx.types, node.initializer, "createContext")
    ? tag.text
    : undefined;
}

/** The names a value reads from the component it is written in, in order, each once. */
function readNames(expression: ts.Node, scope: RenderScope): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !names.includes(node.text)) {
      const parent = node.parent;
      const isKey =
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node);
      const declared = isKey ? undefined : scope.declarationOf(node);
      if (
        declared !== undefined &&
        scope.isLocal(declared) &&
        !(declared.pos >= expression.pos && declared.end <= expression.end)
      ) {
        // `{ ...props }` is a new object every render: depend on what is read from it
        // (`props.name`), not on `props` (real-world corpus, bulletproof-react's form).
        const dependency =
          ts.isBindingElement(declared) &&
          declared.dotDotDotToken !== undefined &&
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node
            ? `${node.text}.${parent.name.text}`
            : node.text;
        if (!names.includes(dependency)) names.push(dependency);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return names;
}

/**
 * The names a value reads from a function nested in the component (a `.map` callback, a render
 * prop), in order, each once: a hook cannot be called there, so the value cannot be memoized in
 * place.
 */
function nestedReads(expression: ts.Node, scope: RenderScope): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !names.includes(node.text)) {
      const parent = node.parent;
      const isKey =
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node);
      const declared = isKey ? undefined : scope.declarationOf(node);
      if (
        declared !== undefined &&
        scope.isLocal(declared) &&
        !(declared.pos >= expression.pos && declared.end <= expression.end) &&
        inNestedFunction(declared, scope.fn)
      ) {
        names.push(node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return names;
}

/** Whether a declaration is in a function nested in `fn` (its parameters included). */
function inNestedFunction(declared: ts.Node, fn: ts.Node): boolean {
  for (let current = declared.parent; current !== fn; current = current.parent) {
    if (ts.isSourceFile(current)) return false;
    if (isFunctionLike(current)) return true;
  }
  return false;
}

/** `ItemProvider` for `ItemContext`: the component the example extracts. */
function providerName(context: string): string {
  const base = (context.split(".").pop() ?? context).replace(/Context$/, "");
  return `${base.length === 0 ? "Value" : base}Provider`;
}

/** The node that spans exactly `at`, if any. */
function nodeAt(
  sourceFile: ts.SourceFile,
  at: { start: number; end: number },
): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined || node.end < at.start || node.pos > at.end) return;
    if (node.getStart(sourceFile) === at.start && node.end === at.end) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** `themeValue` for `ThemeContext`: the name the example gives the memoized value. */
function valueName(context: string): string {
  const base = (context.split(".").pop() ?? context).replace(/Context$/, "");
  return base.length === 0 ? "value" : `${base.charAt(0).toLowerCase()}${base.slice(1)}Value`;
}

/** A name the value reads that is itself new every render, and where it is made. */
type UnstableInput = { name: string; value: Extract<Value, { kind: "fresh" }>; node: ts.Node };

/**
 * The names a value reads from the component that are created anew on every render: a plain
 * function in the body, an inline function, object or array in a `const`. A `useMemo` of the
 * value would list them as dependencies and so run on every render too.
 */
function unstableInputs(
  created: ts.Node,
  scope: RenderScope,
  sourceFile: ts.SourceFile,
): UnstableInput[] {
  const found: UnstableInput[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !found.some((input) => input.name === node.text)) {
      const parent = node.parent;
      const isKey =
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node);
      const declared = isKey ? undefined : scope.declarationOf(node);
      if (
        declared !== undefined &&
        scope.isLocal(declared) &&
        !(declared.pos >= created.pos && declared.end <= created.end)
      ) {
        const value = scope.valueOf(node);
        if (value.kind === "fresh") {
          found.push({ name: node.text, value, node: nodeAt(sourceFile, value.at) ?? declared });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(created);
  return found;
}

/** The most unstable inputs a hint names; the rest are counted. */
const MAX_INPUTS = 2;

/**
 * The fix when the value reads names that are new every render: stabilise those first, each with
 * its own hook where it is created, in the developer's names. No `useMemo` snippet: with those
 * inputs as dependencies it would do nothing.
 */
function inputsHint(inputs: readonly UnstableInput[]): string {
  const shown = inputs.slice(0, MAX_INPUTS);
  const more = inputs.length - shown.length;
  const rest = more > 0 ? ` (and ${String(more)} more)` : "";
  const hooks = new Set(shown.map((input) => wrapper(input.value.what)));
  const [only] = hooks;
  const they = inputs.length > 1 ? "they are" : "it is";
  return fitted((cut) => {
    const name = (input: UnstableInput): string => `\`${cut.name(input.name)}\``;
    const line = (input: UnstableInput): string => String(input.value.at.line);
    const step =
      hooks.size === 1 && only !== undefined
        ? `stabilise ${shown.map(name).join(" and ")}${rest} first (\`${only}\`${
            shown.length > 1
              ? `, lines ${shown.map(line).join(", ")}`
              : ` where it is created, line ${shown.map(line).join("")}`
          })`
        : `stabilise ${shown
            .map(
              (input) => `${name(input)} (\`${wrapper(input.value.what)}\`, line ${line(input)})`,
            )
            .join(" and ")}${rest} first`;
    return `${step}: ${they} new every render, so a memo of the value would be new too`;
  });
}

/** The fix line, with the memoized value written out when the literal is short. */
function hintFor(
  context: string,
  value: Extract<Value, { kind: "fresh" }>,
  inline: ts.Expression,
  scope: RenderScope,
  sourceFile: ts.SourceFile,
): { hint: string; inputs: readonly UnstableInput[] } {
  const hook = wrapper(value.what);
  const created = value.label === null ? inline : (nodeAt(sourceFile, value.at) ?? inline);
  const nested = nestedReads(created, scope);
  if (nested.length > 0 || (value.label !== null && inNestedFunction(created, scope.fn))) {
    const hint = fitted((cut) => {
      const props =
        nested.length === 0
          ? "…"
          : nested.map((name) => `${cut.name(name)}={${cut.name(name)}}`).join(" ");
      return `extract the item into a component (e.g. \`<${cut.name(providerName(context))} ${props}>\`) and memoize the value there`;
    });
    return { hint, inputs: [] };
  }
  const inputs = unstableInputs(created, scope, sourceFile);
  if (inputs.length > 0) return { hint: inputsHint(inputs), inputs };
  const reads = readNames(inline, scope);
  if (value.label !== null) {
    const hint = fitted(
      (cut) =>
        `wrap \`${cut.name(value.label ?? "")}\` in \`${hook}\` where it is created (line ${String(value.at.line)})`,
    );
    return { hint, inputs };
  }
  const text = inline.getText(sourceFile).replace(/\s+/g, " ");
  const name = valueName(context);
  const body = value.what === "object" && ts.isObjectLiteralExpression(inline) ? `(${text})` : text;
  const code =
    value.what === "function"
      ? `const ${name} = useCallback(${text}, [${reads.join(", ")}]);`
      : `const ${name} = useMemo(() => ${body}, [${reads.join(", ")}]);`;
  const head = `wrap it in \`${hook}\` and pass that:`;
  const hint =
    code.length + 4 <= 100 ? `${head}\n    ${code}` : `${head} \`const ${name} = ${hook}(…)\``;
  return { hint, inputs };
}

export const providerValueChangesEveryRender = defineRule({
  kind: "file",
  meta: {
    description:
      "A Provider value created on every render re-renders every component that reads the context, even when nothing in the value changed.",
    summary: "a context Provider given a new object or function on every render",
    defaultSeverity: "warning",
    tier: "core",
    group: "render",
    needsTypes: { library: "React", modules: ["react"] },
    options: {
      ignore: option.strings({
        default: [],
        description:
          "Contexts (names or globs) whose readers are few or cheap, so a new value each render is fine.",
      }),
    },
    explain: EXPLAIN,
  },
  check(ctx) {
    if (usesCompiler(ctx.types, ctx.file)) return;
    const { sourceFile } = ctx;
    const scopes = new Map<ts.Node, RenderScope>();
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const context = providedContext(ctx, node.tagName);
        const attribute = node.attributes.properties.find(
          (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "value",
        );
        const init = attribute?.initializer;
        if (
          context !== undefined &&
          !matchesName(context, ctx.options.ignore) &&
          init !== undefined &&
          ts.isJsxExpression(init) &&
          init.expression !== undefined
        ) {
          const fn = renderFunctionOf(node);
          if (fn !== undefined) {
            let scope = scopes.get(fn);
            if (scope === undefined) {
              scope = new RenderScope(ctx.types, sourceFile, fn);
              scopes.set(fn, scope);
            }
            const expression = unwrapped(init.expression);
            const value = scope.valueOf(expression);
            if (value.kind === "fresh") {
              const fix = hintFor(context, value, expression, scope, sourceFile);
              ctx.report({
                message: fitted(
                  (cut) =>
                    `\`${cut.name(context)}\` value is a new ${noun(value.what)} every render: all its readers re-render`,
                ),
                hint: fix.hint,
                node: init.expression,
                related: [
                  ...(value.label === null
                    ? []
                    : [
                        {
                          node: nodeAt(sourceFile, value.at) ?? expression,
                          message: `\`${shorten(value.label)}\` is created on every render`,
                        },
                      ]),
                  ...fix.inputs.map((input) => ({
                    node: input.node,
                    message: `\`${shorten(input.name)}\` is created on every render`,
                  })),
                ],
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  },
});
