import path from "node:path";
import ts from "@stateward/core/typescript";
import type { FileContext, TypeQueries } from "@stateward/core";
import { declareFixOf, removalOf } from "./declare-fix.js";
import { fateOf, isValueWrapper, type FateEnv } from "./fate.js";
import { placementOf } from "./placement.js";
import {
  REQUIRED_CONTEXT,
  createResolver,
  type Resolver,
  type StatedRef,
  type Tag,
} from "./resolve.js";
import { createRoutes } from "./routes.js";
import {
  ANY_CONTEXT,
  type ComponentRender,
  type ComponentSummary,
  type HookSummary,
  type ComputedFix,
  type Loc,
  type Origin,
  type Placement,
  type Render,
  type Summary,
  type UnknownRender,
} from "./summary.js";
import {
  defaultKeywordOf,
  isFunctionLike,
  locOf,
  skipWrappers,
  tagText,
  type FunctionLike,
} from "./syntax.js";

/** The add-on that follows React Router routes. */
const ROUTER_ADDON = "react-router";

/** The add-on that follows constant maps, `lazy` imports and conditions between components. */
const DYNAMIC_ADDON = "dynamic-components";

/** A component or hook being filled in while its file is read. */
type Scope = {
  kind: "component" | "hook";
  fn: FunctionLike | undefined;
  /** What the scope covers: its function, or the routes of a router. */
  anchor: ts.Node | undefined;
  component: ComponentSummary;
  slots: Map<string, ComponentSummary["slots"][number]["positions"]>;
};

type Site = { scope: Scope | undefined; entryRoot: ts.Node | undefined };

/** What names a component, hook or router in the summary. */
type Identity = { id: string; name: string; loc: Loc };

function lastName(expression: ts.Expression): string {
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : expression.getText();
}

/** `{children}`, `return render`, `cloneElement(children)`: the prop is rendered where it stands. */
function isRenderPosition(node: ts.Node, resolver: Resolver): boolean {
  let child = node;
  while (isValueWrapper(child.parent, child)) child = child.parent;
  const parent = child.parent;
  if (ts.isJsxExpression(parent) || ts.isReturnStatement(parent)) return true;
  if (ts.isArrowFunction(parent)) return parent.body === child;
  return (
    ts.isCallExpression(parent) &&
    parent.arguments.some((argument) => argument === child) &&
    resolver.isChildrenCall(parent)
  );
}

function exportNamesOf(file: ts.SourceFile, ctx: FileContext): Map<string, string[]> {
  const names = new Map<string, string[]>();
  const add = (node: ts.Node | undefined, exportName: string): void => {
    const symbol = node && ctx.types.symbolAt(node);
    if (symbol === undefined) return;
    names.set(symbol.id, [...(names.get(symbol.id) ?? []), exportName]);
  };
  const modifiers = (statement: ts.Statement): readonly ts.Modifier[] =>
    ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
  const has = (statement: ts.Statement, kind: ts.SyntaxKind): boolean =>
    modifiers(statement).some((modifier) => modifier.kind === kind);

  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) continue;
      const value = skipWrappers(statement.expression);
      add(ts.isIdentifier(value) ? value : defaultKeywordOf(statement), "default");
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (statement.moduleSpecifier === undefined && clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          add(element.propertyName ?? element.name, element.name.text);
        }
      }
    } else if (has(statement, ts.SyntaxKind.ExportKeyword)) {
      const exportName = (name: string): string =>
        has(statement, ts.SyntaxKind.DefaultKeyword) ? "default" : name;
      if (ts.isFunctionDeclaration(statement)) {
        const marker = modifiers(statement).find(
          (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
        );
        add(statement.name ?? marker, exportName(statement.name?.text ?? "default"));
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            add(declaration.name, exportName(declaration.name.text));
          }
        }
      }
    }
  }
  return names;
}

/**
 * Reads one file into its summary: the required contexts it creates, its components and hooks
 * (what they read, call and render, and where), and the entry points it has. Resolution is by
 * declaration through `ctx.types`; the check that follows needs no type queries.
 */
/** A marker's type text longer than this is listed by its guarantee's name instead. */
const MARKER_TEXT_MAX = 60;

