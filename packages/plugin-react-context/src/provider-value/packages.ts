// A copy of @stateward/plugin-react's packages.ts: a pack depends on core only (SW3), so the two packs
// do not share code. A fix in one belongs in the other.
/**
 * What the render-stability rules know of packages' hooks (library knowledge lives in the
 * plugin). A hook is recognised by the package that declares it, never by its name alone, so a
 * project's own `useNavigate` is read like any other hook of the project.
 */

/** The hooks whose whole result is the same value each render, by package. */
const STABLE_RESULTS: Readonly<Record<string, ReadonlySet<string>>> = {
  // `useDispatch()` is the store's `dispatch`; `useStore()` the store itself.
  "react-redux": new Set(["useDispatch", "useStore"]),
  // `useNavigate()` keeps its identity (React Router's data and declarative modes alike).
  "react-router": new Set(["useNavigate"]),
  "react-router-dom": new Set(["useNavigate"]),
};

/**
 * What a package's function returns as the render-stability rules see it: `stable` when the
 * package keeps it the same each render, `package` otherwise (a package's value: not read, nothing
 * said about it).
 *
 * RTK Query's generated hooks (`useGetItemsQuery`, `useSaveItemMutation`, `useLazyGetItemsQuery`)
 * are the package's: their triggers and `refetch` keep their identity, and `data` stays the same
 * object while the cached result does not change, so a dependency on any of them is fine.
 */
export function packageHookValue(owner: string, name: string): "stable" | "package" {
  return STABLE_RESULTS[owner]?.has(name) === true ? "stable" : "package";
}
