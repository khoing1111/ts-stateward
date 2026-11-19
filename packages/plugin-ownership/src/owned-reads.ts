/**
 * Marks every reference to a value stated owned (the reference ledger, `FileContext.ledger`): the
 * rule's proof reads a reference only when every way the value goes from there ends where the
 * rule's classifiers read it (a write, a method call, an argument, a store, a JSX attribute: each
 * traced back to the value by the resolver), or in a read that cannot change it. Anything else is
 * "not checked" at the reference, with what it is: a field or a default that keeps the value, a
 * getter or a function that returns it, a generator that yields it, a call through `call` or
 * `Reflect.apply`, a `Proxy`. A value handed to a function of the project is settled by the
 * project side, which knows whether that function changes its parameter.
 */
import ts from "@stateward/core/typescript";
import type { FileContext, LedgerRef } from "@stateward/core";
import {
  CHANGES_FIRST,
  ELEMENT_METHODS,
  OWNED,
  createResolver,
  elementIndex,
  functionOf,
  receiverIndex,
  isDefaultLibrary,
  libraryObject,
  mayReach,
  storesArguments,
} from "./owned.js";
import { isWrapper, isWriteTarget, unwrapped } from "./syntax.js";
import { shorten } from "./text.js";

/** What to write instead, after each place the rule cannot follow. */
const OWNED_FIX = "pass a copy, or make the change in its owner";

/** A reference handed to a function of the project: the project side settles it. */
export type Handed = { ref: string; trait: string; callee: string; index: number; name: string };

/** How far a value is followed from one reference: past this, the place is not checked. */
const MAX_STEPS = 64;

/** The library constructors that make a collection of what they are given. */
const COLLECTIONS: ReadonlySet<string> = new Set([
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Array",
  "WeakRef",
]);

/** The library functions that call another with the value: what that one does is not known. */
const INDIRECT: ReadonlySet<string> = new Set(["call", "apply", "bind"]);
const REFLECT_INDIRECT: ReadonlySet<string> = new Set(["apply", "construct"]);

type Verdict =
  | { kind: "decided" }
  | { kind: "irrelevant" }
  | { kind: "handed"; callee: string; index: number; shown: string }
  | { kind: "unchecked"; reason: string };

const RANK: Readonly<Record<Verdict["kind"], number>> = {
  irrelevant: 0,
  decided: 1,
  handed: 2,
  unchecked: 3,
};

function text(node: ts.Node, max = 40): string {
  return shorten(node.getText(node.getSourceFile()).replace(/\s+/g, " "), max);
}

/** The outermost expression that is `node`'s value: through `(…)`, `!`, `as` and `satisfies`. */
function outermost(node: ts.Node): ts.Node {
  let at = node;
  while (isWrapper(at.parent)) at = at.parent;
  return at;
}

/**
 * Marks the file's references to values stated owned. `handed` collects the references handed to
 * a function of the project, for the project side (`ProjectContext.read`).
 */
