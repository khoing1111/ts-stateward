type Mode = "r" | "w" | "x" | "y";

// The type also names "r", which the chain tests: it does not say which cases fall through.
export function namesTestedCase(mode: Mode): number {
  if (mode === "r") {
    return 1;
  } else if (mode === "w") {
    return 2;
  } else {
    mode satisfies "r" | "x" | "y";
    return 0;
  }
}
