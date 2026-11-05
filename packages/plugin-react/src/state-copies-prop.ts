import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option } from "@stateward/core";
import type { TypeQueries } from "@stateward/core";
import {
  bindingOf,
  effectsIn,
  forEachOwn,
  isRead,
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

const EXPLAIN = `# react/state-copies-prop

A state is not a copy of a prop that an effect keeps in step: one value, one owner.

## Why

\`const [draft, setDraft] = useState(name)\` plus \`useEffect(() => setDraft(name), [name])\` keeps two copies of one value. They disagree for a render after every change of \`name\` (the effect runs after the screen shows the old copy), and an edit the user typed into \`draft\` is silently thrown away whenever the parent passes a new \`name\`, even the same text in a new render of a list.

## When to use it

Use it in any React app. It is a warning in every preset. It stays on with the React Compiler, which does not change what an effect sets.

## What it catches

In one component or hook: \`useState(prop)\` (also \`useState(props.name)\` and \`useState(() => name)\`), and an effect that sets that state from the same prop.

### Bad

\`\`\`tsx
function NameEditor({ name }: { name: string }) {
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    setDraft(name);
  }, [name]);
  return <input value={draft} onChange={(e) => setDraft(e.target.value)} />;
}
\`\`\`

### Good

\`\`\`tsx
// Where it is rendered: a new user starts a new editor.
<NameEditor key={user.id} name={user.name} />

function NameEditor({ name }: { name: string }) {
  const [draft, setDraft] = useState(name);
  return <input value={draft} onChange={(e) => setDraft(e.target.value)} />;
}
\`\`\`

### Fix

When the component never changes the value itself, use the prop directly and remove the state. When it does (a form the user edits), remove the effect and give the component a \`key\` that changes when it should start over: React then creates it anew, with the new prop as the initial value. There is no quick fix.

## What it does not catch

- A copy whose initial value is computed (\`useState(name.trim())\`) or comes from another prop.
- A copy re-synced somewhere else than an effect (during rendering, in a parent).
- State copied from a context or from another hook's result.

It says nothing of a copy that is meant to differ from the prop: a debounce or throttle hook (the state is set from the prop inside a \`setTimeout\` or another timer), or a previous value (the effect reads the copy to compare it with the prop, or counts the changes in another state). A draft the user edits (the setter is also called outside the effect, from an input) is reported with only the \`key\` fix, since the state is needed. A copy the component also sets to a fixed value elsewhere (\`setShouldBlock(false)\` when the user proceeds) follows the prop except after that event: it is reported with a value derived from the prop and a state for that event instead, \`const shouldBlock = isDirty && !<that state>\`.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "react/state-copies-prop": "off" } // or "error"
groups: { "react/effects": "off" } // the whole group
rules: { "react/state-copies-prop": ["warning", { ignore: ["draft*"] }] } // states copied on purpose
\`\`\`
`;

/** The calls that run a callback later: a debounce or throttle sets its state in one. */
const TIMERS: ReadonlySet<string> = new Set([
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "requestIdleCallback",
]);

/** `setTimeout` for `setTimeout(…)` and `window.setTimeout(…)`. */
function timerName(call: ts.CallExpression): string | undefined {
  const callee = unwrapped(call.expression);
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : undefined;
  return name !== undefined && TIMERS.has(name) ? name : undefined;
}

/** Every node of a function, the functions declared in it included. */
function forEachIn(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => {
    forEachIn(child, visit);
  });
}

const sameBinding = (a: StateBinding, b: StateBinding): boolean => a.call === b.call;

/**
 * Whether the effect delays the copy: it sets the same state inside a timer's callback, the shape
 * of a debounce or throttle hook, whose state is meant to lag behind the prop.
 */
function delaysCopy(types: TypeQueries, effect: Effect, binding: StateBinding): boolean {
  let found = false;
  forEachIn(effect.callback, (node) => {
    if (found || !ts.isCallExpression(node) || timerName(node) === undefined) return;
    for (const argument of node.arguments) {
      forEachIn(argument, (inner) => {
        const set = setterCall(types, inner);
        if (set !== undefined && sameBinding(set.binding, binding)) found = true;
      });
    }
  });
  return found;
}

/**
 * Whether the effect keeps the copy as the previous value of the prop: it reads the copy (to
 * compare it with the prop), or counts the changes in another state (`setChanges((n) => n + 1)`).
 */
