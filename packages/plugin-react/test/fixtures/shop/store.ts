import { api, type Profile } from "./api.js";

type Settings = { dark: boolean };

function createStore(initial: Settings) {
  let settings = initial;
  return () => ({
    settings,
    update(next: Settings) {
      settings = next;
    },
  });
}

/** A hook made by a factory: not a function stateward can read. */
export const useSettings = createStore({ dark: false });

/** Returns what an object's method gives: stateward cannot tell if it is new each time. */
export function useProfile(): { profile: Profile } {
  return { profile: api.readProfile() };
}
