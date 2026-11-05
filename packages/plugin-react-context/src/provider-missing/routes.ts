import ts from "@stateward/core/typescript";
import type { TypeQueries } from "@stateward/core";
import { placementOf, type NestedRoute, type RouteLookup } from "./placement.js";
import type { Resolver, RouterCall } from "./resolve.js";
import type { ComponentRender, Loc, RouteSummary, SlotPosition, UnknownRender } from "./summary.js";
import { locOf, skipWrappers, tagText } from "./syntax.js";

/** The routes given to a router: `createBrowserRouter([...])` or `useRoutes([...])`. */
export type RouterRoot = {
  kind: RouterCall;
  /** The array of route objects, or the JSX given to `createRoutesFromElements`. */
  node: ts.Node;
  call: ts.CallExpression;
  /** Names the router in messages: its variable, or `routes`. */
  name: string;
  /** Identifies the router; the id of its variable when it has one, so other files find it. */
  id: string;
  loc: Loc;
};

type RouteNode = ts.JsxElement | ts.JsxSelfClosingElement | ts.ObjectLiteralExpression;

/** Properties of a route object that hold an element, and the one whose element has the outlet. */
const ELEMENT_PROPS: ReadonlySet<string> = new Set([
  "element",
  "errorElement",
  "hydrateFallbackElement",
]);
const OUTLET_PROPS: ReadonlySet<string> = new Set(["element", "Component"]);
const MAX_ALIAS_DEPTH = 4;