function tracksPrevious(types: TypeQueries, effect: Effect, binding: StateBinding): boolean {
  let found = false;
  forEachIn(effect.callback, (node) => {
    if (found) return;
    if (ts.isIdentifier(node)) {
      const read = bindingOf(types, node);
      if (read?.part === "state" && sameBinding(read.binding, binding)) found = true;
      return;
    }
    const set = setterCall(types, node);
    const value = set?.call.arguments[0];
    if (set === undefined || value === undefined || sameBinding(set.binding, binding)) return;
    const inner = unwrapped(value);
    const sum =
      ts.isArrowFunction(inner) && !ts.isBlock(inner.body) ? unwrapped(inner.body) : inner;
    found =
      ts.isBinaryExpression(sum) &&
      sum.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (ts.isNumericLiteral(unwrapped(sum.left)) || ts.isNumericLiteral(unwrapped(sum.right)));
  });
  return found;
}

/** A value written as itself: `false`, `0`, `""`, `null`, `undefined`. */
function isConstant(node: ts.Expression): boolean {
  const value = unwrapped(node);
  return (
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword ||
    ts.isNumericLiteral(value) ||
    ts.isStringLiteral(value) ||
    ts.isNoSubstitutionTemplateLiteral(value) ||
    (ts.isIdentifier(value) && value.text === "undefined") ||
    (ts.isPrefixUnaryExpression(value) &&
      value.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(value.operand))
  );
}

/**
 * What else sets the state, outside its effects: nothing; only calls with a constant
 * (`setShouldBlock(false)` when the user proceeds), the first of which is kept; or something else
 * (an input's value, the setter handed on as a prop or a hook's result): a draft the user edits.
 */
type Elsewhere =
  | { readonly kind: "none" }
  | { readonly kind: "constant"; readonly call: ts.CallExpression; readonly value: ts.Expression }
  | { readonly kind: "input" };

function setElsewhere(
  types: TypeQueries,
  owner: ts.SignatureDeclaration,
  binding: StateBinding,
  effects: readonly Effect[],
): Elsewhere {
  let found: Elsewhere = { kind: "none" };
  forEachIn(owner, (node) => {
    if (found.kind === "input") return;
    if (!ts.isIdentifier(node) || !isRead(node)) return;
    const used = bindingOf(types, node);
    if (used?.part !== "setter" || !sameBinding(used.binding, binding)) return;
    if (effects.some((effect) => effect.owner === owner && within(node, effect.callback))) return;
    const call = node.parent;
    const value =
      ts.isCallExpression(call) && call.expression === node && call.arguments.length === 1
        ? call.arguments[0]
        : undefined;
    if (!ts.isCallExpression(call) || value === undefined || !isConstant(value)) {
      found = { kind: "input" };
    } else if (found.kind === "none") {
      found = { kind: "constant", call, value };
    }
  });
  return found;
}

/** The name of the function a node is in: its declaration, its variable, its property or its JSX attribute. */
function enclosingName(node: ts.Node): string | undefined {
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (!ts.isFunctionLike(current)) continue;
    if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) {
      return current.name !== undefined && ts.isIdentifier(current.name)
        ? current.name.text
        : undefined;
    }
    let holder: ts.Node = current.parent;
    while (ts.isParenthesizedExpression(holder) || ts.isCallExpression(holder)) {
      // `useCallback(() => …, [])`: the name is the variable's.
      holder = holder.parent;
    }
    if (ts.isJsxExpression(holder)) holder = holder.parent;
    if (
      (ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder)) &&
      ts.isIdentifier(holder.name)
    ) {
      return holder.name.text;
    }
    if (ts.isJsxAttribute(holder) && ts.isIdentifier(holder.name)) return holder.name.text;
    return undefined;
  }
  return undefined;
}

/**
 * The derived value, with `<that state>` for the state the developer adds for the override: no
 * name is made up for it. `isDirty && !<that state>` for `false`, `isDirty || <that state>` for
 * `true`, `<that state> ? "" : query` otherwise.
 */
function derivedValue(prop: string, value: ts.Expression, sourceFile: ts.SourceFile): string {
  const constant = unwrapped(value);
  if (constant.kind === ts.SyntaxKind.FalseKeyword) return `${prop} && !<that state>`;
  if (constant.kind === ts.SyntaxKind.TrueKeyword) return `${prop} || <that state>`;
  return `<that state> ? ${textOf(constant, sourceFile)} : ${prop}`;
}