export function summarizeFile(
  ctx: FileContext<{ readonly lazyFunctions: readonly string[] }>,
): Summary | undefined {
  const resolver = createResolver(ctx.types, ctx.options.lazyFunctions);
  const sourceFile = ctx.sourceFile;
  const routes = createRoutes({
    sourceFile,
    resolver,
    types: ctx.types,
    follow: ctx.addons.includes(ROUTER_ADDON),
  });
  const fateEnv: FateEnv = {
    types: ctx.types,
    rendersIn: (node) => routes.rendersIn(node),
  };
  const summary: Summary = {
    contexts: [],
    components: [],
    hooks: [],
    entries: [],
    entryCalls: [],
    unknowns: [],
    routes: [],
    externalContexts: [],
    guards: [],
    declared: [],
    providers: [],
    statedProviders: [],
    singles: [],
  };
  const hookSummaries: HookSummary[] = [];
  const scopes = new Map<ts.Node, Scope>();
  const allScopes: Scope[] = [];
  const entryRoots = new Set<ts.Node>();

  const exportNames = exportNamesOf(sourceFile, ctx);
  const followDynamic = ctx.addons.includes(DYNAMIC_ADDON);

  function newScope(
    kind: Scope["kind"],
    identity: Identity,
    anchor: ts.Node | undefined,
    wraps: string | null,
  ): Scope {
    const component: ComponentSummary = {
      id: identity.id,
      name: identity.name,
      loc: identity.loc,
      exports: exportNames.get(identity.id) ?? [],
      wraps,
      reads: [],
      hooks: [],
      renders: [],
      slots: [],
    };
    const fn = anchor !== undefined && isFunctionLike(anchor) ? anchor : undefined;
    const scope: Scope = { kind, fn, anchor, component, slots: new Map() };
    allScopes.push(scope);
    if (anchor !== undefined) scopes.set(anchor, scope);
    return scope;
  }

  /** The name and id of a declaration: its own name, or for a default export the file's. */
  function identityOf(declaration: ts.Node): Identity | undefined {
    const named =
      (ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration)) &&
      declaration.name !== undefined &&
      ts.isIdentifier(declaration.name)
        ? declaration.name
        : undefined;
    if (named !== undefined) {
      const symbol = ctx.types.symbolAt(named);
      return symbol && { id: symbol.id, name: named.text, loc: locOf(named) };
    }
    const fileName = path.basename(sourceFile.fileName).replace(/\..*$/, "");
    if (ts.isExportAssignment(declaration) && !declaration.isExportEquals) {
      const symbol = ctx.types.symbolAt(defaultKeywordOf(declaration));
      return symbol && { id: symbol.id, name: fileName, loc: locOf(declaration) };
    }
    if (ts.isFunctionDeclaration(declaration) && declaration.name === undefined) {
      const marker = ts
        .getModifiers(declaration)
        ?.find((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
      const symbol = marker && ctx.types.symbolAt(marker);
      return symbol && { id: symbol.id, name: fileName, loc: locOf(declaration) };
    }
    return undefined;
  }

  function declareScope(declaration: ts.Node): void {
    const identity = identityOf(declaration);
    if (identity === undefined) return;
    const shape = resolver.componentShape(declaration);
    switch (shape?.kind) {
      case "function":
        newScope("component", identity, shape.fn, null);
        return;
      case "wrapper": {
        const target = resolver.resolve(shape.target);
        const own = target !== undefined && ctx.types.isOwnFile(target.file);
        const wrapped = ts.isIdentifier(shape.target) ? shape.target.text : identity.name;
        const named = ts.isExportAssignment(declaration)
          ? { ...identity, name: wrapped }
          : identity;
        newScope("component", named, undefined, own ? target.symbol.id : null);
        return;
      }
      case "lazy":
        newScope("component", identity, undefined, resolver.lazyComponent(shape) ?? null);
        return;
      case undefined: {
        const hook = resolver.hookFunction(declaration);
        if (hook !== undefined) newScope("hook", identity, hook, null);
        return;
      }
    }
  }

  // Every declaration is its own scope, nested ones too: a component declared inside another is
  // not the other, and its reads are not the other's.
  const declare = (node: ts.Node): void => {
    const declares =
      ts.isFunctionDeclaration(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isExportAssignment(node);
    if (declares) declareScope(node);
    ts.forEachChild(node, declare);
  };
  declare(sourceFile);

  // A router's routes render where the router does: a scope of their own.
  for (const root of routes.roots.values()) {
    newScope("component", { id: root.id, name: root.name, loc: root.loc }, root.node, null);
  }

  const scopeOf = (node: ts.Node): Scope | undefined => {
    for (let current = node; !ts.isSourceFile(current); current = current.parent) {
      const found = scopes.get(current);
      if (found) return found;
    }
    return undefined;
  };

  const entryRootOf = (node: ts.Node): ts.Node | undefined => {
    for (let current = node; !ts.isSourceFile(current); current = current.parent) {
      if (entryRoots.has(current)) return current;
    }
    return undefined;
  };

  const siteOf = (node: ts.Node): Site => ({
    scope: scopeOf(node),
    entryRoot: entryRootOf(node),
  });

  const placementAt = (node: ts.Node, site: Site): Placement =>
    placementOf(
      node,
      site.entryRoot ?? site.scope?.anchor ?? sourceFile,
      resolver,
      site.scope?.fn,
      routes.lookup,
    );

  /** Where a render of `target` stands; routes that are not followed are noted here. */
  function placeTarget(node: ts.Node, site: Site, target: string): Placement {
    const at = placementAt(node, site);
    if (at.under.includes(ANY_CONTEXT)) routes.noteUnchecked(node, target);
    return at;
  }

  function record(site: Site, loc: Loc, render: Render): void {
    if (site.entryRoot !== undefined) summary.entries.push({ loc, render });
    else if (site.scope?.kind === "component") site.scope.component.renders.push(render);
    else if (render.kind === "unknown") summary.unknowns.push(render);
    // A component render outside any component or entry call is never rendered by anything.
  }

  const componentRender = (
    id: string,
    name: string,
    loc: Loc,
    at: Placement,
    origin: Origin | null,
  ): ComponentRender => ({
    kind: "component",
    id,
    name,
    loc,
    under: at.under,
    via: at.via,
    origin,
  });

  const untargetedRender = (
    shape: { reason: "class" } | { reason: "computed"; fix: ComputedFix },
    name: string,
    loc: Loc,
    at: Placement,
  ): UnknownRender => ({
    kind: "unknown",
    ...shape,
    name,
    detail: name,
    loc,
    under: at.under,
    target: null,
  });

  /**
   * Renders the own component `id` where `node` stands (an element, or a `useRoutes` call).
   * `origin` says why a dynamic tag renders it.
   */
  function renderTarget(
    node: ts.Node,
    loc: Loc,
    name: string,
    id: string,
    origin: Origin | null = null,
  ): void {
    const site = siteOf(node);
    if (site.entryRoot !== undefined) {
      record(site, loc, componentRender(id, name, loc, placeTarget(node, site, id), origin));
      return;
    }
    const root = site.scope?.kind === "component" ? site.scope.fn : undefined;
    const fate = fateOf(node, root, fateEnv);
    if (fate.kind === "escapes") {
      const at = placementAt(node, site);
      const escaping: UnknownRender = {
        kind: "unknown",
        reason: "escapes",
        name,
        detail: fate.detail,
        loc,
        under: at.under,
        target: id,
      };
      record(site, loc, escaping);
      return;
    }
    for (const rendered of fate.sites) {
      record(site, loc, componentRender(id, name, loc, placeTarget(rendered, site, id), origin));
    }
  }

  function renderElement(
    element: ts.JsxElement | ts.JsxSelfClosingElement,
    opening: ts.JsxOpeningLikeElement,
    tag: Extract<Tag, { kind: "component" | "computed" | "dynamic" | "class" }>,
  ): void {
    const name = tagText(opening.tagName);
    const loc = locOf(opening);
    const unknown = (shape: Parameters<typeof untargetedRender>[0]): void => {
      const site = siteOf(element);
      record(site, loc, untargetedRender(shape, name, loc, placementAt(element, site)));
    };
    switch (tag.kind) {
      case "class":
        unknown({ reason: "class" });
        return;
      case "computed":
        unknown({
          reason: "computed",
          fix:
            tag.lazyFunction !== undefined
              ? { kind: "lazy-function", name: tag.lazyFunction }
              : followDynamic && tag.candidate
                ? "narrow"
                : "plain",
        });
        return;
      case "dynamic":
        if (!followDynamic) unknown({ reason: "computed", fix: "add-addon" });
        else if (givesSlots(element)) unknown({ reason: "computed", fix: "plain" });
        else
          for (const target of tag.targets)
            renderTarget(element, loc, name, target.id, target.origin);
        return;
      case "component":
        renderTarget(element, loc, name, tag.id);
        return;
    }
  }

  function addPosition(scope: Scope, name: string, node: ts.Node, loc: ts.Node): void {
    const positions = scope.slots.get(name) ?? [];
    positions.push({ ...placementAt(node, { scope, entryRoot: undefined }), loc: locOf(loc) });
    scope.slots.set(name, positions);
  }

  function handleElement(element: ts.JsxElement | ts.JsxSelfClosingElement): void {
    const opening = ts.isJsxElement(element) ? element.openingElement : element;
    const scope = scopeOf(element);
    const tag = resolver.resolveTag(opening.tagName, scope?.fn);
    if (tag.kind === "provider" || isProviderTagName(opening.tagName)) addStatedProvider(opening);
    switch (tag.kind) {
      case "provider":
        if (tag.single !== undefined) addProvider(element, opening, tag.context, tag.single);
        return;
      case "intrinsic":
      case "library":
      case "route":
        return;
      case "consumer":
        addStated({ id: tag.context, name: tag.name, loc: tag.loc });
        scope?.component.reads.push({ context: tag.context, loc: locOf(opening) });
        return;
      case "prop":
        if (scope?.kind === "component") addPosition(scope, tag.name, element, opening.tagName);
        return;
      case "outlet":
        // An outlet written in a route's element belongs to that route (see `routes`).
        if (scope?.kind === "component" && routes.routeElementRootOf(element) === undefined) {
          addPosition(scope, "outlet", element, opening.tagName);
        }
        return;
      case "router-provider": {
        const router = routes.routerIdOfProvider(opening);
        if (router !== undefined) {
          renderTarget(element, locOf(opening), tagText(opening.tagName), router);
        }
        return;
      }
      case "component":
      case "computed":
      case "dynamic":
      case "class":
        renderElement(element, opening, tag);
        return;
    }
  }

  /** `as={Profile}` or `Component: Profile`: a reference to an own component, rendered here. */
  function renderReference(reference: ts.Expression): void {
    if (!ts.isIdentifier(reference) && !ts.isPropertyAccessExpression(reference)) return;
    const id = resolver.componentIdOfReference(reference);
    if (id === undefined) return;
    const site = siteOf(reference);
    record(
      site,
      locOf(reference),
      componentRender(
        id,
        lastName(reference),
        locOf(reference),
        placeTarget(reference, site, id),
        null,
      ),
    );
  }

  function handleComponentReference(attribute: ts.JsxAttribute): void {
    const value = attribute.initializer;
    if (value === undefined || !ts.isJsxExpression(value) || value.expression === undefined) return;
    renderReference(value.expression);
  }

  function handleRouteProperty(property: ts.PropertyAssignment): void {
    if (routes.isComponentProperty(property)) renderReference(skipWrappers(property.initializer));
  }

  function handleSlotReference(node: ts.Identifier | ts.PropertyAccessExpression): void {
    const scope = scopeOf(node);
    if (scope?.kind !== "component" || scope.fn === undefined) return;
    const name = resolver.propName(node, scope.fn);
    if (name === undefined) return;
    const parent = node.parent;
    if (ts.isCallExpression(parent) && parent.expression === node) {
      addPosition(scope, name, parent, node);
      return;
    }
    // Rendered where it stands, or where the variable that holds it is used in JSX.
    const fate = fateOf(node, scope.fn, fateEnv);
    if (fate.kind === "rendered") {
      for (const site of fate.sites) addPosition(scope, name, site, site);
    } else if (isRenderPosition(node, resolver)) {
      addPosition(scope, name, node, node);
    }
  }

  /** A Provider of a context stated `SingleProvider`, with where it stands (`ProviderSite`). */
  function addProvider(
    element: ts.JsxElement | ts.JsxSelfClosingElement,
    opening: ts.JsxOpeningLikeElement,
    context: string,
    single: StatedRef,
  ): void {
    const site = siteOf(element);
    const owner =
      site.entryRoot !== undefined
        ? null
        : site.scope?.kind === "component"
          ? site.scope.component.id
          : "";
    const stop = site.entryRoot ?? site.scope?.anchor ?? sourceFile;
    const at = placementAt(element, site);
    summary.providers.push({
      owner,
      context,
      name: tagText(opening.tagName),
      loc: locOf(opening),
      span: locOf(element),
      under: at.under,
      via: at.via,
      outer: enclosingProvider(element, context, stop, site.scope?.fn),
    });
    if (!summary.singles.some((known) => known.id === single.id)) summary.singles.push(single);
  }

  /** The nearest Provider of `context` whose children hold `element`, up to `stop`. */
  function enclosingProvider(
    element: ts.Node,
    context: string,
    stop: ts.Node,
    fn: FunctionLike | undefined,
  ): Loc | null {
    for (let child = element; child !== stop && !ts.isSourceFile(child); child = child.parent) {
      const parent = child.parent;
      if (ts.isJsxElement(parent) && parent.children.some((member) => member === child)) {
        const tag = resolver.resolveTag(parent.openingElement.tagName, fn);
        if (tag.kind === "provider" && tag.context === context) return locOf(parent.openingElement);
      }
    }
    return null;
  }

  /** A context stated required, read in this file: listed once, with where it is declared. */
  function addStated(context: { id: string; name: string; loc: Loc }): void {
    if (summary.contexts.some((known) => known.id === context.id)) return;
    summary.contexts.push({
      id: context.id,
      name: context.name,
      loc: context.loc,
      stated: true,
      declare: null,
    });
  }

  function handleCall(call: ts.CallExpression): void {
    const checked = resolver.checkedContextRead(call);
    if (checked?.kind === "stated") {
      addStated(checked);
      const scope = scopeOf(call);
      scope?.component.reads.push({ context: checked.id, loc: locOf(call) });
      if (checked.guard !== undefined && scope?.kind === "hook") {
        summary.guards.push({
          context: checked.id,
          hook: scope.component.name,
          loc: locOf(checked.guard),
          removal: removalOf(checked.guard),
        });
      }
      return;
    }
    if (checked?.kind === "external") {
      summary.externalContexts.push({ id: checked.id, name: checked.name, loc: locOf(call) });
      return;
    }
    if (checked !== undefined) {
      scopeOf(call)?.component.reads.push({ context: checked.id, loc: locOf(call) });
      return;
    }
    const scope = scopeOf(call);
    const hook = resolver.ownHookId(call);
    if (scope !== undefined && hook !== undefined) {
      scope.component.hooks.push({ id: hook, loc: locOf(call) });
    }
  }

  /** A top-level context whose type states a trait, read or not (`Summary.declared`). */
  function addDeclared(declaration: ts.VariableDeclaration, name: ts.Identifier): void {
    const statement = declaration.parent.parent;
    if (!ts.isVariableStatement(statement) || !ts.isSourceFile(statement.parent)) return;
    const stated = resolver.contextTraits(name);
    if (stated === undefined) return;
    const text = ctx.types.typeTextOf(name);
    summary.declared.push({
      id: stated.id,
      name: name.text,
      loc: stated.loc,
      marker: text.length <= MARKER_TEXT_MAX ? text : REQUIRED_CONTEXT,
      traits: stated.traits,
    });
  }

  /**
   * A Provider of a context stated `SingleProvider` or `Stable` (`<StoreContext.Provider>`, or
   * `<StoreContext>` in React 19), for the list of its Providers (`Summary.statedProviders`).
   */
  function addStatedProvider(opening: ts.JsxOpeningLikeElement): void {
    const tag = opening.tagName;
    const named =
      ts.isPropertyAccessExpression(tag) && tag.name.text === "Provider"
        ? tag.expression
        : ts.isIdentifier(tag)
          ? tag
          : undefined;
    if (named === undefined) return;
    const stated = resolver.contextTraits(named);
    if (stated?.traits.some((trait) => trait !== REQUIRED_CONTEXT) !== true) return;
    summary.statedProviders.push({ context: stated.id, name: tagText(tag), loc: locOf(opening) });
  }

  function handleDeclaration(declaration: ts.VariableDeclaration): void {
    if (ts.isIdentifier(declaration.name)) addDeclared(declaration, declaration.name);
    const initializer = declaration.initializer;
    if (!ts.isIdentifier(declaration.name) || initializer === undefined) return;
    const call = ts.isCallExpression(initializer) ? initializer : undefined;
    if (call === undefined) return;
    if (!resolver.isMissingDefaultContextCall(call)) return;
    const symbol = ctx.types.symbolAt(declaration.name);
    if (symbol === undefined) return;
    const stated = resolver.statedContext(declaration.name) !== undefined;
    summary.contexts.push({
      id: symbol.id,
      name: declaration.name.text,
      loc: locOf(declaration),
      stated,
      declare: stated ? null : (declareFixOf(call, ctx.types, "unknown") ?? null),
    });
  }

  const findEntries = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const argument = resolver.entryArgument(node);
      if (argument !== undefined) {
        entryRoots.add(argument);
        summary.entryCalls.push(locOf(node));
      }
    }
    ts.forEachChild(node, findEntries);
  };
  findEntries(sourceFile);

  // `useRoutes(routes)` renders its routes where it is called.
  for (const root of routes.roots.values()) {
    if (root.kind === "use") renderTarget(root.call, root.loc, root.name, root.id);
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) handleDeclaration(node);
    else if (ts.isCallExpression(node)) handleCall(node);
    else if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) handleElement(node);
    else if (ts.isJsxAttribute(node)) handleComponentReference(node);
    else if (ts.isPropertyAssignment(node)) handleRouteProperty(node);
    else if (ts.isPropertyAccessExpression(node)) handleSlotReference(node);
    else if (ts.isIdentifier(node) && !isPropertyName(node)) handleSlotReference(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const scope of allScopes) {
    const { component } = scope;
    component.slots = [...scope.slots].map(([name, positions]) => ({ name, positions }));
    if (scope.kind === "component") summary.components.push(component);
    else hookSummaries.push(hookOf(component));
  }
  summary.hooks = hookSummaries;
  summary.routes = routes.routeSummaries();
  summary.unknowns.push(...routes.uncheckedUnknowns());

  const empty =
    summary.contexts.length === 0 &&
    summary.components.length === 0 &&
    summary.hooks.length === 0 &&
    summary.entries.length === 0 &&
    summary.entryCalls.length === 0 &&
    summary.unknowns.length === 0 &&
    summary.routes.length === 0 &&
    summary.externalContexts.length === 0 &&
    summary.guards.length === 0 &&
    summary.declared.length === 0 &&
    summary.providers.length === 0 &&
    summary.statedProviders.length === 0;
  return empty ? undefined : summary;
}

