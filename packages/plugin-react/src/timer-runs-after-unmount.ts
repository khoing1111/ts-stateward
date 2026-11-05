import ts from "@stateward/core/typescript";
import { defineRule } from "@stateward/core";
import type { Fix, FileContext, TextEdit, TypeQueries } from "@stateward/core";
import {
  cleanupsOf,
  declarationNode,
  effectsIn,
  enclosingFunction,
  propOf,
  setterCall,
  textOf,
  within,
  type Effect,
} from "./effects.js";
import { globalCallName, isReactCall, unwrapped } from "./react.js";
import { fitted } from "./text.js";

const EXPLAIN = `# react/timer-runs-after-unmount

A timer kept in a \`useRef\` is cleared when the component unmounts.

## Why

\`setTimeout\`, \`setInterval\` and \`requestAnimationFrame\` keep running after the component is gone. When the callback only sets the component's own state, that is harmless: React ignores a state update after unmount (it removed its "update on an unmounted component" warning in React 18 for this reason), so this rule stays silent. It speaks when the callback does something that still has an effect: a menu that calls \`navigate(…)\` after a delay moves the user somewhere they did not ask to go; a prop callback, a store dispatch, a request or an analytics event fires for a screen that is closed. The usual place to start such a timer is an event handler, where [\`react/effect-missing-cleanup\`](effect-missing-cleanup.md) cannot see it.

## When to use it

Use it in any React app. It is a warning in every preset.

## What it catches

A \`useRef\` that the component assigns \`setTimeout(…)\`, \`setInterval(…)\` or \`requestAnimationFrame(…)\` (also as \`window.setTimeout\`), in an event handler or anywhere else in the component, when no effect cleanup in the component clears that ref, and the timer's callback (or a function declared in the component that it calls) does one of these:

- navigates: \`navigate(…)\`, \`router.push(…)\`, \`history.replace(…)\`;
- calls a prop or a value from \`useContext\`;
- dispatches to a store, starts a request (\`fetch\`, \`axios\`), or sends an analytics event (\`track\`, \`analytics.…\`);
- writes to storage or \`document\`, or to another ref.

It is cleared when the cleanup of any effect calls \`clearTimeout(ref.current)\`, \`clearInterval(ref.current)\` or \`cancelAnimationFrame(ref.current)\` for that kind of timer (an effect with \`[]\` runs its cleanup only on unmount; any other runs it then too): directly, through a copy of the id (\`const id = ref.current\`), or through a helper declared in the component.

The message names the action: "\`closeTimer\` can still run \`navigate(…)\` after \`RailMenu\` unmounts".

### Bad

\`\`\`tsx
const closeTimer = useRef<number>();
const choose = () => {
  closeTimer.current = window.setTimeout(() => navigate(to), 150);
};
\`\`\`

### Good

\`\`\`tsx
const closeTimer = useRef<number>();
useEffect(() => () => window.clearTimeout(closeTimer.current), []);
\`\`\`

### Fix

Add the effect above after the ref's declaration. The quick fix writes it (and imports \`useEffect\` when the file does not) and is tried on a copy of your code before it is offered.

## What it does not catch

- A timer whose callback only sets the component's own state.
- A timer whose id is kept in a variable, an object or a list, not in a \`useRef\`.
- A timer started in a function outside the component.
- A cleanup that hands the ref to a function stateward cannot see into (\`return () => stopAll(closeTimer)\`), or an effect that returns a function declared outside it: these are listed as places not checked.
- A timer an effect starts and \`react/effect-missing-cleanup\` already reports: one cause gives one message, from that rule.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "react/timer-runs-after-unmount": "off" } // or "error"
groups: { "react/effects": "off" } // the whole group
\`\`\`
`;

type Kind = "timeout" | "interval" | "frame";

const KIND_OF: ReadonlyMap<string, Kind> = new Map([
  ["setTimeout", "timeout"],
  ["setInterval", "interval"],
  ["requestAnimationFrame", "frame"],
]);

const KINDS: readonly Kind[] = ["timeout", "interval", "frame"];

const CLEAR_OF: Readonly<Record<Kind, string>> = {
  timeout: "clearTimeout",
  interval: "clearInterval",
  frame: "cancelAnimationFrame",
};

