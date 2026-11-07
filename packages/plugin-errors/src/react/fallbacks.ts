import { matchesName } from "@stateward/core";
import type { Location, RelatedLocation } from "@stateward/core";
import { catchName, className } from "../inference/format.js";
import { relation } from "../inference/solve.js";
import type { Model } from "./boundaries.js";
import type { Chain, Fallback, FallbackKind } from "./tree.js";

import { codeList, fitted, withExample } from "../text.js";

/**
 * Error boundary fallbacks, checked as catches (`errors/catch-misses-error`; they were
 * `errors/exhaustive-fallback` in earlier releases): a fallback that branches on the error with
 * `instanceof` handles every class its boundary can catch, or has a branch for the rest.
 */

/** What the fallback does with any other error, in the example: what it returns or does. */
function restLine(kind: FallbackKind, variable: string): string {
  switch (kind) {
    case "FallbackComponent":
    case "fallbackRender":
      return `return <p>Something went wrong: {String(${variable})}</p>;`;
    case "onError":
      return `console.error(${variable});`;
    case "getDerivedStateFromError":
      return `return { error: ${variable} };`;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function hint(fallback: Fallback, chain: Chain, handler: string, count: number): string {
  const line = `add a branch for ${count === 1 ? "it" : "each"}, or end with one for any other error:`;
  const rest = restLine(fallback.kind, chain.variable);
  return chain.dispatch === "switch"
    ? withExample(line, [
        `case ${chain.variable} instanceof ${handler}:`,
        "  …",
        "default:",
        `  ${rest}`,
      ])
    : withExample(line, [`if (${chain.variable} instanceof ${handler}) {`, "  …", "}", rest]);
}

type Problem = {
  message: string;
  hint: string;
  location: Location;
  related: readonly RelatedLocation[];
};

/** Reports each fallback that leaves out a class its boundary can catch. */
export function checkFallbacks(
  model: Model,
  ignored: readonly string[],
  report: (problem: Problem) => void,
): void {
  const classes = model.analysis.classes;
  for (const [key, { file, element }] of model.boundaries) {
    for (const fallback of element.fallbacks) {
      const chain = fallback.chain;
      if (chain === null || chain.generic || !chain.exact) continue;
      const handled: string[] = [];
      let readable = true;
      for (const branch of chain.branches) {
        if (branch === null) readable = false;
        else handled.push(...branch);
      }
      if (!readable) continue;
      const caught = model.catches(key);
      const missing = [...caught.classes]
        .filter(
          ([id, brought]) =>
            brought.certain &&
            !matchesName(catchName(id, classes), ignored) &&
            handled.every((one) => relation(one, id, classes) === "no"),
        )
        .map(([id, brought]) => ({ id, brought, name: className(id, classes) }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const [first] = missing;
      if (first === undefined) continue;
      const related: RelatedLocation[] = missing.slice(0, 3).map(({ brought, name }) => ({
        location: brought.location,
        message: `${brought.what} \`${name}\``,
      }));
      related.push({
        location: { file: chain.file, start: chain.at[0], end: chain.at[1] },
        message: `\`${fallback.name}\` branches on the error`,
      });
      report({
        message: fitted(
          (cut) =>
            `\`${cut(fallback.name)}\` does not handle ${codeList(
              missing.map((one) => one.name),
              cut,
            )}, which its boundary can catch`,
        ),
        hint: hint(fallback, chain, catchName(first.id, classes), missing.length),
        location: { file, start: fallback.at[0], end: fallback.at[1] },
        related,
      });
    }
  }
}
