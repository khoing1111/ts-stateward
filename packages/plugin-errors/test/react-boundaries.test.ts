import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check, createChecker, parseConfig } from "@stateward/core";
import type { CheckResult, Finding } from "@stateward/core";
import { errors } from "../src/index.js";
import { NOT_CAUGHT } from "../src/react/boundaries.js";
import { checkOnly, fixture, says, shown } from "./helpers.js";

const flagged = fixture("react-boundaries/flagged");
const clean = fixture("react-boundaries/not-flagged");
const src = (dir: string, name: string): string => path.join(dir, "src", name);

class BoundaryTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundaryTestError";
  }
}

function configOf(dir: string) {
  const parsed = parseConfig({ preset: "recommended", plugins: [errors()] }, dir);
  if (!parsed.ok) throw new BoundaryTestError(parsed.errors.join("\n"));
  return parsed.value;
}

/** Each note as `<file>: <message>`. */
function notes(finding: Finding | undefined): string[] {
  if (finding?.kind !== "problem") return [];
  return finding.related.map((one) => `${path.basename(one.location.file)}: ${one.message}`);
}

/** The text a finding's location covers. */
function textAt(finding: Finding | undefined): string {
  if (finding === undefined) return "";
  const { file, start, end } = finding.location;
  return readFileSync(file, "utf8").slice(start, end);
}

describe("errors/render-throw-without-boundary", () => {
  it("reports the entry once, with the path down to the hook that throws", () => {
    const findings = checkOnly(flagged, "render-throw-without-boundary");
    expect(shown(findings)).toEqual([
      says(
        "main.tsx",
        "`<App>` can throw `NotFoundError` while rendering, with no error boundary above it",
        [
          "wrap it in an error boundary, at this render or nearer to what throws; for example with react-error-boundary:",
          "    <ErrorBoundary FallbackComponent={ErrorPage}>",
          "      <App />",
          "    </ErrorBoundary>",
        ].join("\n"),
      ),
    ]);
    const [first] = findings;
    expect(first?.kind === "problem" ? first.severity : undefined).toBe("warning");
    expect(textAt(findings[0])).toBe("<App />");
    expect(notes(findings[0])).toEqual([
      "App.tsx: `<UserPage>` is rendered",
      "UserPage.tsx: `useUser(…)` can throw `NotFoundError`",
    ]);
  });

  it("is silent for pages inside a boundary, handlers, and errors it cannot see", () => {
    expect(checkOnly(clean, "render-throw-without-boundary")).toEqual([]);
  });

  describe("with a boundary around the whole app", () => {
    const rooted = fixture("react-boundaries/root-boundary");

    it("does not count it: reports where a boundary nearer the page is missing", () => {
      const findings = checkOnly(rooted, "render-throw-without-boundary");
      expect(shown(findings)).toEqual([
        says(
          "App.tsx",
          "`<UserPage>` can throw `NotFoundError` while rendering; only the app-wide boundary catches it",
          [
            "add a boundary around it, or set `rootBoundaryCounts` if replacing the whole app is intended:",
            "    <ErrorBoundary FallbackComponent={ErrorPage}>",
            "      <UserPage />",
            "    </ErrorBoundary>",
          ].join("\n"),
        ),
      ]);
      expect(textAt(findings[0])).toBe("<UserPage />");
      // The finding is at the render of `<UserPage>`: the path starts below it.
      expect(notes(findings[0])).toEqual(["UserPage.tsx: `useUser(…)` can throw `NotFoundError`"]);
    });

    it("counts it with `rootBoundaryCounts: true`, and plan says why the rule is silent", () => {
      const parsed = parseConfig(
        {
          preset: "recommended",
          plugins: [errors()],
          rules: {
            "errors/render-throw-without-boundary": ["warning", { rootBoundaryCounts: true }],
          },
        },
        rooted,
      );
      if (!parsed.ok) throw new BoundaryTestError(parsed.errors.join("\n"));
      const checker = createChecker({ config: parsed.value, cwd: rooted, cache: false });
      const result = checker.check();
      expect(result.findings.filter((one) => one.ruleId.startsWith("errors/render"))).toEqual([]);
      expect(checker.silentReasons().get("errors/render-throw-without-boundary")).toBe(
        "your app's root has an error boundary",
      );
    });

    it("gives no reason when the rule is not silent: a boundary that does not count, or none", () => {
      for (const dir of [rooted, flagged]) {
        const checker = createChecker({ config: configOf(dir), cwd: dir, cache: false });
        checker.check();
        expect(checker.silentReasons().get("errors/render-throw-without-boundary")).toBeUndefined();
      }
    });

    it("reports the entry itself when the app component throws on its own", () => {
      const app = src(rooted, "App.tsx");
      const throwing = `import { NotFoundError } from "./errors";\n\nexport function App() {\n  if (location.hash === "#gone") throw new NotFoundError("gone");\n  return <main />;\n}\n`;
      const result = check({
        config: configOf(rooted),
        cwd: rooted,
        overlays: new Map([[app, throwing]]),
      });
      const found = result.findings.filter(
        (one) => one.ruleId === "errors/render-throw-without-boundary",
      );
      expect(found.map((one) => one.message)).toEqual([
        "`<App>` can throw `NotFoundError` while rendering; only the app-wide boundary catches it",
      ]);
    });
  });
});

