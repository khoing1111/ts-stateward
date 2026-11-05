import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option } from "@stateward/core";
import type { TypeQueries } from "@stateward/core";
import {
  bindingOf,
  declarationNode,
  isFunctionNode,
  setterCall,
  type StateBinding,
} from "./effects.js";
import { isReactCall, unwrapped } from "./react.js";
import { fitted, MAX_HEADLINE } from "./text.js";

const EXPLAIN = `# react/index-key-on-reordered-list

A list that is filtered, sorted, reversed, spliced or added to at the front is not keyed by the position of its rows.

## Why

React matches a row of the new render to a row of the old one by its \`key\`. With \`key={index}\`, the row at position 2 is always "the same row", whatever item it shows now. Remove the first todo from \`todos.filter(…)\` and every row below it moves up one position: React keeps each row's state (a checked box, text typed into an input, an open menu) at its position, so it now belongs to the next item. The page shows the right text with the wrong state, and nothing reports it.

## When to use it

Use it in any React app that keeps state in its rows or in inputs. A row made only of plain elements and text (no input, select, textarea or component) has no state to move, so it is not reported. It is a warning in every preset and a heuristic: stateward sees that the list changes order or content in this component, not whether the rows keep any state, The React Compiler does not change keys, so it stays on with the compiler. Turn it off for a list that is only ever appended to.

\`eslint-plugin-react\` has \`react/no-array-index-key\`, which reports every index key. This rule reports only a list that changes, so it can stay on where the ESLint rule is too strict.

## What it catches

\`key={index}\` (the second parameter of the \`.map\` callback), also when the key is built from nothing else (\`String(index)\`, or a template with only the index), on a list that:

- is filtered, sorted, reversed or spliced in the same expression (\`todos.filter(…).map(…)\`), or in a variable the component declares (\`const visible = todos.filter(…)\`, also inside \`useMemo\`);
- comes from a state that the component sets with \`filter\`, \`sort\`, \`reverse\`, \`splice\`, \`toSorted\`, \`toReversed\`, \`toSpliced\`, \`unshift\`, or a new item put before the old ones (\`[item, ...todos]\`), anywhere in the component, also in an updater.

### Bad

\`\`\`tsx
const remove = (id: string) => setTodos(todos.filter((todo) => todo.id !== id));
return todos.map((todo, index) => <TodoRow key={index} todo={todo} />);
\`\`\`

### Good

\`\`\`tsx
return todos.map((todo) => <TodoRow key={todo.id} todo={todo} />);
\`\`\`

### Fix

Key each row by something that belongs to the item and does not change: an id, or another unique value the data has. If the items have no id, give each one when it is created (\`crypto.randomUUID()\`). There is no quick fix: only you know which field identifies the item.

## What it does not catch

- A list that comes from props, a hook or a query: stateward does not see what its owner does to it.
- A list changed in another file, or by a function that returns a new list (\`setTodos(removeDone(todos))\`).
- A list set from a variable computed earlier (\`const next = todos.filter(…); setTodos(next)\`).
- An index key on a list that is only appended to: its rows keep their positions, so it is not reported.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "react/index-key-on-reordered-list": "off" } // or "error"
groups: { "react/state-updates": "off" } // the whole group
rules: { "react/index-key-on-reordered-list": ["warning", { textOnlyRows: true }] } // text rows too
\`\`\`
`;

/** The operations that move or remove rows, by method, and how the message says it. */
const OPERATIONS: ReadonlyMap<string, string> = new Map([
  ["filter", "filtered"],
  ["sort", "sorted"],
  ["toSorted", "sorted"],
  ["reverse", "reversed"],
  ["toReversed", "reversed"],
  ["splice", "spliced"],
  ["toSpliced", "spliced"],
  ["unshift", "prepended to"],
]);

type Change = { name: string; operation: string };

