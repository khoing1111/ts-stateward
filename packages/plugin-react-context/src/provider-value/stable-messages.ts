/** The messages of a Provider value that is not proven stable, for a context stated `Stable`. */
import type { Read, Unstable, Why } from "./stable.js";

function code(text: string): string {
  return `\`${text}\``;
}

const ALTERNATIVE = (context: string): string =>
  `- or remove \`Stable\` from the type of ${code(context)}, if its value is meant to change`;

const IS: Record<Why, string> = {
  state: "state",
  prop: "a prop",
  let: "a `let`",
  assigned: "assigned again in its file",
  ref: "what a ref holds now",
  context: "the value of a context not stated `Stable`",
  value: "read from a value that can change",
  hook: "the result of a hook of the project",
};

/** "`user` (state), `size` (a prop)". */
function reading(reads: readonly Read[]): string {
  return reads.map((read) => `${code(read.name)} (${IS[read.why]})`).join(", ");
}

/** The way out of a changing read: keep it out of the value and give it to readers elsewhere. */
function keepOut(reads: readonly Read[]): string {
  return `keep ${reading(reads)} out of this value and give ${reads.length === 1 ? "it" : "them"} to readers through another context`;
}

/** "`user` is read in the `useMemo` but not in its dependencies"; through a helper, "`helper` reads `user`, which the `useMemo` does not list". */
function staleReading(why: Extract<Unstable, { kind: "stale" }>): string {
  const { read, hook } = why;
  const via = read.via;
  return via === undefined
    ? `${code(read.name)} is read in the ${code(hook)} but not in its dependencies`
    : `${code(via)} reads ${code(read.name)}, which the ${code(hook)} does not list`;
}

/** The headline and fix of a value that may change, by why. */
export function notStable(context: string, why: Unstable): { message: string; hint: string } {
  const head = `${code(context)} is stated \`Stable\`, but its value`;
  switch (why.kind) {
    case "fresh":
      return {
        message: `${head} is a new ${why.what === "instance" ? "object" : why.what} every render`,
        hint: [
          "one of",
          why.reads.length === 0
            ? `- wrap it in ${code(why.what === "function" ? "useCallback" : "useMemo")} with dependencies that never change (a setter, a \`dispatch\`, a ref)`
            : `- ${keepOut(why.reads)}`,
          ALTERNATIVE(context),
        ].join("\n"),
      };
    case "stale":
      return {
        message: `${head} is not proven stable: ${staleReading(why)}`,
        hint: [
          "one of",
          `- ${keepOut([why.read])} (in the dependency list, it would make the value change)`,
          ALTERNATIVE(context),
        ].join("\n"),
      };
    case "no-dependencies":
      return {
        message: `${head} is new every render: ${code(why.hook)} has no dependency list`,
        hint: `add the dependency list as the second argument of ${code(why.hook)}, with only values that never change`,
      };
    case "changes":
      if (why.why === "hook") {
        return {
          message: `${code(context)} is stated \`Stable\`, but its value comes from ${code(why.name)}, a hook of the project that stateward does not follow`,
          hint: [
            "one of",
            "- build the value in the Provider's component from setters, a `dispatch`, refs, module constants, or `useMemo` over them",
            ALTERNATIVE(context),
          ].join("\n"),
        };
      }
      return {
        message: `${head} changes when ${code(why.name)} changes`,
        hint: [
          "one of",
          `- build the value only from what never changes (setters, a \`dispatch\`, refs, module constants), and give ${code(why.name)} to readers through another context`,
          ALTERNATIVE(context),
        ].join("\n"),
      };
    default: {
      const unreachable: never = why;
      return unreachable;
    }
  }
}

/** The note at what makes the value change. */
export function whyNote(why: Unstable): string {
  switch (why.kind) {
    case "changes":
      return {
        state: `${code(why.name)} is state: it changes when it is set`,
        prop: `${code(why.name)} is a prop: the parent can pass a new one`,
        let: `${code(why.name)} is a \`let\`: it can be assigned again`,
        assigned: `${code(why.name)} is assigned again in its file`,
        ref: `${code(why.name)} is what the ref holds now`,
        context: `${code(why.name)} is the value of a context not stated \`Stable\``,
        value: `${code(why.name)} is read from a value that can change`,
        hook: `${code(why.name)} is the result of a hook of the project: it can change`,
      }[why.why];
    case "stale":
      return `${code(why.read.name)} is ${IS[why.read.why]}, and the ${code(why.hook)} does not list it${why.read.via === undefined ? "" : ` (read through ${code(why.read.via)})`}`;
    case "fresh":
      return `a new ${why.what === "instance" ? "object" : why.what} is created here on every render`;
    case "no-dependencies":
      return `${code(why.hook)} without a dependency list runs on every render`;
    default: {
      const unreachable: never = why;
      return unreachable;
    }
  }
}
