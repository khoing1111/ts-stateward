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

/** A text edit of a fix, as plain JSON. */
export type Edit = { file: string; start: number; end: number; newText: string };

/**
 * The quick fix that states a context is required: the declaration rewritten to
 * `requiredContext<User>()`, its import, and the guarantees file when it is missing. `forms` are
 * the ways to write it, in order (the guarantees file exists, or it is written now): the first
 * that compiles is offered. `call` is the new declaration's call, for messages.
 */
export type DeclareFix = { call: string; forms: Edit[][] };

/**
 * A context that needs a Provider: made with no default and read through a check (guessed), or
 * whose type states it (`stated`: a `RequiredContext`, proven strictly).
 */
export type ContextDeclaration = {
  id: string;
  name: string;
  loc: Loc;
  stated: boolean;
  /** For a guessed context with a type argument: the fix that states it. */
  declare: DeclareFix | null;
};

/**
 * The run-time check of a stated context in a hook (`if (theme === undefined) throw …`): once
 * every reader is proven, the proof replaces it and a fix removes it.
 */
export type Guard = { context: string; hook: string; loc: Loc; removal: Edit };

export type Summary = {
  /**
   * React's `createContext` calls with no default: each needs a Provider once some component or
   * hook reads it and checks the value (`if (!v) throw …`). And the contexts stated required that
   * this file reads, wherever they are declared.
   */
  contexts: ContextDeclaration[];
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
  /** Run-time checks of stated contexts in hooks. */
  guards: Guard[];
  /**
   * The contexts this file declares at its top level whose type states a trait (`RequiredContext`,
   * `SingleProvider`, `Stable`), read or not: what `stateward guarantees` lists. The proof reads
   * `contexts`, never this.
   */
  declared: StatedDeclaration[];
  /**
   * The Providers in this file of contexts stated `SingleProvider` or `Stable`: what `stateward
   * guarantees` lists for those traits (`provider-nested` reads `providers`, never this).
   */
  statedProviders: { context: string; name: string; loc: Loc }[];
  /** The Providers of contexts stated `SingleProvider` in this file. */
  providers: ProviderSite[];
  /** The contexts stated `SingleProvider` those Providers are of, each once, with their declaration. */
  singles: { id: string; name: string; loc: Loc }[];
};

/**
 * A top-level context that states a trait: `marker` is its type as written (for a required
 * context), `traits` the traits it states (`CONTEXT_TRAITS`).
 */
export type StatedDeclaration = {
  id: string;
  name: string;
  loc: Loc;
  marker: string;
  traits: string[];
};

/**
 * A Provider of a context stated `SingleProvider` (`provider-nested`), where it stands: in the
 * component `owner` (null: in a `createRoot(…).render(…)` call; `""`: in neither, so where it
 * renders is not followed). `span` is the whole element, so a render inside it is found;
 * `outer` is a Provider of the same context around it in the same JSX, if any.
 */
export type ProviderSite = {
  owner: string | null;
  context: string;
  /** The tag as written: `StoreContext.Provider`. */
  name: string;
  loc: Loc;
  span: Loc;
  under: string[];
  via: SlotRef[];
  outer: Loc | null;
};