/** `ref.current = setTimeout(…)`: where a timer is stored in a ref. */
type Assignment = { call: ts.CallExpression; kind: Kind; inEffect: boolean };

function componentName(owner: ts.SignatureDeclaration): string | undefined {
  if ((ts.isFunctionDeclaration(owner) || ts.isFunctionExpression(owner)) && owner.name) {
    return owner.name.text;
  }
  let current: ts.Node = owner.parent;
  // `const HoverChip = memo(() => …)`
  while (ts.isCallExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.parent;
  }
  return ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)
    ? current.name.text
    : undefined;
}

/** The function a name stands for when it is written in the component: `const close = () => …`. */
function functionOf(
  types: TypeQueries,
  expression: ts.Expression,
  owner: ts.SignatureDeclaration,
): ts.SignatureDeclaration | undefined {
  const value = unwrapped(expression);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
  if (!ts.isIdentifier(value)) return undefined;
  const declaration = declarationNode(types, value);
  if (declaration === undefined || !within(declaration, owner)) return undefined;
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
    const initial = unwrapped(declaration.initializer);
    if (ts.isArrowFunction(initial) || ts.isFunctionExpression(initial)) return initial;
  }
  return undefined;
}

const ROUTER_METHODS: ReadonlySet<string> = new Set(["push", "replace", "back", "forward", "go"]);
const STORAGE_METHODS: ReadonlySet<string> = new Set(["setItem", "removeItem", "clear"]);
const STORE_NAMES: ReadonlySet<string> = new Set(["dispatch"]);
const REQUEST_NAMES: ReadonlySet<string> = new Set(["fetch", "axios", "sendBeacon"]);
const ANALYTICS_NAMES: ReadonlySet<string> = new Set([
  "track",
  "trackEvent",
  "logEvent",
  "analytics",
]);

/** The name at the root of `a.b.c`: `a`. */
function rootOf(expression: ts.Expression): ts.Expression {
  let current = unwrapped(expression);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = unwrapped(current.expression);
  }
  return current;
}

/** Whether a name is a value read from `useContext(…)`, directly or destructured. */
function fromContext(types: TypeQueries, identifier: ts.Expression): boolean {
  if (!ts.isIdentifier(identifier)) return false;
  let declaration = declarationNode(types, identifier);
  while (declaration !== undefined && ts.isBindingElement(declaration)) {
    declaration = declaration.parent.parent;
  }
  return (
    declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    isReactCall(types, declaration.initializer, "useContext")
  );
}

/**
 * The call that still has an effect once the component is gone, as written: `navigate(…)`, a prop
 * or context callback, a store dispatch, a request, storage, analytics. Undefined for anything else.
 */
function lastingCall(
  types: TypeQueries,
  callee: ts.Expression,
  owner: ts.SignatureDeclaration,
  sourceFile: ts.SourceFile,
): string | undefined {
  const target = unwrapped(callee);
  const shown = `${textOf(target, sourceFile)}(…)`;
  if (propOf(types, target, owner) !== undefined) return shown;
  const root = rootOf(target);
  if (fromContext(types, root)) return shown;
  if (ts.isIdentifier(target)) {
    const name = target.text;
    if (name === "navigate" || STORE_NAMES.has(name) || REQUEST_NAMES.has(name)) return shown;
    if (ANALYTICS_NAMES.has(name)) return shown;
    return undefined;
  }
  if (!ts.isPropertyAccessExpression(target) || !ts.isIdentifier(root)) return undefined;
  const method = target.name.text;
  const base = root.text;
  if (
    (base === "router" || base === "history" || base === "navigation") &&
    ROUTER_METHODS.has(method)
  ) {
    return shown;
  }
  if ((base === "localStorage" || base === "sessionStorage") && STORAGE_METHODS.has(method))
    return shown;
  if (STORE_NAMES.has(method)) return shown;
  if (ANALYTICS_NAMES.has(base) || ANALYTICS_NAMES.has(method) || REQUEST_NAMES.has(base))
    return shown;
  if (base === "document" || (base === "window" && method === "open")) return shown;
  return undefined;
}

