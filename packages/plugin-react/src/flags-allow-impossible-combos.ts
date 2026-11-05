import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option, type FileContext, type OptionsOf } from "@stateward/core";
import { MAX_HINT, fitted, namesText } from "./names-text.js";
import { isComponentOrHook, isFunctionLike, isReactUseState } from "./state-hooks.js";

const EXPLAIN = `# react/flags-allow-impossible-combos

Boolean or nullable useState values that are read or set together become one state, so combinations that make no sense cannot happen.

## Why

\`isLoading\`, \`error\` and \`data\` as three \`useState\` values allow 8 combinations, and most make no sense: loading with an error, no data and not loading. Nothing stops the code from reaching one: a missed \`setError(null)\` leaves the profile page showing the old error beside the new data. One state with a name for each valid combination cannot reach the others.

## When to use it

Use it for components that load data or run multi-step flows. It guesses, and in many apps flags read together are independent (a measured overflow and a user's toggle), so it is off until you add its add-on (below), then a warning in every preset.

## What it catches

In one component or hook, two or more \`useState\` values that are booleans or \`T | undefined\` / \`T | null\`, read together in one condition (\`&&\`, \`||\`, \`!\`, \`?:\`) or set together in one callback. One finding per component or hook, on the first \`useState\` involved.

### Bad

\`\`\`tsx
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState<Error | null>(null);
const [data, setData] = useState<User | undefined>();

if (!isLoading && !error && data) return <Profile user={data} />;
\`\`\`

### Good

Keep the valid combinations as one state: a union of named states, in your own names.

\`\`\`tsx
// was: const [isOpen, setIsOpen] = useState(false); const [isDirty, setIsDirty] = useState(false);
type PanelState = "none" | "open" | "dirty";
const [state, setState] = useState<PanelState>("none");
\`\`\`

### Fix

Replace the flags with one state. There is no quick fix: every read and write changes.

## What it does not catch

- Flags that are never read or set together.
- A condition that says when a control is off: a \`disabled\` prop (\`disabled={!selectedPath || moving}\`) or a \`const\` whose name ends in \`disabled\`. It lists every reason not to act, independent ones included.
- A callback that only resets each flag to its first value, and JSX like \`show && <Details />\`.
- State in \`useReducer\`, a store or a class: only \`useState\` is read.
- Flags in different components, or combined through a custom hook's return value.

It is wrong when the flags really are independent: a form's \`isOpen\` and \`isDirty\` checked in one condition are reported, because the rule cannot know whether any pair makes no sense. Mark such a case as intended with \`// stateward-ignore react/flags-allow-impossible-combos: <why>\` above the line, list flags that are always independent in \`ignore\`, or leave the add-on off.

## Turn it on or off

Turn it on in \`stateward.config.ts\`:

\`\`\`ts
addons: ["react/flag-combos"]
\`\`\`

Then change or turn off the rule itself:

\`\`\`ts
rules: { "react/flags-allow-impossible-combos": "off" } // or "error"
groups: { "states/flags": "off" } // the whole group
rules: { "react/flags-allow-impossible-combos": ["warning", { minVariables: 3 }] } // only three or more flags
\`\`\`
`;

const OPTIONS = {
  minVariables: option.number({
    default: 2,
    min: 2,
    integer: true,
    description:
      "How many variables used together make a finding: 3 reports only larger piles of flags.",
  }),
  setTogether: option.boolean({
    default: true,
    description:
      "Count variables set in one callback as used together; false counts only those read in one condition.",
  }),
  ignore: option.strings({
    default: [],
    description:
      "State variable names (globs like is*Open) that are independent flags: never counted.",
  }),
};

type Settings = OptionsOf<typeof OPTIONS>;

/** The longest line a hint's example may have. */
const MAX_EXAMPLE_LINE = 100;

/** One `const [value, setValue] = useState(…)` of React's. */
type StateVariable = {
  readonly name: string;
  readonly valueId: string;
  readonly setterId: string | undefined;
  /** The `useState` call, where a finding is reported when this is the first involved. */
  readonly call: ts.CallExpression;
  readonly order: number;
  /** The initial value when it is a plain literal (`false`, `null`, `undefined`, `0`, `""`). */
  readonly initial: string | undefined;
};