/**
 * A tag that can be a Provider without the resolver knowing its context: `X.Provider`, whatever
 * `X` is (a context stated only `Stable` has a default, so it is not one of the contexts the
 * rule follows).
 */
function isProviderTagName(tag: ts.JsxTagNameExpression): boolean {
  return ts.isPropertyAccessExpression(tag) && tag.name.text === "Provider";
}

/**
 * Whether an element hands JSX or a function to the component it renders (children, a render
 * prop): which component that is decides where they render, so a dynamic tag with any is unknown.
 */
function givesSlots(element: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
  if (ts.isJsxElement(element) && element.children.some((child) => !isBlankText(child))) {
    return true;
  }
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (isJsxOrFunction(node)) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(opening.attributes);
  return found;
}

function isBlankText(node: ts.JsxChild): boolean {
  return ts.isJsxText(node) && node.containsOnlyTriviaWhiteSpaces;
}

function isJsxOrFunction(node: ts.Node): boolean {
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node) ||
    isFunctionLike(node)
  );
}

function hookOf(component: ComponentSummary): HookSummary {
  return {
    id: component.id,
    name: component.name,
    reads: component.reads,
    hooks: component.hooks,
  };
}

/** `b` in `a.b` is a property name, not a reference to a variable called `b`. */
function isPropertyName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return ts.isPropertyAccessExpression(parent) && parent.name === identifier;
}

/**
 * The summaries made in this run, by the file's type queries (one object per file per run, which
 * every rule on that file gets), then by what changes a summary. \`provider-missing\` and
 * \`provider-nested\` read the same render tree: the second rule on a file gets the first one's
 * summary instead of reading the file again. The engine records what a file reads per file, not per
 * rule, so its cache still sees every declaration the summary read.
 */
const made = new WeakMap<
  TypeQueries,
  Map<string, { sourceFile: ts.SourceFile; summary: Summary | undefined }>
>();

/** \`summarizeFile\`, made once per file per run for every rule of the pack that reads it. */
export function sharedSummary(
  ctx: FileContext<{ readonly lazyFunctions: readonly string[] }>,
): Summary | undefined {
  const key = JSON.stringify([ctx.file, ctx.options.lazyFunctions, [...ctx.addons].sort()]);
  let known = made.get(ctx.types);
  if (known === undefined) {
    known = new Map();
    made.set(ctx.types, known);
  }
  const hit = known.get(key);
  if (hit?.sourceFile === ctx.sourceFile) return hit.summary;
  const summary = summarizeFile(ctx);
  known.set(key, { sourceFile: ctx.sourceFile, summary });
  return summary;
}
