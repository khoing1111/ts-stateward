import ts from "@stateward/core/typescript";
import { defineRule } from "@stateward/core";
import type { TypeQueries } from "@stateward/core";
import {
  bindingOf,
  effectsIn,
  forEachOwn,
  isFunctionNode,
  isRead,
  setterCall,
  type Effect,
  type StateBinding,
} from "./effects.js";
import { unwrapped } from "./react.js";
import { fitted } from "./text.js";

const EXPLAIN = `# react/effect-loops

An effect does not set, every time it runs, a state it depends on to a new value: that is a render loop.

## Why

\`useEffect(() => { setCount(count + 1); }, [count])\` sets \`count\`, which re-renders the component; \`count\` changed, so the effect runs again, and sets it again. The page freezes or React stops it with "Maximum update depth exceeded". The same happens with a new object or array each time (\`setFilters({ ...filters, page: 1 })\`, \`setItems(items.filter(…))\`): React compares state by identity, so a new object is always a change.

## When to use it

Use it in any React app. It is an error in every preset: the loop is certain. It stays on with the React Compiler, which does not change what an effect sets.

## What it catches

An effect with the state in its dependency list (or with no list, so it runs after every render) that calls the state's setter with no condition around it, and with a value that is always new:

- the state changed by arithmetic or negation (\`count + 1\`, \`!open\`) or put in a template string;
- a new object or array (a literal, \`new\`, \`.map\`, \`.filter\`, \`.concat\`, \`.slice\` and the like);
- an updater function that returns one of these (\`setCount((c) => c + 1)\`).

### Bad

\`\`\`tsx
useEffect(() => {
  setFilters({ ...filters, page: 1 });
}, [filters]);
\`\`\`

### Good

\`\`\`tsx
useEffect(() => {
  if (filters.page !== 1) setFilters({ ...filters, page: 1 });
}, [filters]);
\`\`\`

### Fix

Set the state only when it must change, with a condition that compares the old and the new value. Better still, make the change in the event that causes it (the handler that changes the filters), and remove the effect. There is no quick fix.

## What it does not catch

- A set inside any condition, loop or \`try\`: a condition that compares the old and new value stops the loop, and stateward does not judge other conditions.
- A value that is not always new (\`setName(props.name)\`): React skips a set to the same value, so it does not loop.
- A loop through two states or two effects (\`a\` sets \`b\`, \`b\` sets \`a\`).
- A set in a callback the effect starts (a timer, a listener, a \`.then\`).
- An effect whose dependencies are not written as an array in the call.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "react/effect-loops": "off" } // or "warning"
groups: { "react/effects": "off" } // the whole group
\`\`\`
`;

/** Array methods that return a new array each call. */
const COPYING_METHODS: ReadonlySet<string> = new Set([
  "map",
  "filter",
  "slice",
  "concat",
  "flat",
  "flatMap",
  "toSorted",
  "toReversed",
  "toSpliced",
  "with",
]);

const CHANGING_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
]);