/** The members of a union written as text, split where `|` is not inside brackets or quotes. */
function unionMembers(text: string): readonly string[] {
  const members: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if ("([{<".includes(char)) {
      depth += 1;
    } else if (")]}>".includes(char) && text.charAt(index - 1) !== "=") {
      depth -= 1;
    } else if (char === "|" && depth === 0) {
      members.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  members.push(text.slice(start).trim());
  return members.filter((member) => member.length > 0);
}

type Shape = { kind: "boolean" } | { kind: "nullable"; data: string } | { kind: "other" };

/** `boolean`, `T | null` and `T | undefined` (and both) are the shapes that pile up into combinations. */
function shapeOf(typeText: string): Shape {
  if (typeText === "boolean") return { kind: "boolean" };
  const members = unionMembers(typeText);
  const rest = members.filter((member) => member !== "null" && member !== "undefined");
  if (members.length === rest.length || rest.length === 0) return { kind: "other" };
  return { kind: "nullable", data: rest.join(" | ") };
}

function stateVariableOf(
  declaration: ts.VariableDeclaration,
  order: number,
  ctx: FileContext,
): StateVariable | undefined {
  const call = declaration.initializer;
  if (call === undefined || !ts.isCallExpression(call) || !isReactUseState(call, ctx)) {
    return undefined;
  }
  if (!ts.isArrayBindingPattern(declaration.name)) return undefined;
  const [first, second] = declaration.name.elements;
  if (first === undefined || ts.isOmittedExpression(first) || !ts.isIdentifier(first.name)) {
    return undefined;
  }
  const shape = shapeOf(ctx.types.typeTextOf(first.name));
  if (shape.kind === "other") return undefined;
  const setter =
    second !== undefined && !ts.isOmittedExpression(second) && ts.isIdentifier(second.name)
      ? ctx.types.symbolAt(second.name)
      : undefined;
  const value = ctx.types.symbolAt(first.name);
  if (value === undefined) return undefined;
  return {
    name: first.name.text,
    valueId: value.id,
    setterId: setter?.id,
    call,
    order,
    initial: literalText(call.arguments[0]),
  };
}

/** `false`, `true`, `null`, `undefined` (also for no argument), a number or a string, as text. */
function literalText(value: ts.Expression | undefined): string | undefined {
  if (value === undefined) return "undefined";
  const node = ts.isParenthesizedExpression(value) ? value.expression : value;
  if (
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined")
  ) {
    return node.kind === ts.SyntaxKind.Identifier ? "undefined" : ts.tokenToString(node.kind);
  }
  if (ts.isNumericLiteral(node)) return `n:${node.text}`;
  return ts.isStringLiteralLike(node) ? `s:${node.text}` : undefined;
}

/** Groups of variables that are used together; a variable is in one group. */
class Groups {
  private readonly parent = new Map<number, number>();

  find(item: number): number {
    const up = this.parent.get(item);
    if (up === undefined || up === item) return item;
    const root = this.find(up);
    this.parent.set(item, root);
    return root;
  }

  join(items: readonly number[]): void {
    const [first, ...rest] = items;
    if (first === undefined) return;
    for (const item of rest) this.parent.set(this.find(item), this.find(first));
  }
}

/** Whether the `&&` / `||` is the whole condition, not a part of a longer one. */
function isWholeCondition(node: ts.BinaryExpression): boolean {
  let parent: ts.Node = node.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken)
  ) {
    parent = parent.parent;
  }
  return !(
    ts.isBinaryExpression(parent) &&
    (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  );
}

/** `disabled`, `isDisabled`, `aria-disabled`, `submitDisabled`: a name for "this control is off". */
const DISABLED = /disabled$/i;

/**
 * Whether the condition says when a control is off: the value of a `disabled` prop
 * (`disabled={!selectedPath || moving}`) or of a `const` named for one (`const disabled = isSaving ||
 * !name`). Such a condition lists every reason not to act, independent ones included (a choice not
 * made yet, a save in progress), so it is no evidence that the states combine (real-world corpus: outline).
 */