describe("errors/catch-misses-error on an error boundary's fallback", () => {
  it("reports a fallback whose instanceof branches miss a class its boundary catches", () => {
    const findings = checkOnly(flagged, "catch-misses-error");
    // PanelBoundary's switch has a `default`: it is not reported.
    expect(shown(findings)).toEqual([
      says(
        "App.tsx",
        "`UserErrorPage` does not handle `ParseError`, which its boundary can catch",
        [
          "add a branch for it, or end with one for any other error:",
          "    if (error instanceof ParseError) {",
          "      …",
          "    }",
          "    return <p>Something went wrong: {String(error)}</p>;",
        ].join("\n"),
      ),
    ]);
    expect(textAt(findings[0])).toBe("FallbackComponent={UserErrorPage}");
    expect(notes(findings[0])).toEqual([
      "SettingsPage.tsx: `readSettings(…)` can throw `ParseError`",
      "UserErrorPage.tsx: `UserErrorPage` branches on the error",
    ]);
  });

  it("is silent for a generic branch, and for branches that name every class or a parent of it", () => {
    expect(checkOnly(clean, "catch-misses-error")).toEqual([]);
  });
});

describe("errors hover on an error boundary", () => {
  const checker = createChecker({ config: configOf(flagged), cwd: flagged });
  checker.check();

  function hoverAt(file: string, needle: string): readonly string[] {
    const absolute = src(flagged, file);
    const at = readFileSync(absolute, "utf8").indexOf(needle);
    if (at < 0) throw new BoundaryTestError(`${needle} is not in ${file}`);
    return checker.hover(absolute, at + 1);
  }

  it("lists what the components below it throw while rendering, with the way it gets there", () => {
    expect(hoverAt("App.tsx", "ErrorBoundary FallbackComponent")).toEqual([
      `catches: ParseError (via <SettingsPage> → readSettings)\n\n${NOT_CAUGHT}`,
    ]);
  });

  it("stops at a nested boundary, and names what it cannot see", () => {
    expect(hoverAt("App.tsx", "ErrorBoundary\n")).toEqual([
      "catches: SyntaxError (via <Stats> → useStats) | others not known (from useParams: react-router-dom: no readable source)" +
        `\n\n${NOT_CAUGHT}`,
    ]);
  });

  it("counts what an effect throws", () => {
    expect(hoverAt("Dashboard.tsx", "PanelBoundary>")).toEqual([
      `catches: RangeError (via <Chart> → drawChart)\n\n${NOT_CAUGHT}`,
    ]);
  });

  it("keeps the throws hover on functions", () => {
    expect(hoverAt("UserPage.tsx", "useUser(id)")).toEqual(["throws: NotFoundError"]);
  });

  it("says when it catches nothing it can see", () => {
    const own = createChecker({ config: configOf(clean), cwd: clean });
    own.check();
    const layout = src(clean, "Layout.tsx");
    const at = readFileSync(layout, "utf8").indexOf("<ErrorBoundary");
    expect(own.hover(layout, at + 1)).toEqual([
      `catches: NotFoundError (via <UserPage> → useUser) | ParseError (via <SettingsPage> → readSettings) | others not known (from useParams: react-router-dom: no readable source)\n\n${NOT_CAUGHT}`,
    ]);
  });
});

