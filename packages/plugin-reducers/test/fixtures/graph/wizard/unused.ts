export type Mode = { kind: "on" } | { kind: "off" };

// The signature of a reducer, but no `useReducer` and no `@initial`: it is not read as a machine.
export function toggle(mode: Mode, flip: boolean): Mode {
  return flip ? { kind: mode.kind === "on" ? "off" : "on" } : mode;
}
