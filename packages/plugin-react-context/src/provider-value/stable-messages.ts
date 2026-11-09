/** The messages of a Provider value that is not proven stable, for a context stated `Stable`. */
import type { Unstable } from "./stable.js";

function code(text: string): string {
  return `\`${text}\``;
}

const ALTERNATIVE = (context: string): string =>
  `- or remove \`Stable\` from the type of ${code(context)}, if its value is meant to change`;

/** The headline and fix of a value that may change, by why. */
export function notStable(context: string, why: Unstable): { message: string; hint: string } {
  const head = `${code(context)} is stated \`Stable\`, but its value`;
  switch (why.kind) {
    case "fresh":
      return {
        message: `${head} is a new ${why.what === "instance" ? "object" : why.what} every render`,
        hint: [
          "one of",
          `- wrap it in ${code(why.what === "function" ? "useCallback" : "useMemo")} with dependencies that never change (a setter, a \`dispatch\`, a ref)`,
          ALTERNATIVE(context),
        ].join("\n"),
      };
    case "no-dependencies":
      return {
        message: `${head} is new every render: ${code(why.hook)} has no dependency list`,
        hint: `add the dependency list: ${code(`${why.hook}(…, [])`)} with only values that never change`,
      };
    case "changes":
      return {
        message: `${head} changes when ${code(why.name)} changes`,
        hint: [
          "one of",
          `- build the value only from what never changes (setters, a \`dispatch\`, refs, module constants), and give ${code(why.name)} to readers through another context`,
          ALTERNATIVE(context),
        ].join("\n"),
      };
    case "unknown":
      return {
        message: `${head} is not proven to stay the same: ${code(why.text)} cannot be followed`,
        hint: [
          "one of",
          "- build the value in the Provider's component from setters, a `dispatch`, refs, module constants, or `useMemo` over them",
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
        ref: `${code(why.name)} is what the ref holds now`,
        context: `${code(why.name)} is the value of a context not stated \`Stable\``,
        value: `${code(why.name)} is read from a value that can change`,
      }[why.why];
    case "fresh":
      return `a new ${why.what === "instance" ? "object" : why.what} is created here on every render`;
    case "no-dependencies":
      return `${code(why.hook)} without a dependency list runs on every render`;
    case "unknown":
      return `${code(why.text)} cannot be followed`;
    default: {
      const unreachable: never = why;
      return unreachable;
    }
  }
}