describe("errors: JSX held in a variable", () => {
  const own = createChecker({ config: configOf(clean), cwd: clean });
  own.check();
  const hoverIn = (needle: string): readonly string[] => {
    const panels = src(clean, "Panels.tsx");
    const text = readFileSync(panels, "utf8");
    const at = text.indexOf("<ErrorBoundary", text.indexOf(needle));
    return own.hover(panels, at + 1);
  };

  it("is placed where a const is rendered", () => {
    expect(hoverIn("function ProfilePanel")).toEqual([
      `catches: NotFoundError (via <UserPage> → useUser) | others not known (from useParams: react-router-dom: no readable source)\n\n${NOT_CAUGHT}`,
    ]);
  });

  it("is placed where a let set in several branches is rendered", () => {
    expect(hoverIn("function SettingsPanel")).toEqual([
      `catches: ParseError (via <SettingsPage> → readSettings)\n\n${NOT_CAUGHT}`,
    ]);
  });

  it("is not reported when it is passed to a function (the clean app has no finding)", () => {
    expect(checkOnly(clean, "render-throw-without-boundary")).toEqual([]);
    const toasted = src(clean, "Panels.tsx");
    const moved = readFileSync(toasted, "utf8").replace(
      "const id = showToast(<UserPage />);",
      'const id = showToast(<p />);\n  const page = <UserPage />;\n  if (id === "") return page;',
    );
    const result = check({
      config: configOf(clean),
      cwd: clean,
      overlays: new Map([[toasted, moved]]),
    });
    // Held in a const and returned with no boundary: reported at the entry.
    expect(
      result.findings
        .filter((one) => one.ruleId === "errors/render-throw-without-boundary")
        .map((one) => one.message),
    ).toEqual([
      "`<App>` can throw `NotFoundError` while rendering, with no error boundary above it",
    ]);
  });
});

const withoutStats = ({ findings, hidden }: CheckResult) => ({ findings, hidden });

describe("errors React rules: cached summaries", () => {
  it("give what a run without a cache gives after edits in other files", () => {
    const config = configOf(flagged);
    const cached = createChecker({ config, cwd: flagged });
    const users = readFileSync(src(flagged, "users.ts"), "utf8");
    const app = readFileSync(src(flagged, "App.tsx"), "utf8");
    const steps: ReadonlyMap<string, string>[] = [
      new Map(),
      // useUser no longer throws: <App> needs no boundary, though main.tsx did not change.
      new Map([
        [src(flagged, "users.ts"), users.replace("throw new NotFoundError", "console.warn")],
      ]),
      new Map(),
      // UserPage moves under the settings boundary: its fallback now misses nothing new, but the
      // boundary catches NotFoundError, which UserErrorPage handles.
      new Map([
        [
          src(flagged, "App.tsx"),
          app.replace(
            '<Route path="/users/:id" element={<UserPage />} />',
            '<Route path="/users/:id" element={<ErrorBoundary FallbackComponent={UserErrorPage}><UserPage /></ErrorBoundary>} />',
          ),
        ],
      ]),
    ];
    const results = steps.map((overlays) => {
      const result = withoutStats(cached.check(overlays));
      expect(result).toEqual(withoutStats(check({ config, cwd: flagged, overlays })));
      return result;
    });
    const rendered = (result: (typeof results)[number] | undefined) =>
      result?.findings.filter((one) => one.ruleId === "errors/render-throw-without-boundary");
    expect(rendered(results[0])).toHaveLength(1);
    expect(rendered(results[1])).toEqual([]);
    expect(results[2]).toEqual(results[0]);
    expect(rendered(results[3])).toEqual([]);
  });
});

describe("errors/render-throw-without-boundary", () => {
  const dir = fixture("react-boundaries/render-body");

  it("counts a throw in the body, and a check on an optional prop or a hook parameter that can be undefined, not one the type rules out (`<Title>`); names a default export by its function", () => {
    const findings = checkOnly(dir, "render-throw-without-boundary");
    expect(shown(findings)).toEqual([
      says(
        "main.tsx",
        "`<App>` can throw `LabelError`, `SessionError` and `TitleError` while rendering, with no error boundary above it",
        [
          "wrap it in an error boundary, at this render or nearer to what throws; for example with react-error-boundary:",
          "    <ErrorBoundary FallbackComponent={ErrorPage}>",
          "      <App />",
          "    </ErrorBoundary>",
        ].join("\n"),
      ),
    ]);
    expect(notes(findings[0])).toEqual([
      "App.tsx: `<Header>` is rendered",
      "Header.tsx: `useLabel(…)` can throw `LabelError`",
    ]);
  });
});