/** The name a component is declared under (`NameEditor`), or undefined. */
function componentName(owner: ts.SignatureDeclaration): string | undefined {
  if (ts.isFunctionDeclaration(owner)) return owner.name?.text;
  const parent = owner.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return undefined;
}

export const stateCopiesProp = defineRule({
  kind: "file",
  meta: {
    description:
      "A state is not a copy of a prop that an effect keeps in step: one value, one owner.",
    defaultSeverity: "warning",
    tier: "core",
    group: "state",
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
    const reported = new Set<ts.Node>();
    const effects = effectsIn(types, sourceFile);
    for (const effect of effects) {
      forEachOwn(effect.callback, (node) => {
        const set = setterCall(types, node);
        const value = set?.call.arguments[0];
        if (set === undefined || value === undefined || reported.has(set.binding.call)) return;
        if (!startsAsProp(types, set.binding, value, effect.owner)) return;
        if (matchesName(set.binding.state, ctx.options.ignore)) return;
        // A debounced or throttled copy, or the previous value of the prop, is meant to differ.
        if (delaysCopy(types, effect, set.binding) || tracksPrevious(types, effect, set.binding)) {
          return;
        }
        reported.add(set.binding.call);
        const prop = textOf(value, sourceFile);
        const key = propOf(types, value, effect.owner) ?? prop;
        const component = componentName(effect.owner);
        const { state } = set.binding;
        const named = component !== undefined && /^[A-Z]/.test(component);
        // A draft the user edits needs the state: only starting over with a `key` keeps the edits
        // until the parent means a new value.
        const elsewhere = setElsewhere(types, effect.owner, set.binding, effects);
        if (elsewhere.kind === "constant") {
          // The state follows the prop except after one event: a value
          // derived from the prop and a state for that event says so, with no effect. That state
          // is the developer's to name; the message names only code that exists.
          const derived = derivedValue(prop, elsewhere.value, sourceFile);
          const where = enclosingName(elsewhere.call);
          const constant = textOf(elsewhere.value, sourceFile);
          ctx.report({
            message: fitted(
              (cut) =>
                `\`${cut.name(state)}\` follows the prop \`${cut.name(prop)}\` except when set elsewhere, kept in step by an effect`,
            ),
            hint: fitted(
              (cut) =>
                `derive it from \`${cut.name(prop)}\` and whatever sets it to \`${cut.name(constant)}\`${where === undefined ? "" : ` (in \`${cut.name(where)}\`)`}: \`const ${cut.name(state)} = ${cut.name(derived)}\``,
            ),
            node: set.call,
            related: [
              {
                node: set.binding.call,
                message: `\`${state}\` starts as \`${textOf(set.binding.initial ?? value, sourceFile)}\` here`,
              },
              { node: elsewhere.call, message: `\`${state}\` is set here, not from \`${prop}\`` },
            ],
          });
          return;
        }
        const draft = elsewhere.kind === "input";
        ctx.report({
          message: fitted((cut) =>
            draft
              ? `an effect overwrites the draft \`${cut.name(state)}\` with \`${cut.name(prop)}\` whenever it changes, losing edits`
              : `\`${cut.name(state)}\` is a copy of the prop \`${cut.name(prop)}\`, kept in step by an effect: two sources of truth`,
          ),
          hint: fitted((cut) =>
            draft
              ? named
                ? `drop the effect and render \`<${cut.name(component)} key={…}>\` so the draft starts over when \`${cut.name(key)}\` changes`
                : `drop the effect and reset the component with a \`key\` that changes with \`${cut.name(key)}\`, so the draft starts over`
              : !named
                ? `use \`${cut.name(prop)}\` directly, or drop the effect and reset the component with a \`key\` that changes with \`${cut.name(key)}\``
                : `use \`${cut.name(prop)}\` directly, or drop the effect and render \`<${cut.name(component)} key={…}>\` so it starts over when \`${cut.name(key)}\` changes`,
          ),
          node: set.call,
          related: [
            {
              node: set.binding.call,
              message: `\`${state}\` starts as \`${textOf(set.binding.initial ?? value, sourceFile)}\` here`,
            },
          ],
        });
      });
    }
  },
});
