import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { typeErrors } from "@stateward/core/testing";
import {
  checkOnly,
  checkWith,
  exampleBlocks,
  fixture,
  inCopy,
  says,
  shown,
  stringList,
} from "./helpers.js";
import type { Replacement } from "./helpers.js";

const RULE = "render-throw-without-boundary";
const dir = (name: string): string => fixture(`react-boundaries/${name}`);
const file = (name: string, source: string): string => path.join(dir(name), "src", source);

const HEADLINE =
  "`<App>` can throw `NotFoundError` while rendering, with no error boundary above it";
const IMPORT = 'import { ErrorBoundary } from "react-error-boundary";\n';
const FALLBACK = "<ErrorBoundary fallback={<p>Something went wrong.</p>}>";

/** Wraps the text `inner` (found in `source`) with the example's lines, and imports the boundary. */
function wrap(
  fixtureName: string,
  source: string,
  inner: string,
  lines: readonly string[],
  withImport: boolean,
): Replacement[] {
  const target = file(fixtureName, source);
  const text = readFileSync(target, "utf8");
  const start = text.indexOf(inner);
  expect(start).toBeGreaterThanOrEqual(0);
  return [
    ...(withImport ? [{ file: target, start: 0, end: 0, text: IMPORT }] : []),
    { file: target, start, end: start + inner.length, text: lines.join("\n") },
  ];
}

describe(`errors/${RULE}: at the app's own render`, () => {
  it("points to the render that throws, with its props, then to the app-wide fallback with its option", () => {
    expect(shown(checkOnly(dir("hints-plain"), RULE))).toEqual([
      says(
        "main.tsx",
        HEADLINE,
        [
          "one of",
          "- wrap it in react-error-boundary's `ErrorBoundary` (imported as a value), or a class of yours with `getDerivedStateFromError`, not around the whole app:",
          `    ${FALLBACK}`,
          "      <UserPage id={location.hash.slice(1)} />",
          "    </ErrorBoundary>",
          "- or if one fallback for the whole app is what you want, wrap it and set the `rootBoundaryCounts` option to `true`:",
          `    ${FALLBACK}`,
          "      <App />",
          "    </ErrorBoundary>",
        ].join("\n"),
      ),
    ]);
  });

  it("no longer offers a wrap of the whole app on its own, with the props dropped or a placeholder", () => {
    const [finding] = checkOnly(dir("hints-plain"), RULE);
    expect(finding?.hint).not.toContain("at this render or nearer to what throws");
    expect(finding?.hint).not.toContain("FallbackComponent");
    expect(finding?.hint).not.toContain("…");
    expect(finding?.hint).not.toContain("<UserPage />");
  });

  it("silences the finding when the render that throws is wrapped as shown, and the code compiles", () => {
    const [finding] = checkOnly(dir("hints-plain"), RULE);
    const [way] = exampleBlocks(finding?.hint ?? "");
    inCopy(
      dir("hints-plain"),
      wrap("hints-plain", "App.tsx", "<UserPage id={location.hash.slice(1)} />", way ?? [], true),
      (copy) => {
        expect(typeErrors(copy)).toBe("");
        expect(checkOnly(copy, RULE)).toEqual([]);
      },
    );
  });

  it("counts the boundary around the whole app only with `rootBoundaryCounts`, as the hint says", () => {
    const [finding] = checkOnly(dir("hints-plain"), RULE);
    const [, root] = exampleBlocks(finding?.hint ?? "");
    const replacements = wrap("hints-plain", "main.tsx", "<App />", root ?? [], true);
    inCopy(dir("hints-plain"), replacements, (copy) => {
      expect(typeErrors(copy)).toBe("");
      // Wrapped, but the option is off: the finding moves to the render below the boundary.
      expect(checkOnly(copy, RULE).map((one) => one.message)).toEqual([
        "`<UserPage>` can throw `NotFoundError` while rendering; only the app-wide boundary catches it",
      ]);
      expect(checkWith(copy, RULE, ["warning", { rootBoundaryCounts: true }])).toEqual([]);
    });
  });
});

describe(`errors/${RULE}: the project's own boundary`, () => {
  it("names it, and does not offer react-error-boundary's", () => {
    const [finding] = checkOnly(dir("hints-own"), RULE);
    expect(finding?.hint).toBe(
      [
        "one of",
        "- wrap `<UserPage>` in `ErrorBoundary`, which the project already uses, not around the whole app",
        "- or if one fallback for the whole app is what you want, wrap it and set the `rootBoundaryCounts` option to `true`",
      ].join("\n"),
    );
    expect(finding?.hint).not.toContain("react-error-boundary");
  });

  it("silences the finding when the render is wrapped in it", () => {
    inCopy(
      dir("hints-own"),
      wrap(
        "hints-own",
        "App.tsx",
        "<UserPage id={location.hash.slice(1)} />",
        ["<ErrorBoundary>", "  <UserPage id={location.hash.slice(1)} />", "</ErrorBoundary>"],
        false,
      ),
      (copy) => {
        expect(typeErrors(copy)).toBe("");
        expect(checkOnly(copy, RULE)).toEqual([]);
      },
    );
  });
});

describe(`errors/${RULE}: a boundary from a package that is not listed`, () => {
  it("offers listing it, with the option written out, and the option silences the finding", () => {
    const [finding] = checkOnly(dir("hints-listed"), RULE);
    const blocks = exampleBlocks(finding?.hint ?? "");
    expect(finding?.hint).toContain(
      "- or if `<ErrorBoundary>` from `@sentry/react` is an error boundary, add it to the `boundaries` option, next to the ones already there:",
    );
    const listing = blocks.at(-1) ?? [];
    expect(listing).toEqual([
      "boundaries: {",
      '  "react-error-boundary": ["ErrorBoundary"],',
      '  "@sentry/react": ["ErrorBoundary"],',
      "}",
    ]);
    // The option as written in the hint, read back as it is.
    const written = listing
      .join("")
      .replace(/^boundaries: /, "")
      .replace(/,\}$/, "}");
    const parsed: unknown = JSON.parse(written);
    if (typeof parsed !== "object" || parsed === null) throw new Error("the hint shows a record");
    const boundaries = Object.fromEntries(
      Object.entries(parsed).map(([name, tags]) => [name, stringList(JSON.stringify(tags))]),
    );
    expect(checkWith(dir("hints-listed"), RULE, ["warning", { boundaries }])).toEqual([]);
  });
});
