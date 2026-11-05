// What the rule reports by default: chains that look meant to handle every case.
type Phase = "draft" | "review" | "approved" | "published" | "archived";

// (a) Every case handled, the `else` proves nothing: reported.
export function complete(mode: "r" | "w"): number {
  if (mode === "r") {
    return 1;
  } else if (mode === "w") {
    return 2;
  } else {
    return 0;
  }
}

// (b) Two cases tested, the `else` takes two more nobody tested: likely forgotten, reported.
export function hidesTwo(phase: "draft" | "review" | "approved" | "published"): number {
  if (phase === "draft") {
    return 1;
  } else if (phase === "review") {
    return 2;
  } else {
    return 0;
  }
}

// (b) The `else` takes three untested cases: "everything else" on purpose, silent.
export function hidesThree(phase: Phase): number {
  if (phase === "draft") {
    return 1;
  } else if (phase === "review") {
    return 2;
  } else {
    return 0;
  }
}

// (c) No `else`, one case missing: almost complete, reported.
export function missesOne(phase: "draft" | "review" | "approved"): number {
  if (phase === "draft") {
    return 1;
  } else if (phase === "review") {
    return 2;
  }
  return 0;
}

// (c) No `else`, two cases missing: handles only some values on purpose, silent.
export function missesTwo(phase: "draft" | "review" | "approved" | "published"): number {
  let step = 0;
  if (phase === "draft") {
    step = 1;
  } else if (phase === "review") {
    step = 2;
  }
  return step;
}
