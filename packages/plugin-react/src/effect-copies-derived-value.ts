import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option } from "@stateward/core";
import type { TypeQueries } from "@stateward/core";
import {
  bindingOf,
  declarationNode,
  effectsIn,
  isRead,
  nameList,
  propOf,
  setterCall,
  startsAsProp,
  textOf,
  within,
  type Effect,
  type StateBinding,
} from "./effects.js";
import { unwrapped } from "./react.js";
import { fitted } from "./text.js";

const EXPLAIN = `# react/effect-copies-derived-value

A value computed from props or state is computed while rendering, not copied into state by an effect.

## Why

\`useEffect(() => { setFullName(first + " " + last); }, [first, last])\` keeps a second copy of something the component already knows. When \`first\` changes, React renders once with the old \`fullName\`, runs the effect, and renders again with the new one. For one render the screen, and any code that reads \`fullName\`, sees a stale value; and the state has two owners, the props and the effect.

## When to use it

Use it in any React app. It is a warning in every preset. It stays on with the React Compiler: the compiler memoizes values, but it does not remove an effect that copies one.

It checks only the exact shape below, where the fix is certain. For every \`setState\` called directly in an effect, turn on \`set-state-in-effect\` from \`eslint-plugin-react-hooks\`.

## What it catches

An effect whose whole body is one call \`setX(…)\`, where the new value reads only props, state and module-level names, its dependencies are props or state, and \`setX\` is called nowhere else in the component.

### Bad

\`\`\`tsx
const [fullName, setFullName] = useState("");
useEffect(() => {
  setFullName(\`\${first} \${last}\`);
}, [first, last]);
\`\`\`

### Good

\`\`\`tsx
const fullName = \`\${first} \${last}\`;
\`\`\`

### Fix

Compute the value while rendering, and remove the state and the effect. When the computation calls a function that is slow (filtering a long list), wrap it in \`useMemo\` with the same dependencies. There is no quick fix.

## What it does not catch

- An effect that does anything else as well (logs, sets two states, checks a condition).
- A value computed from a local variable, a ref or a function declared in the component.
- A state that is also set elsewhere (an event handler): it is not only derived.
- A state whose initial value is the same prop: \`react/state-copies-prop\` reports it.
- An effect whose dependencies are not written as an array in the call.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "react/effect-copies-derived-value": "off" } // or "error"
groups: { "react/effects": "off" } // the whole group
rules: { "react/effect-copies-derived-value": ["warning", { ignore: ["draft*"] }] } // states copied on purpose
\`\`\`
`;

/** The single `setX(value)` an effect's body consists of, or undefined. */
function onlySetter(
  types: TypeQueries,
  effect: Effect,
): { binding: StateBinding; call: ts.CallExpression; value: ts.Expression } | undefined {
  const { body } = effect.callback;
  let expression: ts.Expression;
  if (ts.isBlock(body)) {
    const [only, ...rest] = body.statements;
    if (only === undefined || rest.length > 0 || !ts.isExpressionStatement(only)) return undefined;
    expression = only.expression;
  } else {
    expression = body;
  }
  const set = setterCall(types, unwrapped(expression));
  const [value, ...extra] = set?.call.arguments ?? [];
  if (set === undefined || value === undefined || extra.length > 0) return undefined;
  const inner = unwrapped(value);
  // `setX((previous) => …)` reads the previous state: not a value derived from props.
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return undefined;
  return { ...set, value: inner };
}

/**
 * The props and states a value reads, as written, in order and each once; undefined when it
 * reads anything else of the component (a local, a ref, a function) or the state it sets.
 */