function disablesControl(node: ts.BinaryExpression): boolean {
  let current: ts.Node = node;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    (ts.isPrefixUnaryExpression(current.parent) &&
      current.parent.operator === ts.SyntaxKind.ExclamationToken)
  ) {
    current = current.parent;
  }
  const parent = current.parent;
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
    return DISABLED.test(parent.parent.name.getText());
  }
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? DISABLED.test(parent.name.text)
    : false;
}

function isLogicalOperator(node: ts.BinaryExpression): boolean {
  return (
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    node.operatorToken.kind === ts.SyntaxKind.BarBarToken
  );
}

function innermostFunction(node: ts.Node): ts.Node | undefined {
  return ts.findAncestor(node.parent, isFunctionLike);
}

/** What the component does with its state variables: which are read together, which set together. */
function groupsOf(
  component: ts.FunctionLikeDeclaration,
  variables: readonly StateVariable[],
  ctx: FileContext<Settings>,
): { groups: Groups; involved: ReadonlySet<number> } {
  const byValue = new Map(variables.map((variable) => [variable.valueId, variable.order]));
  const bySetter = new Map(
    variables.flatMap((variable) =>
      variable.setterId === undefined ? [] : [[variable.setterId, variable.order] as const],
    ),
  );
  const groups = new Groups();
  const involved = new Set<number>();
  const together = (orders: ReadonlySet<number>): void => {
    if (orders.size < 2) return;
    groups.join([...orders]);
    for (const order of orders) involved.add(order);
  };

  const readIn = (condition: ts.Node): ReadonlySet<number> => {
    const seen = new Set<number>();
    const look = (node: ts.Node): void => {
      // What `show && <Details />` renders is not part of its condition, nor is a callback's body.
      if (
        ts.isJsxElement(node) ||
        ts.isJsxSelfClosingElement(node) ||
        ts.isJsxFragment(node) ||
        isFunctionLike(node)
      ) {
        return;
      }
      if (ts.isIdentifier(node)) {
        const symbol = ctx.types.symbolAt(node);
        const order = symbol === undefined ? undefined : byValue.get(symbol.id);
        if (order !== undefined) seen.add(order);
      }
      ts.forEachChild(node, look);
    };
    look(condition);
    return seen;
  };

  const initials = new Map(variables.map((variable) => [variable.order, variable.initial]));
  /** Per function, the variables it sets, and whether every one of those calls is a reset. */
  const setters = new Map<ts.Node, { orders: Set<number>; resetsOnly: boolean }>();
  const visit = (node: ts.Node): void => {
    if (node !== component && isComponentOrHook(node)) return;
    if (ts.isBinaryExpression(node) && isLogicalOperator(node) && isWholeCondition(node)) {
      if (!disablesControl(node)) together(readIn(node));
    } else if (ts.isConditionalExpression(node)) {
      together(readIn(node.condition));
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const symbol = ctx.types.symbolAt(node.expression);
      const order = symbol === undefined ? undefined : bySetter.get(symbol.id);
      const owner = innermostFunction(node);
      if (order !== undefined && owner !== undefined) {
        const entry = setters.get(owner) ?? { orders: new Set<number>(), resetsOnly: true };
        const initial = initials.get(order);
        const reset = initial !== undefined && literalText(node.arguments[0]) === initial;
        setters.set(owner, {
          orders: entry.orders.add(order),
          resetsOnly: entry.resetsOnly && reset,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  if (component.body !== undefined) visit(component.body);
  // A callback that only puts each state back to its initial value (a form cleared after submit,
  // panels closed when the item changes) is a reset: it says nothing about which states combine.
  if (ctx.options.setTogether) {
    for (const { orders, resetsOnly } of setters.values()) if (!resetsOnly) together(orders);
  }
  return { groups, involved };
}

/** The state variables declared in the component itself, not in a component or hook inside it. */
function variablesOf(component: ts.FunctionLikeDeclaration, ctx: FileContext): StateVariable[] {
  const variables: StateVariable[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== component && isComponentOrHook(node)) return;
    if (ts.isVariableDeclaration(node)) {
      const variable = stateVariableOf(node, variables.length, ctx);
      if (variable !== undefined) variables.push(variable);
    }
    ts.forEachChild(node, visit);
  };
  if (component.body !== undefined) visit(component.body);
  return variables;
}

function headline(names: readonly string[]): string {
  return fitted(
    (cut) => `${namesText(names, cut)} describe one state in ${String(names.length)} variables`,
  );
}

/** `isOpen` → `open`, `hasDraft` → `draft`: the name a state of the union takes. */
function stateName(variable: StateVariable): string {
  const bare = variable.name.replace(/^(?:is|has)(?=[A-Z])/, "");
  return bare.charAt(0).toLowerCase() + bare.slice(1);
}

/** `Panel` → `PanelState`, `useUpload` → `UploadState`; `State` when it has no name. */
function typeName(component: ts.FunctionLikeDeclaration): string {
  const own =
    component.name !== undefined && ts.isIdentifier(component.name)
      ? component.name.text
      : ts.findAncestor(component, ts.isVariableDeclaration)?.name.getText();
  const base = (own ?? "").replace(/^use(?=[A-Z])/, "");
  return /^[A-Z]\w*$/.test(base) ? `${base}State` : "State";
}

/** One union of the developer's own names, with `"none"` for the state where no flag is set. */
function unionExample(group: readonly StateVariable[], type: string): string {
  const names = ["none", ...new Set(group.map(stateName))];
  const declared = (shown: readonly string[], more: boolean): string =>
    `    type ${type} = ${shown.map((name) => JSON.stringify(name)).join(" | ")}${more ? " | …" : ""};`;
  let count = names.length;
  while (
    count > 2 &&
    declared(names.slice(0, count), count < names.length).length > MAX_EXAMPLE_LINE
  ) {
    count -= 1;
  }
  return [
    declared(names.slice(0, count), count < names.length),
    `    const [state, setState] = useState<${type}>("none");`,
  ].join("\n");
}

function hint(group: readonly StateVariable[], component: ts.FunctionLikeDeclaration): string {
  const first = `${String(group.length)} variables allow ${String(2 ** group.length)} combinations; keep the valid ones as one state:`;
  const union = unionExample(group, typeName(component));
  return first.length <= MAX_HINT ? `${first}\n${union}` : first;
}

function checkComponent(component: ts.FunctionLikeDeclaration, ctx: FileContext<Settings>): void {
  const variables = variablesOf(component, ctx).filter(
    (variable) => !matchesName(variable.name, ctx.options.ignore),
  );
  if (variables.length < ctx.options.minVariables) return;
  const { groups, involved } = groupsOf(component, variables, ctx);
  const members = new Map<number, StateVariable[]>();
  for (const variable of variables) {
    if (!involved.has(variable.order)) continue;
    const root = groups.find(variable.order);
    members.set(root, [...(members.get(root) ?? []), variable]);
  }
  // The largest group, the first declared on a tie: one finding per component.
  let chosen: StateVariable[] | undefined;
  for (const group of members.values()) {
    if (chosen === undefined || group.length > chosen.length) chosen = group;
  }
  const first = chosen?.[0];
  if (chosen === undefined || first === undefined) return;
  if (chosen.length < ctx.options.minVariables) return;
  ctx.report({
    node: first.call,
    message: headline(chosen.map((variable) => variable.name)),
    hint: hint(chosen, component),
  });
}

export const flagsAllowImpossibleCombos = defineRule({
  kind: "file",
  meta: {
    description:
      "Boolean or nullable useState values that are read or set together become one state, so combinations that make no sense cannot happen.",
    defaultSeverity: "warning",
    tier: "addon",
    addon: "flag-combos",
    group: "state",
    heuristic: true,
    options: OPTIONS,
    explain: EXPLAIN,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (isComponentOrHook(node)) checkComponent(node, ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