/** The first method in a call chain that moves rows: `todos.filter(…).map` gives filtered. */
function operationIn(
  expression: ts.Expression,
): { operation: string; root: ts.Expression } | undefined {
  let current = unwrapped(expression);
  let found: string | undefined;
  for (;;) {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      found ??= OPERATIONS.get(current.expression.name.text);
      current = unwrapped(current.expression.expression);
    } else if (ts.isArrayLiteralExpression(current)) {
      // `[...todos].sort()`: the copy is the list the operation works on.
      const [first] = current.elements;
      if (current.elements.length === 1 && first !== undefined && ts.isSpreadElement(first)) {
        current = unwrapped(first.expression);
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return found === undefined ? undefined : { operation: found, root: current };
}

/** The receiver a call chain starts from: `todos` in `todos.filter(…).slice(0, 5)`. */
function baseOf(expression: ts.Expression): ts.Expression {
  let current = unwrapped(expression);
  for (;;) {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      current = unwrapped(current.expression.expression);
    } else if (ts.isArrayLiteralExpression(current) && current.elements.length === 1) {
      const [only] = current.elements;
      if (only === undefined || !ts.isSpreadElement(only)) return current;
      current = unwrapped(only.expression);
    } else {
      return current;
    }
  }
}

/** The name a list goes by in a message: `todos`, `props.todos`. */
function listName(expression: ts.Expression): string | undefined {
  const base = baseOf(expression);
  return ts.isIdentifier(base) || ts.isPropertyAccessExpression(base)
    ? base.getText().replace(/\s+/g, " ")
    : undefined;
}

/** The change a list is built with: in its own chain, in a variable of the component, or in its state. */
function changeOf(
  types: TypeQueries,
  list: ts.Expression,
  owner: ts.Node,
  depth = 0,
): Change | undefined {
  const direct = operationIn(list);
  const named = listName(list);
  if (direct !== undefined) {
    return named === undefined ? undefined : { name: named, operation: direct.operation };
  }
  const base = baseOf(list);
  if (!ts.isIdentifier(base) || depth >= 3) return undefined;
  const bound = bindingOf(types, base);
  if (bound?.part === "state") {
    const operation = changeToState(types, bound.binding, owner);
    return operation === undefined ? undefined : { name: bound.binding.state, operation };
  }
  const declaration = declarationNode(types, base);
  if (
    declaration === undefined ||
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer === undefined ||
    declaration.pos < owner.pos ||
    declaration.end > owner.end
  ) {
    return undefined;
  }
  const init = unwrapped(declaration.initializer);
  if (ts.isCallExpression(init) && isReactCall(types, init, "useMemo")) {
    const [factory] = init.arguments;
    const made = factory === undefined ? undefined : unwrapped(factory);
    if (made === undefined || !(ts.isArrowFunction(made) || ts.isFunctionExpression(made))) {
      return undefined;
    }
    for (const expression of returnsOf(made)) {
      const change = changeOf(types, expression, owner, depth + 1);
      if (change !== undefined) return change;
    }
    return undefined;
  }
  return changeOf(types, init, owner, depth + 1);
}

function returnsOf(fn: ts.ArrowFunction | ts.FunctionExpression): ts.Expression[] {
  if (!ts.isBlock(fn.body)) return [fn.body];
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionNode(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) found.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return found;
}

/** What a value given to a setter does to the list: filtered, sorted, a new first item, … */
function operationOfSet(argument: ts.Expression): string | undefined {
  const value = unwrapped(argument);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    for (const expression of returnsOf(value)) {
      const found = operationOfSet(expression);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (ts.isConditionalExpression(value)) {
    return operationOfSet(value.whenTrue) ?? operationOfSet(value.whenFalse);
  }
  if (ts.isArrayLiteralExpression(value)) {
    const [first] = value.elements;
    const spreadsLater = value.elements.some(
      (element, index) => index > 0 && ts.isSpreadElement(element),
    );
    if (first !== undefined && !ts.isSpreadElement(first) && spreadsLater) return "prepended to";
    // `[...todos].sort()` is a call; a bare copy keeps the order.
    return undefined;
  }
  return operationIn(value)?.operation;
}

/** The first change the component makes to a state's list, by the order it is written. */
function changeToState(
  types: TypeQueries,
  binding: StateBinding,
  owner: ts.Node,
): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    const set = setterCall(types, node);
    const argument = set?.call.arguments[0];
    if (set !== undefined && argument !== undefined && set.binding.call === binding.call) {
      found = operationOfSet(argument);
    }
    if (found === undefined) ts.forEachChild(node, visit);
  };
  visit(owner);
  return found;
}