/** Whether an expression reads one of `names` (the state, or an updater's parameter). */
function reads(expression: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && names.has(node.text) && isRead(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

/** Whether a value differs from the previous state every time it is computed. */
function alwaysNew(expression: ts.Expression, state: ReadonlySet<string>): boolean {
  const value = unwrapped(expression);
  if (
    ts.isObjectLiteralExpression(value) ||
    ts.isArrayLiteralExpression(value) ||
    ts.isNewExpression(value)
  ) {
    return true;
  }
  if (
    ts.isCallExpression(value) &&
    ts.isPropertyAccessExpression(value.expression) &&
    COPYING_METHODS.has(value.expression.name.text)
  ) {
    return true;
  }
  if (ts.isBinaryExpression(value) && CHANGING_OPERATORS.has(value.operatorToken.kind)) {
    const other = (side: ts.Expression): boolean => {
      const inner = unwrapped(side);
      return !(ts.isNumericLiteral(inner) && Number(inner.text) === 0);
    };
    return (
      (reads(value.left, state) && other(value.right)) ||
      (reads(value.right, state) && other(value.left))
    );
  }
  if (
    ts.isPrefixUnaryExpression(value) &&
    value.operator === ts.SyntaxKind.ExclamationToken &&
    reads(value.operand, state)
  ) {
    return true;
  }
  if (ts.isTemplateExpression(value)) return reads(value, state);
  return false;
}

/** Whether a setter's argument is always a new value: an updater is judged by what it returns. */
function setsNew(argument: ts.Expression, binding: StateBinding): boolean {
  const value = unwrapped(argument);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    const [parameter] = value.parameters;
    const names = new Set<string>([binding.state]);
    if (parameter !== undefined && ts.isIdentifier(parameter.name)) names.add(parameter.name.text);
    if (!ts.isBlock(value.body)) return alwaysNew(value.body, names);
    const [only] = value.body.statements;
    return (
      value.body.statements.length === 1 &&
      only !== undefined &&
      ts.isReturnStatement(only) &&
      only.expression !== undefined &&
      alwaysNew(only.expression, names)
    );
  }
  return alwaysNew(value, new Set([binding.state]));
}

/** Whether nothing decides whether a node runs: no condition, loop or `try` up to the effect. */
function unconditional(node: ts.Node, effect: Effect): boolean {
  for (let current = node.parent; current !== effect.callback; current = current.parent) {
    if (
      ts.isIfStatement(current) ||
      ts.isConditionalExpression(current) ||
      ts.isSwitchStatement(current) ||
      ts.isIterationStatement(current, false) ||
      ts.isTryStatement(current) ||
      ts.isCatchClause(current) ||
      (ts.isBinaryExpression(current) &&
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(current.operatorToken.kind)) ||
      isFunctionNode(current)
    ) {
      return false;
    }
  }
  // An early `return` before the set is a condition too: `if (x === next) return;`.
  let returnsEarly = false;
  forEachOwn(effect.callback, (other) => {
    if (ts.isReturnStatement(other) && other.end <= node.pos) returnsEarly = true;
  });
  return !returnsEarly;
}

/** Whether the effect's dependencies hold the state (true when there is no list at all). */
function dependsOn(types: TypeQueries, effect: Effect, binding: StateBinding): boolean {
  if (effect.deps === "none") return true;
  if (effect.deps === "unreadable") return false;
  return effect.deps.some((dep) => {
    const node = unwrapped(dep);
    const found = ts.isIdentifier(node) ? bindingOf(types, node) : undefined;
    return found?.part === "state" && found.binding.call === binding.call;
  });
}

export const effectLoops = defineRule({
  kind: "file",
  meta: {
    description:
      "An effect does not set, every time it runs, a state it depends on to a new value: that is a render loop.",
    defaultSeverity: "error",
    tier: "core",
    group: "effects",
    explain: EXPLAIN,
  },
  check(ctx) {
    const { sourceFile, types } = ctx;
    for (const effect of effectsIn(types, sourceFile)) {
      forEachOwn(effect.callback, (node) => {
        const set = setterCall(types, node);
        const argument = set?.call.arguments[0];
        if (set === undefined || argument === undefined) return;
        const { binding } = set;
        if (!dependsOn(types, effect, binding) || !setsNew(argument, binding)) return;
        if (!unconditional(set.call, effect)) return;
        const { state, setter } = binding;
        ctx.report({
          message: fitted((cut) =>
            effect.deps === "none"
              ? `this effect runs after every render and sets \`${cut.name(state)}\` to a new value each time: a render loop`
              : `this effect sets \`${cut.name(state)}\`, one of its own dependencies, to a new value each time: a render loop`,
          ),
          hint: fitted(
            (cut) =>
              `set it only when it must change (\`if (…) ${cut.name(setter)}(…)\`), or make the change in the event that causes it`,
          ),
          node: set.call,
        });
      });
    }
  },
});