function propertyName(name: ts.PropertyName | ts.JsxAttributeName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function isJsxNode(node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

/**
 * React Router, as far as the rule follows it: where route objects are, how routes nest, which
 * node a router's routes are rendered from. With `follow` (the react-router add-on) a child route
 * renders at the `<Outlet/>` of its parent's element; without it, a nested route's element is not
 * checked, and one unknown per router says so.
 */
export function createRoutes(deps: {
  sourceFile: ts.SourceFile;
  resolver: Resolver;
  types: TypeQueries;
  follow: boolean;
}) {
  const { sourceFile, resolver, types, follow } = deps;
  const roots = new Map<ts.Node, RouterRoot>();
  const rootByCall = new Map<ts.CallExpression, RouterRoot>();
  const routeObjects = new Set<ts.ObjectLiteralExpression>();
  const elementSlots = new Set<ts.PropertyAssignment>();
  const componentSlots = new Set<ts.PropertyAssignment>();
  const used = new Map<string, RouteNode>();
  const unchecked = new Map<string, { loc: Loc; targets: Set<string> }>();

  const routeId = (route: RouteNode): string =>
    `${sourceFile.fileName}:${String(route.getStart())}:route`;

  function collectObjects(array: ts.ArrayLiteralExpression): void {
    for (const member of array.elements) {
      const route = skipWrappers(member);
      if (!ts.isObjectLiteralExpression(route)) continue;
      routeObjects.add(route);
      for (const property of route.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = propertyName(property.name);
        const value = skipWrappers(property.initializer);
        if (name !== undefined && ELEMENT_PROPS.has(name)) elementSlots.add(property);
        if (name === "Component") componentSlots.add(property);
        if (name === "children" && ts.isArrayLiteralExpression(value)) collectObjects(value);
      }
    }
  }

  /** The routes of a router call: a literal array, `createRoutesFromElements(<Route…/>)`, or a variable holding one. */
  function rootOf(argument: ts.Expression | undefined, depth = 0): ts.Node | undefined {
    const inner = argument && skipWrappers(argument);
    if (inner === undefined || depth > MAX_ALIAS_DEPTH) return undefined;
    if (ts.isArrayLiteralExpression(inner)) return inner;
    if (resolver.isRoutesFromElementsCall(inner)) {
      const jsx = inner.arguments[0] && skipWrappers(inner.arguments[0]);
      return jsx !== undefined && (isJsxNode(jsx) || ts.isJsxFragment(jsx)) ? jsx : undefined;
    }
    if (!ts.isIdentifier(inner)) return undefined;
    const found = resolver.resolve(inner);
    const declared = found?.node;
    if (declared === undefined || !ts.isVariableDeclaration(declared)) return undefined;
    // Routes kept in a variable of another file are not followed.
    return declared.getSourceFile() === sourceFile
      ? rootOf(declared.initializer, depth + 1)
      : undefined;
  }

  function addRoot(call: ts.CallExpression): void {
    const kind = resolver.routerCall(call);
    const node = kind && rootOf(call.arguments[0]);
    if (kind === undefined || node === undefined || roots.has(node)) return;
    const holder = call.parent;
    const variable =
      ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name) ? holder.name : undefined;
    const symbol = kind === "create" && variable ? types.symbolAt(variable) : undefined;
    // Without a variable to name it, a root is known by its file and its order in the file: an
    // edit elsewhere in the file keeps it (ids carry no offsets).
    const fallback = `${sourceFile.fileName}#$${String(roots.size + 1)}`;
    const root: RouterRoot = {
      kind,
      node,
      call,
      name: kind === "create" ? (variable?.text ?? "router") : "routes",
      id: symbol?.id ?? `${fallback}:${kind === "create" ? "router" : "routes"}`,
      loc: locOf(call),
    };
    roots.set(node, root);
    rootByCall.set(call, root);
    if (ts.isArrayLiteralExpression(node)) collectObjects(node);
  }

  const find = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) addRoot(node);
    ts.forEachChild(node, find);
  };
  find(sourceFile);

  /** A JSX `<Route>` element. */
  const isRouteElement = (node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement => {
    if (!isJsxNode(node)) return false;
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    return resolver.resolveTag(opening.tagName, undefined).kind === "route";
  };

  function attributes(route: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxAttribute[] {
    const opening = ts.isJsxElement(route) ? route.openingElement : route;
    return opening.attributes.properties.filter(ts.isJsxAttribute);
  }

  /** The expression of a route's `element` (or `Component`), the one whose outlet children use. */
  function elementOf(route: RouteNode): ts.Expression | undefined {
    if (ts.isObjectLiteralExpression(route)) {
      const property = route.properties.find(
        (candidate): candidate is ts.PropertyAssignment =>
          ts.isPropertyAssignment(candidate) &&
          OUTLET_PROPS.has(propertyName(candidate.name) ?? ""),
      );
      return property?.initializer;
    }
    const attribute = attributes(route).find((candidate) =>
      OUTLET_PROPS.has(propertyName(candidate.name) ?? ""),
    );
    const value = attribute?.initializer;
    return value !== undefined && ts.isJsxExpression(value) ? value.expression : undefined;
  }

  function routeParentOf(child: ts.Node, parent: ts.Node): RouteNode | undefined {
    if (ts.isJsxElement(parent)) {
      const inside = parent.children.some((member) => member === child);
      return inside && isRouteElement(parent) ? parent : undefined;
    }
    if (!ts.isObjectLiteralExpression(child) || !ts.isArrayLiteralExpression(parent)) {
      return undefined;
    }
    const holder = parent.parent;
    if (!ts.isPropertyAssignment(holder) || propertyName(holder.name) !== "children") {
      return undefined;
    }
    const owner = holder.parent;
    return ts.isObjectLiteralExpression(owner) && routeObjects.has(owner) ? owner : undefined;
  }

  const lookup: RouteLookup = {
    nestedIn(child, parent): NestedRoute | undefined {
      const route = routeParentOf(child, parent);
      if (route === undefined || elementOf(route) === undefined) return undefined;
      if (!follow) return { kind: "unchecked" };
      used.set(routeId(route), route);
      return { kind: "outlet", slot: { owner: routeId(route), name: "outlet" } };
    },
  };

  /** The route element `node` sits in (`element={…}` or `element: …`), if any. */
  function routeElementRootOf(node: ts.Node): ts.Node | undefined {
    for (let current = node; !ts.isSourceFile(current); current = current.parent) {
      const parent = current.parent;
      if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
        if (ts.isObjectLiteralExpression(parent.parent) && routeObjects.has(parent.parent)) {
          return OUTLET_PROPS.has(propertyName(parent.name) ?? "") ? current : undefined;
        }
      }
      if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
        const owner = parent.parent.parent.parent;
        if (isRouteElement(owner)) {
          return OUTLET_PROPS.has(propertyName(parent.parent.name) ?? "") ? current : undefined;
        }
      }
    }
    return undefined;
  }

  function summaryOf(route: RouteNode): RouteSummary {
    const carriers: ComponentRender[] = [];
    const outlets: SlotPosition[] = [];
    const leaves: SlotPosition[] = [];
    const source = elementOf(route);
    const summary: RouteSummary = { id: routeId(route), loc: locOf(route), carriers, outlets };
    if (source === undefined) return summary;
    const reference = skipWrappers(source);
    if (ts.isIdentifier(reference) || ts.isPropertyAccessExpression(reference)) {
      const id = resolver.componentIdOfReference(reference);
      const name = ts.isIdentifier(reference) ? reference.text : reference.name.text;
      if (id !== undefined) {
        carriers.push({
          kind: "component",
          id,
          name,
          loc: locOf(reference),
          under: [],
          via: [],
          origin: null,
        });
      }
      return summary;
    }
    const visit = (node: ts.Node): void => {
      if (isJsxNode(node)) inspect(node);
      ts.forEachChild(node, visit);
    };
    const inspect = (element: ts.JsxElement | ts.JsxSelfClosingElement): void => {
      const opening = ts.isJsxElement(element) ? element.openingElement : element;
      const tag = resolver.resolveTag(opening.tagName, undefined);
      const placement = (): { under: string[]; via: SlotPosition["via"] } =>
        placementOf(element, source, resolver, undefined);
      const isLeaf = !ts.isJsxElement(element) || !element.children.some(isJsxNode);
      switch (tag.kind) {
        case "component":
          carriers.push({
            kind: "component",
            id: tag.id,
            name: tagText(opening.tagName),
            loc: locOf(opening),
            origin: null,
            ...placement(),
          });
          return;
        case "outlet":
          outlets.push({ ...placement(), loc: locOf(opening.tagName) });
          return;
        case "library":
        case "computed":
        case "dynamic":
        case "class":
          // Something stateward cannot look into: its outlet, if any, is where it stands.
          if (isLeaf) leaves.push({ ...placement(), loc: locOf(opening) });
          return;
        case "intrinsic":
        case "provider":
        case "prop":
        case "route":
        case "router-provider":
          return;
      }
    };
    visit(source);
    if (carriers.length === 0 && outlets.length === 0) outlets.push(...leaves);
    return summary;
  }

  /** The top of the route tree `node` is in, as the place to say routes were not followed. */
  function routerOf(node: ts.Node): { key: string; loc: Loc } {
    let top: ts.Node | undefined;
    for (let current = node; !ts.isSourceFile(current); current = current.parent) {
      const root = roots.get(current);
      if (root !== undefined)
        return { key: `${root.loc.file}:${String(root.loc.start)}`, loc: root.loc };
      if (isRouteElement(current)) top = current;
    }
    const holder = top?.parent;
    const routes =
      holder !== undefined &&
      ts.isJsxElement(holder) &&
      resolver.isRoutesTag(holder.openingElement.tagName)
        ? holder.openingElement
        : top;
    const found = routes ?? node;
    return { key: `${sourceFile.fileName}:${String(found.getStart())}`, loc: locOf(found) };
  }

  /** The id of the router `<RouterProvider router={…}/>` renders, if it is one made in own files. */
  function routerIdOfProvider(opening: ts.JsxOpeningLikeElement): string | undefined {
    const attribute = opening.attributes.properties
      .filter(ts.isJsxAttribute)
      .find((candidate) => propertyName(candidate.name) === "router");
    const value = attribute?.initializer;
    const expression =
      value !== undefined && ts.isJsxExpression(value) && value.expression
        ? skipWrappers(value.expression)
        : undefined;
    if (expression === undefined) return undefined;
    if (ts.isCallExpression(expression)) return rootByCall.get(expression)?.id;
    if (!ts.isIdentifier(expression) && !ts.isPropertyAccessExpression(expression)) {
      return undefined;
    }
    const found = resolver.resolve(expression);
    const initializer =
      found !== undefined && ts.isVariableDeclaration(found.node)
        ? found.node.initializer && skipWrappers(found.node.initializer)
        : undefined;
    const isRouter =
      initializer !== undefined &&
      ts.isCallExpression(initializer) &&
      resolver.routerCall(initializer) === "create";
    return isRouter ? found?.symbol.id : undefined;
  }

  return {
    roots,
    lookup,
    /** Whether `node` is rendered by the place it is held in (a route object's `element`, a router's routes). */
    rendersIn(node: ts.Node): boolean {
      const parent = node.parent;
      const slot =
        ts.isPropertyAssignment(parent) && parent.initializer === node && elementSlots.has(parent);
      return slot || roots.has(node);
    },
    /** `Component: Layout` in a route object: the property, if `node` is one. */
    isComponentProperty: (node: ts.PropertyAssignment): boolean => componentSlots.has(node),
    routeElementRootOf,
    routerIdOfProvider,
    /** Notes that `target` renders in a nested route whose router is not followed. */
    noteUnchecked(node: ts.Node, target: string): void {
      const router = routerOf(node);
      const entry = unchecked.get(router.key) ?? { loc: router.loc, targets: new Set<string>() };
      entry.targets.add(target);
      unchecked.set(router.key, entry);
    },
    uncheckedUnknowns(): UnknownRender[] {
      return [...unchecked.values()].map((entry) => ({
        kind: "unknown",
        reason: "router",
        name: "routes",
        detail: "routes",
        loc: entry.loc,
        under: [],
        targets: [...entry.targets].sort(),
      }));
    },
    routeSummaries: (): RouteSummary[] => [...used.values()].map(summaryOf),
  };
}

export type Routes = ReturnType<typeof createRoutes>;