export function markOwnedReferences(ctx: FileContext, handed: Handed[]): void {
  const refs = ctx.ledger.filter((ref) => ref.trait === OWNED);
  if (refs.length === 0) return;
  const { types, sourceFile } = ctx;
  const resolver = createResolver(types);
  const nodes = new Map<number, ts.Node>();
  const index = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node)) {
      nodes.set(node.getStart(sourceFile), node);
    }
    ts.forEachChild(node, index);
  };
  index(sourceFile);
  /** The other names of a local variable: every identifier in the file with its symbol. */
  const namesOf = new Map<ts.Node, ts.Identifier[]>();
  const usesOfName = (name: ts.Identifier): readonly ts.Identifier[] => {
    const known = namesOf.get(name);
    if (known !== undefined) return known;
    const symbol = types.symbolAt(name);
    const found: ts.Identifier[] = [];
    if (symbol !== undefined) {
      const visit = (node: ts.Node): void => {
        if (
          ts.isIdentifier(node) &&
          node !== name &&
          node.text === name.text &&
          types.symbolAt(node)?.id === symbol.id
        ) {
          found.push(node);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
    namesOf.set(name, found);
    return found;
  };

  const reaches = (expression: ts.Node): boolean =>
    ts.isExpression(expression) &&
    mayReach(expression) &&
    resolver.sourceOf(expression) !== undefined;

  for (const ref of refs) {
    const node = nodes.get(ref.location.start);
    const outcome = node === undefined ? undefined : verdictOf(ref, node);
    if (outcome === undefined) continue;
    if (outcome.kind === "handed") {
      handed.push({
        ref: ref.id,
        trait: ref.trait,
        callee: outcome.callee,
        index: outcome.index,
        name: ref.name,
      });
      ctx.read(ref, { kind: "handed-on", to: `\`${outcome.shown}\`` });
    } else {
      ctx.read(ref, outcome);
    }
  }

  function verdictOf(ref: LedgerRef, node: ts.Node): Verdict {
    if (ref.form === "import" || ref.form === "export" || ref.form === "type") {
      return { kind: "irrelevant" };
    }
    const parent = node.parent;
    // A destructured name of the stated value's own name reads like a read of it.
    let start: ts.Node = node;
    if (
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isElementAccessExpression(parent) && parent.argumentExpression === node)
    ) {
      start = parent;
    }
    if (ts.isShorthandPropertyAssignment(parent)) start = parent;
    const steps = { left: MAX_STEPS };
    const seen = new Set<ts.Node>();
    return follow(start, steps, seen, ref.name);
  }

  function worst(verdicts: readonly Verdict[]): Verdict {
    let found: Verdict = { kind: "irrelevant" };
    for (const one of verdicts) if (RANK[one.kind] > RANK[found.kind]) found = one;
    return found;
  }

  function unchecked(at: ts.Node, what: string): Verdict {
    return { kind: "unchecked", reason: `\`${text(at)}\` ${what}: ${OWNED_FIX}` };
  }

  /** A sink the rule reads: decided when the resolver traces `expression` back to the value. */
  function sink(expression: ts.Node, at: ts.Node, name: string): Verdict {
    return reaches(expression)
      ? { kind: "decided" }
      : unchecked(at, `changes a value that is not traced back to \`${name}\``);
  }

  /** Follows each other name of a variable the value is given to. */
  function followName(
    name: ts.BindingName,
    steps: { left: number },
    seen: Set<ts.Node>,
    owner: string,
  ): Verdict {
    if (ts.isIdentifier(name)) {
      return worst(usesOfName(name).map((use) => follow(use, steps, seen, owner)));
    }
    const verdicts: Verdict[] = [];
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) verdicts.push(followName(element.name, steps, seen, owner));
    }
    return worst(verdicts);
  }

  /** Whether a variable can be named by another file: then its uses there are not followed. */
  function exported(declaration: ts.VariableDeclaration): boolean {
    const statement = declaration.parent.parent;
    if (!ts.isVariableStatement(statement) || !ts.isSourceFile(statement.parent)) return false;
    if (
      (statement.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      return true;
    }
    if (!ts.isIdentifier(declaration.name)) return true;
    const own = declaration.name;
    return usesOfName(own).some(
      (use) => ts.isExportSpecifier(use.parent) || ts.isExportAssignment(use.parent),
    );
  }

  /**
   * Where the value at `node` goes, and whether the rule reads it there. `node` may hold the value,
   * a part of it, or a new array or object that holds it.
   */
  function follow(
    node: ts.Node,
    steps: { left: number },
    seen: Set<ts.Node>,
    name: string,
  ): Verdict {
    if (seen.has(node)) return { kind: "irrelevant" };
    seen.add(node);
    steps.left -= 1;
    if (steps.left < 0) {
      return unchecked(node, "passes the value through more names than stateward follows");
    }
    const at = outermost(node);
    const parent = at.parent;
    if (ts.isExpression(at) && isWriteTarget(at)) return sink(at, at, name);
    // A member: a method called on it, a change of it, or a part of the value read on.
    if (ts.isPropertyAccessExpression(parent) && parent.expression === at) {
      const call = outermost(parent).parent;
      if (ts.isCallExpression(call) && outermost(parent) === call.expression) {
        return method(at, parent, call, steps, seen, name);
      }
      if (isWriteTarget(parent)) return sink(at, parent, name);
      return types.isPrimitive(parent) ? { kind: "irrelevant" } : follow(parent, steps, seen, name);
    }
    if (ts.isElementAccessExpression(parent)) {
      if (parent.argumentExpression === at) return { kind: "irrelevant" };
      const call = outermost(parent).parent;
      if (ts.isCallExpression(call) && outermost(parent) === call.expression) {
        return unchecked(call, `calls a member of \`${name}\` by a computed key`);
      }
      if (isWriteTarget(parent)) return sink(at, parent, name);
      return types.isPrimitive(parent) ? { kind: "irrelevant" } : follow(parent, steps, seen, name);
    }
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      if (parent.expression === at) return unchecked(parent, `calls \`${name}\` itself`);
      return argument(at, parent, steps, seen, name);
    }
    if (ts.isSpreadElement(parent)) {
      const holder = parent.parent;
      if (ts.isCallExpression(holder) || ts.isNewExpression(holder)) return sink(at, holder, name);
      // `[...settings.items]`: a new array of the same elements.
      return types.holdsOnlyPrimitives(at)
        ? { kind: "irrelevant" }
        : follow(holder, steps, seen, name);
    }
    if (ts.isAwaitExpression(parent)) return follow(parent, steps, seen, name);
    if (ts.isConditionalExpression(parent)) {
      return parent.condition === at ? { kind: "irrelevant" } : follow(parent, steps, seen, name);
    }
    if (ts.isBinaryExpression(parent)) {
      const { kind } = parent.operatorToken;
      if (kind === ts.SyntaxKind.EqualsToken && parent.right === at) {
        // `holder.value = settings`: the rule reads it as a store it cannot follow (a finding).
        return reaches(at) ? { kind: "decided" } : sink(at, parent, name);
      }
      if (
        kind === ts.SyntaxKind.QuestionQuestionToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        (kind === ts.SyntaxKind.CommaToken && parent.right === at)
      ) {
        return follow(parent, steps, seen, name);
      }
      // A comparison, arithmetic, `in`, `instanceof`: reads it.
      return { kind: "irrelevant" };
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === at) {
      if (ts.isIdentifier(parent.name) && exported(parent)) {
        return unchecked(parent, `gives \`${name}\` a name other files can use`);
      }
      return followName(parent.name, steps, seen, name);
    }
    if (ts.isForOfStatement(parent) && parent.expression === at) {
      const list = parent.initializer;
      if (!ts.isVariableDeclarationList(list)) {
        return unchecked(parent, "puts each element in a place that is not followed");
      }
      return worst(list.declarations.map((one) => followName(one.name, steps, seen, name)));
    }
    if (ts.isArrayLiteralExpression(parent)) return follow(parent, steps, seen, name);
    if (ts.isPropertyAssignment(parent) && parent.initializer === at) {
      return literal(parent.parent, steps, seen, name);
    }
    if (ts.isShorthandPropertyAssignment(at)) return literal(at.parent, steps, seen, name);
    if (ts.isSpreadAssignment(parent)) return literal(parent.parent, steps, seen, name);
    if (ts.isJsxExpression(parent)) {
      if (ts.isJsxAttribute(parent.parent)) return sink(at, parent.parent, name);
      // `<p>{theme}</p>`: a plain value shown is read.
      return types.isPrimitive(at)
        ? { kind: "irrelevant" }
        : unchecked(parent, `gives \`${name}\` to JSX, which is not followed`);
    }
    if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === at)) {
      return returned(parent, steps, seen, name);
    }
    if (ts.isYieldExpression(parent)) {
      return unchecked(parent, "is yielded by a generator, which is not followed");
    }
    if (ts.isPropertyDeclaration(parent) && parent.initializer === at) {
      const owner = ts.isClassLike(parent.parent) ? parent.parent.name?.text : undefined;
      return unchecked(
        parent,
        `keeps \`${name}\` in the field \`${parent.name.getText(sourceFile)}\`${owner === undefined ? "" : ` of \`${owner}\``}, which is not followed`,
      );
    }
    if ((ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.initializer === at) {
      return unchecked(parent, "is a default value, which is not followed");
    }
    if (ts.isTemplateSpan(parent) && ts.isTaggedTemplateExpression(parent.parent.parent)) {
      return unchecked(parent.parent.parent, "gives it to a tag function, which is not followed");
    }
    if (
      ts.isExpressionStatement(parent) ||
      ts.isVoidExpression(parent) ||
      ts.isTypeOfExpression(parent) ||
      ts.isPrefixUnaryExpression(parent) ||
      ts.isPostfixUnaryExpression(parent) ||
      ts.isTemplateSpan(parent) ||
      ts.isIfStatement(parent) ||
      ts.isWhileStatement(parent) ||
      ts.isDoStatement(parent) ||
      ts.isSwitchStatement(parent) ||
      ts.isCaseClause(parent) ||
      ts.isForInStatement(parent) ||
      ts.isForStatement(parent) ||
      ts.isComputedPropertyName(parent) ||
      ts.isExportAssignment(parent) ||
      ts.isExportSpecifier(parent) ||
      ts.isDeleteExpression(parent)
    ) {
      return { kind: "irrelevant" };
    }
    return unchecked(parent, `uses \`${name}\` in a way stateward does not follow`);
  }

  /**
   * An object literal that holds the value: followed on, unless a method of it reaches the value
   * through `this` (`{ s: settings, clear() { this.s.user = null; } }`).
   */
  function literal(
    object: ts.ObjectLiteralExpression,
    steps: { left: number },
    seen: Set<ts.Node>,
    name: string,
  ): Verdict {
    const usesThis = object.properties.some((property) => {
      if (
        !ts.isMethodDeclaration(property) &&
        !ts.isGetAccessorDeclaration(property) &&
        !ts.isSetAccessorDeclaration(property) &&
        !(
          ts.isPropertyAssignment(property) &&
          ts.isFunctionExpression(unwrapped(property.initializer))
        )
      ) {
        return false;
      }
      let found = false;
      const visit = (node: ts.Node): void => {
        if (found) return;
        if (node.kind === ts.SyntaxKind.ThisKeyword) found = true;
        else ts.forEachChild(node, visit);
      };
      visit(property);
      return found;
    });
    return usesThis
      ? unchecked(
          object,
          `holds \`${name}\` and reaches it through \`this\`, which is not followed`,
        )
      : follow(object, steps, seen, name);
  }

  /** `x.m(…)`: the rule reads the call on `x` (a change, or none); its result is followed on. */
  function method(
    receiver: ts.Node,
    access: ts.PropertyAccessExpression,
    call: ts.CallExpression,
    steps: { left: number },
    seen: Set<ts.Node>,
    name: string,
  ): Verdict {
    const read = sink(receiver, call, name);
    const symbol = types.symbolAt(access.name);
    const declared = symbol && types.declarationOf(symbol);
    const library = declared !== undefined && isDefaultLibrary(declared.file, types);
    const verdicts: Verdict[] = [read];
    if (library && ELEMENT_METHODS.has(access.name.text)) {
      // Each element goes to the callback's parameter: followed there.
      for (const given of call.arguments) {
        const fn = unwrapped(given);
        if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) continue;
        const parameter = fn.parameters[elementIndex(access.name.text)];
        if (parameter !== undefined) verdicts.push(followName(parameter.name, steps, seen, name));
        // The receiver itself, given as the callback's last argument: `(item, i, arr) => …`.
        const at = receiverIndex(access.name.text);
        const whole = at === undefined ? undefined : fn.parameters[at];
        if (whole !== undefined) verdicts.push(followName(whole.name, steps, seen, name));
      }
    }
    // What the call returns may be the value or a part of it (`items.find(…)`, a method of the
    // project that returns `this`).
    if (!types.isPrimitive(call) && !types.holdsOnlyPrimitives(call)) {
      verdicts.push(follow(call, steps, seen, name));
    }
    return worst(verdicts);
  }

  /** The value given to a call or `new`: what the rule reads of each kind of callee. */
  function argument(
    value: ts.Node,
    call: ts.CallExpression | ts.NewExpression,
    steps: { left: number },
    seen: Set<ts.Node>,
    name: string,
  ): Verdict {
    const callee = unwrapped(call.expression);
    const named = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    const symbol = types.symbolAt(named);
    const declared = symbol && types.declarationOf(symbol);
    const index = call.arguments?.findIndex((one) => one === value) ?? -1;
    if (declared !== undefined && isDefaultLibrary(declared.file, types)) {
      const object = libraryObject(callee);
      if (
        (ts.isPropertyAccessExpression(callee) && INDIRECT.has(callee.name.text)) ||
        (object === "Reflect" &&
          ts.isPropertyAccessExpression(callee) &&
          REFLECT_INDIRECT.has(callee.name.text))
      ) {
        return unchecked(
          call,
          `calls a function with \`${name}\` indirectly, which is not followed`,
        );
      }
      if (ts.isNewExpression(call)) {
        const made = ts.isIdentifier(callee) ? callee.text : "";
        if (!COLLECTIONS.has(made)) {
          return unchecked(call, `wraps \`${name}\` in a value whose changes are not followed`);
        }
        return follow(call, steps, seen, name);
      }
      const changes =
        index === 0 &&
        object !== undefined &&
        ts.isPropertyAccessExpression(callee) &&
        (CHANGES_FIRST.get(object)?.has(callee.name.text) ?? false);
      if (changes) return sink(value, call, name);
      // A copy: nothing it holds is the value.
      if (named.getText(sourceFile) === "structuredClone") return { kind: "irrelevant" };
      const verdicts: Verdict[] = [{ kind: "decided" }];
      // `list.push(settings)`: the value is in `list` now, followed through its other names.
      if (
        ts.isPropertyAccessExpression(callee) &&
        storesArguments(declared.node, callee.name.text)
      ) {
        const target = unwrapped(callee.expression);
        const stored = ts.isIdentifier(target) ? types.symbolAt(target) : undefined;
        const found = stored === undefined ? undefined : types.declarationOf(stored);
        const holder = found?.node;
        if (
          found !== undefined &&
          holder !== undefined &&
          found.file === ctx.file &&
          ts.isVariableDeclaration(holder) &&
          ts.isIdentifier(holder.name)
        ) {
          verdicts.push(
            exported(holder)
              ? unchecked(call, `stores \`${name}\` in a value other files can use`)
              : followName(holder.name, steps, seen, name),
          );
        } else if (!reaches(target)) {
          verdicts.push(unchecked(call, `stores \`${name}\` where it is not followed`));
        }
      }
      // `Object.values(settings)`, `Promise.all([settings])`: the result holds it.
      if (!types.isPrimitive(call) && !types.holdsOnlyPrimitives(call)) {
        verdicts.push(follow(call, steps, seen, name));
      }
      return worst(verdicts);
    }
    if (ts.isNewExpression(call)) return sink(value, call, name);
    if (types.parameterIsReadonly(call, index)) return { kind: "irrelevant" };
    if (
      symbol !== undefined &&
      declared !== undefined &&
      types.isOwnFile(declared.file) &&
      (functionOf(declared.node) !== undefined || ts.isFunctionDeclaration(declared.node)) &&
      index >= 0
    ) {
      if (!reaches(value)) return sink(value, call, name);
      return {
        kind: "handed",
        callee: symbol.id,
        index,
        shown: `${text(named, 30)}(…)`,
      };
    }
    // A parameter, a value, a package's function: the rule reports it as a place not checked.
    return sink(value, call, name);
  }

  /** The value returned by a function: followed only where that function's result goes. */
  function returned(
    at: ts.Node,
    steps: { left: number },
    seen: Set<ts.Node>,
    name: string,
  ): Verdict {
    const fn = ts.isArrowFunction(at) ? at : ts.findAncestor(at.parent, ts.isFunctionLike);
    if (fn === undefined) return unchecked(at, "is returned where it is not followed");
    if (ts.isGetAccessorDeclaration(fn)) {
      return unchecked(
        at,
        `is what the getter \`${fn.name.getText(sourceFile)}\` returns, which is not followed`,
      );
    }
    if (
      (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isFunctionExpression(fn)) &&
      fn.asteriskToken !== undefined
    ) {
      return unchecked(at, "is returned by a generator, which is not followed");
    }
    const held = outermost(fn);
    const call = held.parent;
    if (
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
      ts.isCallExpression(call) &&
      call.expression !== held
    ) {
      // A callback: what it returns goes to the call (`map`), whose result is followed.
      const callee = unwrapped(call.expression);
      const named = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
      const symbol = types.symbolAt(named);
      const declared = symbol && types.declarationOf(symbol);
      if (declared !== undefined && isDefaultLibrary(declared.file, types)) {
        return types.isPrimitive(call) || types.holdsOnlyPrimitives(call)
          ? { kind: "irrelevant" }
          : follow(call, steps, seen, name);
      }
      return unchecked(
        at,
        `is returned to \`${text(call.expression, 30)}(…)\`, which is not followed`,
      );
    }
    const shown = fn.name === undefined ? text(fn, 30) : fn.name.getText(sourceFile);
    return unchecked(
      at,
      `returns \`${name}\` from \`${shorten(shown, 30)}\`: what its callers do with it is not followed`,
    );
  }
}