/**
 * What a timer's callback does that outlives the component, one helper declared in the component
 * deep: the call as written, or a write to another ref, `document` or storage. Setting this
 * component's own state does not count: React ignores it after unmount.
 */
function lastingEffectOf(
  types: TypeQueries,
  fn: ts.SignatureDeclaration,
  owner: ts.SignatureDeclaration,
  timerRef: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  depth: number,
): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isCallExpression(node) && setterCall(types, node) === undefined) {
      found = lastingCall(types, node.expression, owner, sourceFile);
      if (found !== undefined) return;
      const helper = depth < 1 ? functionOf(types, node.expression, owner) : undefined;
      if (helper !== undefined && helper !== fn) {
        found = lastingEffectOf(types, helper, owner, timerRef, sourceFile, depth + 1);
        if (found !== undefined) return;
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
    ) {
      const root = rootOf(node.left);
      const declaration = ts.isIdentifier(root) ? declarationNode(types, root) : undefined;
      const isRefWrite =
        declaration !== undefined &&
        declaration !== timerRef &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer !== undefined &&
        isReactCall(types, declaration.initializer, "useRef");
      const isGlobalWrite =
        ts.isIdentifier(root) && ["document", "localStorage", "sessionStorage"].includes(root.text);
      if (isRefWrite || isGlobalWrite) {
        found = `${textOf(node.left, sourceFile)} = …`;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  if ("body" in fn && fn.body !== undefined) visit(fn.body);
  return found;
}

/** Whether `expression` reads `ref.current`, or a variable that was set to it. */
function readsCurrent(
  types: TypeQueries,
  expression: ts.Expression,
  ref: ts.VariableDeclaration,
): boolean {
  const value = unwrapped(expression);
  if (ts.isPropertyAccessExpression(value) || ts.isIdentifier(value)) {
    if (ts.isPropertyAccessExpression(value)) {
      return (
        value.name.text === "current" &&
        ts.isIdentifier(value.expression) &&
        declarationNode(types, value.expression) === ref
      );
    }
    const declaration = declarationNode(types, value);
    return (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      ts.isPropertyAccessExpression(unwrapped(declaration.initializer)) &&
      readsCurrent(types, declaration.initializer, ref)
    );
  }
  return false;
}

/** Whether `expression` is the ref itself: `closeTimer`. */
function isRef(
  types: TypeQueries,
  expression: ts.Expression,
  ref: ts.VariableDeclaration,
): boolean {
  const value = unwrapped(expression);
  return ts.isIdentifier(value) && declarationNode(types, value) === ref;
}

/** What the unmount cleanups of a component do with a ref. */
type Unmount = { cleared: Set<Kind>; handedOver: boolean; unreadable: boolean };

/** The calls a cleanup makes, following helpers declared in the component two levels deep. */
function callsOf(
  types: TypeQueries,
  fn: ts.SignatureDeclaration,
  owner: ts.SignatureDeclaration,
  seen: Set<ts.Node>,
  depth: number,
): ts.CallExpression[] {
  if (seen.has(fn)) return [];
  seen.add(fn);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      calls.push(node);
      const helper = depth < 2 ? functionOf(types, node.expression, owner) : undefined;
      if (helper !== undefined) calls.push(...callsOf(types, helper, owner, seen, depth + 1));
    }
    ts.forEachChild(node, visit);
  };
  if ("body" in fn && fn.body !== undefined) visit(fn.body);
  return calls;
}

function unmountOf(
  types: TypeQueries,
  ref: ts.VariableDeclaration,
  effects: readonly Effect[],
  owner: ts.SignatureDeclaration,
): Unmount {
  const result: Unmount = { cleared: new Set(), handedOver: false, unreadable: false };
  for (const effect of effects) {
    const cleanups = cleanupsOf(types, effect);
    if (cleanups.unreadable) result.unreadable = true;
    const seen = new Set<ts.Node>();
    const calls = [
      ...cleanups.functions.flatMap((fn) => callsOf(types, fn, owner, seen, 0)),
      ...cleanups.returnedCalls,
    ];
    for (const call of calls) {
      const name = globalCallName(types, call);
      const first = call.arguments[0];
      const clears = KINDS.find((kind) => CLEAR_OF[kind] === name);
      if (clears !== undefined && first !== undefined && readsCurrent(types, first, ref)) {
        result.cleared.add(clears);
        continue;
      }
      const callee = unwrapped(call.expression);
      const isOwnHelper = functionOf(types, callee, owner) !== undefined;
      if (
        !isOwnHelper &&
        call.arguments.some(
          (argument) => isRef(types, argument, ref) || readsCurrent(types, argument, ref),
        )
      ) {
        result.handedOver = true;
      }
    }
  }
  return result;
}

