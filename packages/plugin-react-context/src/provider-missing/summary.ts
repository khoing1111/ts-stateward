/**
 * The per-file summary of the `provider-missing` rule. Everything here
 * is plain JSON: the engine round-trips it, and `check` reads nothing else.
 */

export type Loc = { file: string; start: number; end: number };

/**
 * In `Placement.under`: every context is provided here. Used for what stateward does not follow
 * (a nested React Router route without the add-on), so that nothing there is reported.
 */
export const ANY_CONTEXT = "*";

/** A slot of a component: `children`, or the name of a prop that holds JSX, a function or a component. */
export type SlotRef = { owner: string; name: string };

/**
 * Where something sits: the required contexts whose Provider surrounds it in the component body
 * (`under`), and the slots of other components it was given to, innermost first (`via`). In
 * `<Layout><Card><Profile/></Card></Layout>`, `Profile` has `via` = [Card.children,
 * Layout.children]: it renders where `Card` renders `children`, and `Card` renders where `Layout`
 * renders `children`.
 */
export type Placement = { under: string[]; via: SlotRef[] };

/**
 * Why a dynamic tag (`<Panel/>` with `const Panel = panels[tab]`) renders a component: the entry
 * of the map (`entry`: `panels["profile"]`) or the branch of a condition (`branch`: `Panel`).
 */
export type Origin = { kind: "entry" | "branch"; label: string; loc: Loc };

export type ComponentRender = {
  kind: "component";
  id: string;
  /** The tag as written, for messages. */
  name: string;
  loc: Loc;
  under: string[];
  via: SlotRef[];
  /** Set on each render of a dynamic-components target; null for a tag that names its component. */
  origin: Origin | null;
};

/**
 * What the fix line of a computed tag says: `add-addon` when the dynamic-components add-on would
 * follow it, `narrow` when the add-on is on and the tag only looks like a shape it follows,
 * `lazy-function` when an unknown function is given an import (`withRetry(() => import("./X"))`),
 * `plain` otherwise.
 */
export type ComputedFix =
  "plain" | "add-addon" | "narrow" | { kind: "lazy-function"; name: string };

export type UnknownRender =
  | {
      kind: "unknown";
      /** A tag that is no component stateward knows. */
      reason: "computed";
      fix: ComputedFix;
      /** The tag as written (`P`). */
      name: string;
      detail: string;
      loc: Loc;
      under: string[];
      target: null;
    }
  | {
      kind: "unknown";
      /** An own class component. */
      reason: "class";
      name: string;
      detail: string;
      loc: Loc;
      under: string[];
      target: null;
    }
  | {
      kind: "unknown";
      reason: "escapes";
      /** The tag as written (`Profile`). */
      name: string;
      /** What the element is passed to (`toast()`). */
      detail: string;
      loc: Loc;
      under: string[];
      /** The own component the element renders. */
      target: string;
    }
  | {
      kind: "unknown";
      /** Nested React Router routes that were not followed (the add-on is off). */
      reason: "router";
      name: string;
      detail: string;
      loc: Loc;
      under: string[];
      /** The own components rendered in those routes, which were not checked. */
      targets: string[];
    };

export type Render = ComponentRender | UnknownRender;

export type Read = { context: string; loc: Loc };
export type HookCall = { id: string; loc: Loc };
export type SlotPosition = { under: string[]; via: SlotRef[]; loc: Loc };

export type ComponentSummary = {
  id: string;
  name: string;
  loc: Loc;
  /** Export names of the file: `App`, or `default`. */
  exports: string[];
  /** For `memo(Inner)`: the id of `Inner`; this component is that one. */
  wraps: string | null;
  reads: Read[];
  hooks: HookCall[];
  renders: Render[];
  slots: { name: string; positions: SlotPosition[] }[];
};

/**
 * A React Router route with an element and child routes (react-router add-on). Its child routes
 * render where the element renders an `<Outlet/>`: directly (`outlets`), or inside an own
 * component of the element (`carriers`: that component's `outlet` slot, placed as written).
 */
export type RouteSummary = {
  id: string;
  loc: Loc;
  carriers: ComponentRender[];
  outlets: SlotPosition[];
};

export type HookSummary = { id: string; name: string; reads: Read[]; hooks: HookCall[] };

export type Summary = {
  /**
   * React's `createContext` calls with no default: each needs a Provider once some component or
   * hook reads it and checks the value (`if (!v) throw …`).
   */
  contexts: { id: string; name: string; loc: Loc }[];
  components: ComponentSummary[];
  hooks: HookSummary[];
  /** Elements rendered by `createRoot(…).render(…)` and `hydrateRoot(…)`, one per element. */
  entries: { loc: Loc; render: Render }[];
  /** Every `createRoot(…).render(…)` and `hydrateRoot(…)` call, even one that renders no own component. */
  entryCalls: Loc[];
  /** Unknowns outside any component (an element passed to a call in a plain function). */
  unknowns: UnknownRender[];
  routes: RouteSummary[];
  /** Checked reads of a context declared outside the checked files. */
  externalContexts: { id: string; name: string; loc: Loc }[];
};
