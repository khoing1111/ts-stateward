import type { PackageFactsConfig } from "@stateward/core";

/**
 * The release trait of common packages' functions (stateward's facts), in the config's `facts`
 * shape: `"release"` means call the returned function, `{ release: "<method>" }` call that method
 * on the returned value; `neverRejects` says an `await` of the promise is not a way out. A project's own `facts` line for the same function wins. Each is tested
 * against a declared copy of the package's types (test/fixtures/resource-not-released/packages).
 *
 * Firebase's functions are declared in `@firebase/firestore` and imported from
 * `firebase/firestore`: both names are listed.
 */
export const RELEASE_FACTS: PackageFactsConfig = {
  "firebase/firestore": { onSnapshot: { returns: "release" } },
  "@firebase/firestore": { onSnapshot: { returns: "release" } },
  rxjs: { "Observable.subscribe": { returns: { release: "unsubscribe" } } },
  redux: { "Store.subscribe": { returns: "release" } },
  zustand: { "StoreApi.subscribe": { returns: "release" } },
  // RTK Query resolves `cacheEntryRemoved` when the cache entry is removed and never rejects it,
  // so a release after `await cacheEntryRemoved` runs (the `onCacheEntryAdded` streaming pattern).
  "@reduxjs/toolkit": { cacheEntryRemoved: { neverRejects: true } },
};