/** The `.map` callback and call a `key={index}` belongs to, when the key is the callback's index. */
function mapOf(
  types: TypeQueries,
  key: ts.Expression,
): { callback: ts.ArrowFunction | ts.FunctionExpression; call: ts.CallExpression } | undefined {
  let index = unwrapped(key);
  if (ts.isTemplateExpression(index) && index.templateSpans.length === 1) {
    const [span] = index.templateSpans;
    if (span !== undefined) index = unwrapped(span.expression);
  } else if (
    ts.isCallExpression(index) &&
    ts.isIdentifier(index.expression) &&
    index.expression.text === "String" &&
    index.arguments.length === 1
  ) {
    const [argument] = index.arguments;
    if (argument !== undefined) index = unwrapped(argument);
  }
  if (!ts.isIdentifier(index)) return undefined;
  const declaration = declarationNode(types, index);
  if (declaration === undefined || !ts.isParameter(declaration)) return undefined;
  const callback = declaration.parent;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined;
  if (callback.parameters.indexOf(declaration) !== 1) return undefined;
  const call = callback.parent;
  if (
    !ts.isCallExpression(call) ||
    !ts.isPropertyAccessExpression(call.expression) ||
    call.expression.name.text !== "map" ||
    call.arguments[0] !== callback
  ) {
    return undefined;
  }
  return { callback, call };
}

/** The component (outermost function) around a node. */
function ownerOf(node: ts.Node): ts.Node {
  let owner: ts.Node = node;
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (isFunctionNode(current)) owner = current;
  }
  return owner;
}

/** The rows' item as the callback names it: `todo` in `todos.map((todo, index) => …)`. */
/**
 * Whether a row is only intrinsic elements and text: no input, no component, so it holds no state
 * that a position key could attach to the wrong item.
 */
function rendersOnlyText(callback: ts.ArrowFunction | ts.FunctionExpression): boolean {
  let tags = 0;
  let stateful = false;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      tags += 1;
      const name = node.tagName.getText();
      if (!/^[a-z]/.test(name) || ["input", "select", "textarea"].includes(name)) stateful = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(callback.body);
  return tags > 0 && !stateful;
}

function itemName(callback: ts.ArrowFunction | ts.FunctionExpression): string | undefined {
  const [first] = callback.parameters;
  return first !== undefined && ts.isIdentifier(first.name) ? first.name.text : undefined;
}

export const indexKeyOnReorderedList = defineRule({
  kind: "file",
  meta: {
    description:
      "A list that is filtered, sorted, reversed, spliced or added to at the front is not keyed by the position of its rows.",
    defaultSeverity: "warning",
    tier: "core",
    group: "render",
    heuristic: true,
    options: {
      textOnlyRows: option.boolean({
        default: false,
        description:
          "Also report rows made only of plain elements and text, which have no state to move (their focus and selection still can).",
      }),
      ignore: option.strings({
        default: [],
        description: "Lists (names or globs like *Log) keyed by position on purpose.",
      }),
    },
    explain: EXPLAIN,
  },
  check(ctx) {
    const { sourceFile, types } = ctx;
    const visit = (node: ts.Node): void => {
      const key =
        ts.isJsxAttribute(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "key" &&
        node.initializer !== undefined &&
        ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : undefined;
      const map = key === undefined ? undefined : mapOf(types, key);
      if (
        key !== undefined &&
        map !== undefined &&
        ts.isPropertyAccessExpression(map.call.expression)
      ) {
        const change = changeOf(types, map.call.expression.expression, ownerOf(node));
        if (
          change !== undefined &&
          !matchesName(change.name, ctx.options.ignore) &&
          (ctx.options.textOnlyRows || !rendersOnlyText(map.callback))
        ) {
          const item = itemName(map.callback);
          const example = item === undefined ? "an id" : `${item}.id`;
          const tails = [
            "so a row's state moves to the wrong item",
            "so row state moves to the wrong item",
          ];
          const build = (tail: string) =>
            fitted(
              (cut) =>
                `rows here are keyed by position, but \`${cut.name(change.name)}\` is ${change.operation}, ${tail}`,
            );
          const full = build(tails[0] ?? "");
          ctx.report({
            message: full.length <= MAX_HEADLINE ? full : build(tails[1] ?? ""),
            hint: fitted(
              (cut) =>
                `key each row by something the item owns, such as \`key={${cut.name(example)}}\`, so its state stays with it`,
            ),
            node: key,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  },
});