function sources(
  types: TypeQueries,
  value: ts.Expression,
  effect: Effect,
  binding: StateBinding,
  sourceFile: ts.SourceFile,
): string[] | undefined {
  const names: string[] = [];
  // An object, so the check after the walk sees what the callback set.
  const seen = { other: false };
  const visit = (node: ts.Node): void => {
    if (seen.other) return;
    if (ts.isPropertyAccessExpression(node) && propOf(types, node, effect.owner) !== undefined) {
      const text = textOf(node, sourceFile);
      if (!names.includes(text)) names.push(text);
      return;
    }
    if (ts.isIdentifier(node) && isRead(node)) {
      const declaration = declarationNode(types, node);
      // Names declared in the value itself (a callback's parameters), or outside the component.
      if (
        declaration === undefined ||
        within(declaration, value) ||
        !within(declaration, effect.owner)
      ) {
        return;
      }
      const state = bindingOf(types, node);
      const isProp = propOf(types, node, effect.owner) !== undefined;
      const isState = state?.part === "state" && state.binding.call !== binding.call;
      if (!isProp && !isState) {
        seen.other = true;
        return;
      }
      if (!names.includes(node.text)) names.push(node.text);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(value);
  return seen.other ? undefined : names;
}

/** Whether every dependency is a prop or a state. */
function depsAreInputs(types: TypeQueries, effect: Effect): boolean {
  if (effect.deps === "none" || effect.deps === "unreadable") return false;
  return effect.deps.every((dep) => {
    const node = unwrapped(dep);
    if (propOf(types, node, effect.owner) !== undefined) return true;
    return ts.isIdentifier(node) && bindingOf(types, node)?.part === "state";
  });
}

/** How many times the component calls or passes on the setter, the effect's call included. */
function setterUses(types: TypeQueries, effect: Effect, binding: StateBinding): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === binding.setter && isRead(node)) {
      const found = bindingOf(types, node);
      if (found?.part === "setter" && found.binding.call === binding.call) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(effect.owner);
  return count;
}

/** What the first call in a value calls (`filterUsers`), or undefined. */
function firstCall(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isCallExpression(node)) return textOf(node.expression, sourceFile);
  return ts.forEachChild(node, (child) => firstCall(child, sourceFile));
}

function hintFor(binding: StateBinding, value: ts.Expression, sourceFile: ts.SourceFile): string {
  const called = firstCall(value, sourceFile);
  const code = `const ${binding.state} = ${textOf(value, sourceFile)};`;
  const head = fitted((cut) =>
    called === undefined
      ? "compute it while rendering, and remove the state and the effect:"
      : `compute it while rendering (in \`useMemo\` if \`${cut.name(called)}\` is slow), and remove the state and the effect:`,
  );
  return code.length + 4 <= 100 ? `${head}\n    ${code}` : `${head} \`const ${binding.state} = …\``;
}

export const effectCopiesDerivedValue = defineRule({
  kind: "file",
  meta: {
    description:
      "A value computed from props or state is computed while rendering, not copied into state by an effect.",
    defaultSeverity: "warning",
    tier: "core",
    group: "effects",
    options: {
      ignore: option.strings({
        default: [],
        description: "State names (globs like draft*) that may be copied this way on purpose.",
      }),
    },
    explain: EXPLAIN,
  },
  check(ctx) {
    const { sourceFile, types } = ctx;
    for (const effect of effectsIn(types, sourceFile)) {
      const set = onlySetter(types, effect);
      if (set === undefined || !depsAreInputs(types, effect)) continue;
      const { binding, call, value } = set;
      if (matchesName(binding.state, ctx.options.ignore)) continue;
      if (startsAsProp(types, binding, value, effect.owner)) continue;
      if (setterUses(types, effect, binding) !== 1) continue;
      const names = sources(types, value, effect, binding, sourceFile);
      if (names === undefined || names.length === 0) continue;
      ctx.report({
        message: fitted(
          (cut) =>
            `\`${cut.name(binding.state)}\` is copied from ${nameList(names, cut.name)} in an effect: an extra render with a stale value first`,
        ),
        hint: hintFor(binding, value, sourceFile),
        node: call,
      });
    }
  },
});