/** Every `ref.current = setTimeout(…)` in the component, handlers and effects alike. */
function assignmentsOf(
  types: TypeQueries,
  ref: ts.VariableDeclaration,
  owner: ts.SignatureDeclaration,
  effects: readonly Effect[],
): Assignment[] {
  const found: Assignment[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === "current" &&
      isRef(types, node.left.expression, ref)
    ) {
      const right = unwrapped(node.right);
      const name = ts.isCallExpression(right) ? globalCallName(types, right) : undefined;
      const kind = name === undefined ? undefined : KIND_OF.get(name);
      if (ts.isCallExpression(right) && kind !== undefined) {
        const own = enclosingFunction(node);
        found.push({
          call: right,
          kind,
          inEffect: effects.some((effect) => effect.callback === own),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  if ("body" in owner && owner.body !== undefined) visit(owner.body);
  return found;
}

/** The imports and the effect that clear the ref on unmount, as one fix. */
function clearFix(
  ctx: FileContext,
  ref: ts.VariableDeclaration,
  name: string,
  missing: readonly Kind[],
): { fix: Fix; code: string } | undefined {
  const { sourceFile, types } = ctx;
  const statement = ref.parent.parent;
  if (!ts.isVariableStatement(statement) || !ts.isIdentifier(ref.name)) return undefined;
  const refCall = ref.initializer === undefined ? undefined : unwrapped(ref.initializer);
  if (refCall === undefined || !ts.isCallExpression(refCall)) return undefined;
  if (!isReactCall(types, refCall, "useRef")) return undefined;
  const callee = unwrapped(refCall.expression);
  const edits: TextEdit[] = [];
  let hook = "useEffect";
  if (ts.isPropertyAccessExpression(callee)) {
    hook = `${textOf(callee.expression, sourceFile)}.useEffect`;
  } else {
    const imports = sourceFile.statements.filter(
      (each): each is ts.ImportDeclaration =>
        ts.isImportDeclaration(each) &&
        ts.isStringLiteral(each.moduleSpecifier) &&
        each.moduleSpecifier.text === "react" &&
        each.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword,
    );
    const named = imports.flatMap((each) => {
      const bindings = each.importClause?.namedBindings;
      return bindings !== undefined && ts.isNamedImports(bindings) ? [bindings] : [];
    });
    const existing = named
      .flatMap((bindings) => [...bindings.elements])
      .find((element) => (element.propertyName ?? element.name).text === "useEffect");
    if (existing !== undefined) {
      hook = existing.name.text;
    } else {
      const last = named
        .flatMap((bindings) => (bindings.elements.length > 0 ? [bindings] : []))
        .at(0);
      const lastElement = last?.elements.at(-1);
      if (lastElement !== undefined) {
        edits.push({
          location: { file: ctx.file, start: lastElement.end, end: lastElement.end },
          newText: ", useEffect",
        });
      } else {
        const lastImport = sourceFile.statements.filter(ts.isImportDeclaration).at(-1);
        if (lastImport === undefined) return undefined;
        edits.push({
          location: { file: ctx.file, start: lastImport.end, end: lastImport.end },
          newText: `\nimport { useEffect } from "react";`,
        });
      }
    }
  }
  const indent = " ".repeat(
    sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).character,
  );
  const clears = missing.map((kind) => `${CLEAR_OF[kind]}(${name}.current);`);
  const [only] = clears;
  const single = only !== undefined && clears.length === 1;
  const code = single
    ? `${hook}(() => () => ${only.slice(0, -1)}, [])`
    : `${hook}(() => () => {\n${indent}  ${clears.join(`\n${indent}  `)}\n${indent}}, [])`;
  edits.push({
    location: { file: ctx.file, start: statement.end, end: statement.end },
    newText: `\n${indent}${code};`,
  });
  return {
    fix: { title: `Clear ${name} when the component unmounts`, edits },
    code: single ? code : "",
  };
}

function checkRef(ctx: FileContext, ref: ts.VariableDeclaration, effects: readonly Effect[]): void {
  const { types } = ctx;
  if (!ts.isIdentifier(ref.name)) return;
  const owner = enclosingFunction(ref);
  if (owner === undefined) return;
  const mine = effects.filter((effect) => effect.owner === owner);
  const assigned = assignmentsOf(types, ref, owner, mine);
  if (assigned.length === 0) return;
  const unmount = unmountOf(types, ref, mine, owner);
  const kinds = [...new Set(assigned.map((each) => each.kind))];
  const missing = kinds.filter((kind) => !unmount.cleared.has(kind));
  if (missing.length === 0) return;
  // Only a callback that does something lasting is a bug: React ignores setState after unmount.
  const lasting = assigned.flatMap((each) => {
    if (!missing.includes(each.kind)) return [];
    const callback = each.call.arguments[0];
    if (callback === undefined) return [];
    const target = functionOf(types, callback, owner);
    const action =
      target === undefined
        ? lastingCall(types, callback, owner, ctx.sourceFile)
        : lastingEffectOf(types, target, owner, ref, ctx.sourceFile, 0);
    return action === undefined ? [] : [{ ...each, action }];
  });
  // The effect rule reports the timers an effect starts; this finding sits on that same call, so
  // that rule's message wins (`yieldsTo`).
  const first = lasting.find((each) => each.inEffect && each.kind !== "frame") ?? lasting.at(0);
  if (first === undefined) return;
  const name = ref.name.text;
  if (unmount.handedOver || unmount.unreadable) {
    ctx.unknown({
      message: fitted(
        (cut) =>
          `stateward cannot tell whether \`${cut.name(name)}\` is cleared when the component unmounts`,
      ),
      hint: "clear it in an effect cleanup written in the component (`clearTimeout(ref.current)`) to make it checkable",
      node: first.call,
    });
    return;
  }
  const component = componentName(owner);
  const fix = clearFix(ctx, ref, name, missing);
  const writes = first.action.endsWith(" = …");
  const shownAction = writes ? first.action.slice(0, -4) : first.action;
  const who =
    component === undefined
      ? "the component"
      : /^use[A-Z]/.test(component)
        ? `the component that calls \`${component}\``
        : `\`${component}\``;
  ctx.report({
    message: fitted(
      (cut) =>
        `\`${cut.name(name)}\` can still ${writes ? "write" : "run"} \`${cut.name(shownAction)}\` after ${
          component === undefined || /^use[A-Z]/.test(component)
            ? who
            : `\`${cut.name(component)}\``
        } unmounts`,
    ),
    hint: fitted((cut) =>
      fix === undefined
        ? `clear it in an effect cleanup that runs on unmount: \`useEffect(() => () => ${CLEAR_OF[first.kind]}(${cut.name(name)}.current), [])\``
        : fix.code === ""
          ? "add an effect that clears each timer on unmount, after the ref's declaration (quick fix)"
          : `add an effect that clears it on unmount: \`${fix.code}\` (quick fix)`,
    ),
    node: first.call,
    about: first.call,
    ...(fix === undefined ? {} : { fixes: [fix.fix] }),
  });
}

export const timerRunsAfterUnmount = defineRule({
  kind: "file",
  meta: {
    description:
      "A timer a component keeps in a ref is cleared when the component unmounts, so it cannot run after the component is gone.",
    defaultSeverity: "warning",
    tier: "core",
    group: "effects",
    yieldsTo: ["effect-missing-cleanup"],
    explain: EXPLAIN,
  },
  check(ctx) {
    const effects = effectsIn(ctx.types, ctx.sourceFile);
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        isReactCall(ctx.types, node.initializer, "useRef")
      ) {
        checkRef(ctx, node, effects);
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
