import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Finding, Location, Plugin, ProjectRule } from "@stateward/core";
import { checkFixture, expectMessageStandard, ruleCode } from "@stateward/core/testing";
import { reactContext } from "../src/index.js";
import { createProviderMissing } from "../src/provider-missing/rule.js";
import type { Summary } from "../src/provider-missing/summary.js";

// Each fixture is a TypeScript program; the engine-contract tests run every one of them.
const SLOW = 300_000;
const FIXTURES = fileURLToPath(new URL("./fixtures/provider-missing", import.meta.url));

function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

function where(location: Location, dir: string): string {
  const line = readFileSync(location.file, "utf8").slice(0, location.start).split("\n").length;
  return `${path.relative(dir, location.file).split(path.sep).join("/")}:${String(line)}`;
}

/** A finding as the CLI shows it: severity, place, headline, fix and notes in order. */
function show(finding: Finding, dir: string): string[] {
  const head = `${finding.kind === "problem" ? finding.severity : "info"} ${where(finding.location, dir)}: ${finding.message}`;
  const notes =
    finding.kind === "problem"
      ? finding.related.map((note) => `note ${where(note.location, dir)}: ${note.message}`)
      : [];
  return [head, `fix: ${finding.hint}`, ...notes];
}

function run(
  name: string,
  plugin: Plugin = reactContext(),
  addons: readonly string[] = [],
): string[][] {
  const dir = fixture(name);
  const { findings } = checkFixture(dir, [plugin], {}, addons);
  expectMessageStandard(findings);
  return findings.map((finding) => show(finding, dir));
}

const FIX_MISSING = (context: string): string =>
  `fix: wrap it in \`<${context}.Provider value={…}>\`, or render it inside a component that provides it`;
const FIX_UNREACHABLE =
  "fix: render it from your app, or list it in `entries` in the react-context options";
const UNREACHABLE_PROFILE =
  "info src/Profile.tsx:4: `Profile` needs `AuthCtx`, but no entry point renders it";

function missing(site: string, tag: string, context: string, ...notes: string[]): string[] {
  return [
    `error ${site}: \`<${tag}>\` is rendered without \`${context}.Provider\``,
    FIX_MISSING(context),
    ...notes.map((note) => `note ${note}`),
  ];
}

const reads = "src/Profile.tsx:5: `Profile` reads `AuthCtx`";

const DYNAMIC_ADDON = ["react-context/dynamic-components"];
const FIX_DYNAMIC =
  'fix: add `"react-context/dynamic-components"` to `addons` in your stateward config';
const PLAIN =
  "fix: render the component directly; constant maps are checked by the dynamic-components add-on";
const NARROW =
  "fix: render the component directly, or pick it from a `const` object by a key of a finite type";
const unreachable = (site: string, name: string, context: string): string[] => [
  `info ${site}: \`${name}\` needs \`${context}\`, but no entry point renders it`,
  FIX_UNREACHABLE,
];
const cannotTell = (site: string, tag: string, fix: string): string[] => [
  `info ${site}: stateward cannot tell which component \`<${tag}>\` is`,
  fix,
];

const ROUTER_ADDON = ["react-context/react-router"];
const FIX_ROUTER = 'fix: add `"react-context/react-router"` to `addons` in your stateward config';
const routerNotFollowed = (site: string): string[] => [
  `info ${site}: stateward does not follow React Router routes without the react-router add-on`,
  FIX_ROUTER,
];

describe("react-context/provider-missing: satisfied", () => {
  it.each([
    "satisfied-entry",
    "satisfied-intermediate",
    "satisfied-hook",
    "children-authgate",
    "children-props-object",
    "children-nested",
    "render-prop-inside",
    "component-prop-inside",
    "local-variable",
    "library-transparent",
    "unknown-computed-quiet",
  ])("reports nothing for %s", (name) => {
    expect(run(name)).toEqual([]);
  });
});

describe("react-context/provider-missing: missing", () => {
  it("reports the Dashboard example once, at the site, with the path to the read", () => {
    expect(run("missing-dashboard")).toEqual([
      missing(
        "src/main.tsx:5",
        "Dashboard",
        "AuthCtx",
        "src/Dashboard.tsx:8: `<Profile>` is rendered here",
        reads,
      ),
    ]);
  });

  it("follows a custom hook to the read", () => {
    expect(run("missing-hook")).toEqual([
      missing(
        "src/main.tsx:5",
        "Profile",
        "AuthCtx",
        "src/Profile.tsx:4: `useSession` is called here",
        "src/useSession.ts:5: `useSession` reads `AuthCtx`",
      ),
    ]);
  });

  it("reports only the bad path when one of two paths is under the Provider", () => {
    expect(run("missing-one-path")).toEqual([
      missing(
        "src/main.tsx:5",
        "App",
        "AuthCtx",
        "src/App.tsx:8: `<Landing>` is rendered here",
        "src/Landing.tsx:4: `<Profile>` is rendered here",
        reads,
      ),
    ]);
  });

  it("reports two errors at one site when two contexts are missing", () => {
    expect(run("missing-two-contexts")).toEqual([
      missing(
        "src/main.tsx:5",
        "Profile",
        "AuthCtx",
        "src/Profile.tsx:5: `Profile` reads `AuthCtx`",
      ),
      missing(
        "src/main.tsx:5",
        "Profile",
        "ThemeCtx",
        "src/Profile.tsx:6: `Profile` reads `ThemeCtx`",
      ),
    ]);
  });

  it("shows at most five notes: the first three, the steps left out in the middle, and the read", () => {
    const [finding] = run("missing-long-path");
    expect(finding?.slice(2)).toEqual([
      "note src/Step1.tsx:4: `<Step2>` is rendered here",
      "note src/Step2.tsx:4: `<Step3>` is rendered here",
      "note src/Step3.tsx:4: `<Step4>` is rendered here",
      "note src/Step4.tsx:4: … 4 more steps …",
      "note src/Leaf.tsx:5: `Leaf` reads `AuthCtx`",
    ]);
  });

  it("sees through library components (they render children where they are)", () => {
    expect(run("library-missing")).toEqual([
      missing("src/main.tsx:8", "Profile", "AuthCtx", reads),
    ]);
  });

  it("follows memo, forwardRef and a memo of another component", () => {
    expect(run("memo-forwardref")).toEqual([
      missing(
        "src/main.tsx:5",
        "Badge",
        "AuthCtx",
        "src/Badge.tsx:5: `<Profile>` is rendered here",
        "src/Profile.tsx:7: `Profile` reads `AuthCtx`",
      ),
    ]);
  });

  it("settles recursion between two components", () => {
    expect(run("recursion")).toEqual([
      missing(
        "src/main.tsx:5",
        "Tree",
        "AuthCtx",
        "src/Tree.tsx:5: `<Profile>` is rendered here",
        reads,
      ),
    ]);
  });
});

describe("react-context/provider-missing: slots", () => {
  it("reports children rendered a second time outside the Provider", () => {
    expect(run("children-twice")).toEqual([
      missing(
        "src/main.tsx:5",
        "App",
        "AuthCtx",
        "src/App.tsx:7: `<Profile>` is rendered here",
        "src/Wrapper.tsx:8: `Wrapper` renders its `children` here, not under the Provider",
        reads,
      ),
    ]);
  });

  it("reports nothing wrong for a wrapper that never renders children, and says Profile is unreached", () => {
    expect(run("children-never")).toEqual([[UNREACHABLE_PROFILE, FIX_UNREACHABLE]]);
  });

  it("reports a render prop called outside the Provider", () => {
    expect(run("render-prop-outside")).toEqual([
      missing(
        "src/main.tsx:5",
        "App",
        "AuthCtx",
        "src/App.tsx:5: `<Profile>` is rendered here",
        "src/List.tsx:4: `List` renders its `renderItem` here, not under the Provider",
        reads,
      ),
    ]);
  });

  it("reports a component prop rendered outside the Provider", () => {
    expect(run("component-prop-outside")).toEqual([
      missing(
        "src/main.tsx:5",
        "App",
        "AuthCtx",
        "src/App.tsx:5: `<Profile>` is rendered here",
        "src/Panel.tsx:6: `Panel` renders its `as` here, not under the Provider",
        reads,
      ),
    ]);
  });
});

describe("react-context/provider-missing: Providers and slots found through declarations", () => {
  it("takes `const P = Ctx.Provider` and `const { Provider: P } = Ctx` as Providers", () => {
    expect(run("provider-alias")).toEqual([
      missing(
        "src/main.tsx:7",
        "Dashboard",
        "ThemeCtx",
        "src/Dashboard.tsx:11: `<Themed>` is rendered here",
        "src/Profile.tsx:10: `Themed` reads `ThemeCtx`",
      ),
    ]);
  });

  it("places children under the Provider through a variable and a conditional", () => {
    expect(run("children-variable")).toEqual([
      missing(
        "src/main.tsx:14",
        "Profile",
        "AuthCtx",
        "src/Gates.tsx:23: `LeakyGate` renders its `children` here, not under the Provider",
        reads,
      ),
    ]);
  });

  it("keeps a component declared inside another component as its own scope", () => {
    expect(run("nested-component")).toEqual([
      missing(
        "src/main.tsx:7",
        "Bare",
        "AuthCtx",
        "src/Pages.tsx:25: `<Cell>` is rendered here",
        "src/Pages.tsx:20: `Cell` reads `AuthCtx`",
      ),
    ]);
  });

  it("follows a default-exported hook through default imports and `export { default as … }`", () => {
    const hook = "src/hooks/useSession.ts:5: `useSession` reads `AuthCtx`";
    expect(run("hook-default-export")).toEqual([
      missing(
        "src/main.tsx:7",
        "Greeting",
        "AuthCtx",
        "src/Greeting.tsx:4: `useSession` is called here",
        hook,
      ),
      missing(
        "src/main.tsx:8",
        "Farewell",
        "AuthCtx",
        "src/Farewell.tsx:4: `useSession` is called here",
        hook,
      ),
    ]);
  });

  it('resolves `export default memo(X)` and `lazy(() => import("./X"))` to the component', () => {
    expect(run("default-memo-lazy")).toEqual([
      missing(
        "src/main.tsx:9",
        "Dashboard",
        "AuthCtx",
        "src/pages/Dashboard.tsx:5: `<Profile>` is rendered here",
        reads,
      ),
      missing(
        "src/main.tsx:10",
        "LazyPage",
        "AuthCtx",
        "src/pages/Lazy.tsx:4: `<Profile>` is rendered here",
        reads,
      ),
    ]);
  });
});

describe("react-context/provider-missing: React Router", () => {
  it(
    "follows a layout route's Outlet with the add-on, and says it does not without it",
    { timeout: SLOW },
    () => {
      expect(run("router-layout", reactContext(), ROUTER_ADDON)).toEqual([]);
      expect(run("router-layout")).toEqual([routerNotFollowed("src/App.tsx:11")]);
    },
  );

  it(
    "reports a layout route that renders its Outlet without the Provider",
    { timeout: SLOW },
    () => {
      expect(run("router-layout-missing", reactContext(), ROUTER_ADDON)).toEqual([
        missing(
          "src/main.tsx:4",
          "App",
          "AuthCtx",
          "src/App.tsx:9: `<Dashboard>` is rendered here",
          "src/Layout.tsx:6: `Layout` renders its `outlet` here, not under the Provider",
          "src/pages/Dashboard.tsx:4: `<Profile>` is rendered here",
          reads,
        ),
      ]);
      expect(run("router-layout-missing")).toEqual([routerNotFollowed("src/App.tsx:7")]);
    },
  );

  it(
    "follows route objects and a RouterProvider at the entry, and checks top-level routes either way",
    { timeout: SLOW },
    () => {
      const login = missing(
        "src/main.tsx:5",
        "RouterProvider",
        "AuthCtx",
        "src/router.tsx:16: `<Login>` is rendered here",
        "src/pages/Login.tsx:4: `<Profile>` is rendered here",
        reads,
      );
      expect(run("router-objects", reactContext(), ROUTER_ADDON)).toEqual([login]);
      expect(run("router-objects")).toEqual([login, routerNotFollowed("src/router.tsx:7")]);
    },
  );

  it(
    "follows code-split routes: lazy, React.lazy, a named export, and wrappers of lazy",
    { timeout: SLOW },
    () => {
      const dir = fixture("router-lazy");
      const reports = cannotTell(
        "src/router.tsx:21",
        "Reports",
        'fix: if `withRetry` loads the page with `lazy`, add `lazyFunctions: ["withRetry"]` to the options of `react-context/provider-missing`',
      );
      // Dashboard, Settings and Billing render under Layout's Provider: nothing to report, and
      // none is "rendered by no entry point". Reports goes through a wrapper that does more than
      // hand the import to `lazy`, so it is followed only once the option names it.
      expect(run("router-lazy", reactContext(), ROUTER_ADDON)).toEqual([
        unreachable("src/pages/Reports.tsx:3", "Reports", "AuthCtx"),
        reports,
      ]);
      const named = checkFixture(
        dir,
        [reactContext()],
        { "react-context/provider-missing": ["error", { lazyFunctions: ["withRetry"] }] },
        ROUTER_ADDON,
      ).findings;
      expectMessageStandard(named);
      expect(named.map((finding) => show(finding, dir))).toEqual([
        missing(
          "src/main.tsx:5",
          "RouterProvider",
          "AuthCtx",
          "src/router.tsx:21: `<Reports>` is rendered here",
          "src/pages/Reports.tsx:4: `<Profile>` is rendered here",
          reads,
        ),
      ]);
    },
  );

  it(
    "follows a lazyFunctions wrapper through .then picks and Promise.all",
    { timeout: SLOW },
    () => {
      const dir = fixture("router-lazy-forms");
      const findings = checkFixture(
        dir,
        [reactContext()],
        { "react-context/provider-missing": ["error", { lazyFunctions: ["load"] }] },
        ROUTER_ADDON,
      ).findings;
      expectMessageStandard(findings);
      // Each page module has an export the route does not pick: it is the one reported as
      // rendered by no entry point, so the list shows which export each form resolved to.
      expect(findings.map((finding) => show(finding, dir))).toEqual([
        unreachable("src/pages/A.tsx:7", "AUnused", "AuthCtx"),
        unreachable("src/pages/B.tsx:3", "BUnused", "AuthCtx"),
        unreachable("src/pages/C.tsx:3", "CUnused", "AuthCtx"),
        unreachable("src/pages/D2.tsx:3", "D2Unused", "AuthCtx"),
        unreachable("src/pages/E1.tsx:3", "E1Unused", "AuthCtx"),
        // F's thunk picks an export at run time: not decided, so its place stays not checked.
        unreachable("src/pages/F.tsx:3", "F", "AuthCtx"),
        cannotTell("src/router.tsx:24", "F", PLAIN),
      ]);
    },
  );

  it("follows useRoutes([…]) and createRoutesFromElements(…)", { timeout: SLOW }, () => {
    expect(run("router-use-routes", reactContext(), ROUTER_ADDON)).toEqual([]);
    expect(run("router-use-routes")).toEqual([routerNotFollowed("src/App.tsx:6")]);
    expect(run("router-elements", reactContext(), ROUTER_ADDON)).toEqual([]);
    expect(run("router-elements")).toEqual([routerNotFollowed("src/router.tsx:5")]);
  });
});

describe("react-context/provider-missing: entry points", () => {
  it("detects hydrateRoot and a createRoot kept in a variable", { timeout: SLOW }, () => {
    expect(run("entry-hydrate")).toEqual([missing("src/main.tsx:4", "Profile", "AuthCtx", reads)]);
    expect(run("entry-root-variable")).toEqual([
      missing("src/main.tsx:5", "Profile", "AuthCtx", reads),
    ]);
  });

  it("says when there is no entry point", () => {
    expect(run("entry-none")).toEqual([
      [
        "info src/contexts.ts:6: stateward found no entry point, so `AuthCtx` is not checked",
        "fix: render your app with `createRoot(…).render(<App/>)`, or list it in `entries` in the react-context options",
      ],
    ]);
  });

  it("lists a component that needs a context and that nothing renders", () => {
    expect(run("unreachable")).toEqual([
      [UNREACHABLE_PROFILE, FIX_UNREACHABLE],
      [
        "info src/Settings.tsx:3: `Settings` needs `AuthCtx`, but no entry point renders it",
        FIX_UNREACHABLE,
      ],
    ]);
  });

  it("takes configured entries, with the contexts provided above them", () => {
    const app = reactContext({
      entries: [{ file: "src/App.tsx", export: "App", provides: ["ThemeCtx"] }],
    });
    expect(run("entry-configured", app)).toEqual([
      missing(
        "src/App.tsx:3",
        "App",
        "AuthCtx",
        "src/App.tsx:4: `<Profile>` is rendered here",
        "src/Profile.tsx:5: `Profile` reads `AuthCtx`",
      ),
      [
        "info src/Page.tsx:3: `Page` needs `AuthCtx` and `ThemeCtx`, but no entry point renders it",
        FIX_UNREACHABLE,
      ],
    ]);
  });

  it("accepts a default export and a leading ./ in a configured entry", () => {
    const both = ["AuthCtx", "ThemeCtx"];
    const plugin = reactContext({
      entries: [
        { file: "src/App.tsx", export: "App", provides: both },
        { file: "./src/Page.tsx", export: "default", provides: both },
      ],
    });
    expect(run("entry-configured", plugin)).toEqual([]);
  });

  it("reports an entry or a provided name that matches nothing, at the first context", () => {
    const plugin = reactContext({
      entries: [
        { file: "src/Nope.tsx", export: "Nope" },
        { file: "src/App.tsx", export: "App", provides: ["Typo"] },
      ],
    });
    const unknowns = run("entry-configured", plugin).filter(([head]) =>
      head?.includes("src/contexts.ts:6"),
    );
    expect(unknowns).toEqual([
      [
        "info src/contexts.ts:6: entry `src/App.tsx#App` provides `Typo`, which is not a required context",
        "fix: check the names in `provides` against your required contexts (made with no default, read through a check)",
      ],
      [
        "info src/contexts.ts:6: entry `src/Nope.tsx#Nope` matches no component",
        "fix: check the file and export name in `entries`",
      ],
    ]);
  });
});

describe("react-context/provider-missing: unknowns", () => {
  it("says it cannot tell which component a computed tag is", () => {
    expect(run("unknown-computed")).toEqual([
      ["info src/Dashboard.tsx:7: stateward cannot tell which component `<Panel>` is", FIX_DYNAMIC],
      [UNREACHABLE_PROFILE, FIX_UNREACHABLE],
    ]);
  });

  it("says where JSX escapes: passed to a call, or kept in a variable used outside JSX", () => {
    const fix = "fix: render it in JSX under the Provider it needs";
    expect(run("unknown-escapes")).toEqual([
      [
        "info src/Dashboard.tsx:5: `<Profile>` is passed to `toast()`, so stateward cannot tell where it renders",
        fix,
      ],
      [
        "info src/Dashboard.tsx:6: `<Profile>` is passed to `stored`, so stateward cannot tell where it renders",
        fix,
      ],
    ]);
  });
});

describe("react-context/provider-missing: unknowns of declarations", () => {
  it("says it does not check an own class component", () => {
    expect(run("unknown-class")).toEqual([
      [
        "info src/main.tsx:8: stateward does not check class components like `<ErrorBoundary>`",
        "fix: render the components that read contexts as function components inside it",
      ],
    ]);
  });

  it("says once per context that one declared outside the checked files is not checked", () => {
    expect(run("external-context")).toEqual([
      [
        "info src/Profile.tsx:5: `AuthCtx` is declared outside the checked files, so its Providers are not checked",
        "fix: add the package that declares it to the tsconfig stateward checks",
      ],
    ]);
  });
});

describe("react-context/provider-missing: React's usual pattern", () => {
  it("treats createContext(undefined) read through a hook that throws as required", () => {
    expect(run("plain-hook-missing")).toEqual([
      missing(
        "src/main.tsx:4",
        "Profile",
        "AuthContext",
        "src/Profile.tsx:4: `useAuth` is called here",
        "src/auth.ts:8: `useAuth` reads `AuthContext`",
      ),
    ]);
  });

  it("counts `<X.Provider>` and React 19's `<X value>` as Providers", () => {
    expect(run("plain-hook-satisfied")).toEqual([]);
  });

  it("counts a component that checks for null and leaves (a return, or a call that never returns)", () => {
    expect(run("plain-component-check")).toEqual([
      missing(
        "src/main.tsx:6",
        "Badge",
        "ThemeContext",
        "src/theme.tsx:9: `Badge` reads `ThemeContext`",
      ),
      missing(
        "src/main.tsx:7",
        "Banner",
        "ThemeContext",
        "src/theme.tsx:20: `Banner` reads `ThemeContext`",
      ),
    ]);
  });

  it("leaves alone a context whose readers do not check its value", () => {
    expect(run("plain-unchecked")).toEqual([]);
  });
});

describe("react-context/provider-missing: engine contract", () => {
  const names = readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it("gives the same findings on every run", { timeout: SLOW }, () => {
    for (const name of names) {
      const first = checkFixture(fixture(name), [reactContext()]).findings;
      const second = checkFixture(fixture(name), [reactContext()]).findings;
      expect(second).toEqual(first);
    }
  });

  it("writes summaries that survive JSON unchanged", { timeout: SLOW }, () => {
    const collected: unknown[] = [];
    const rule: ProjectRule<Summary> = createProviderMissing([]);
    const spy: Plugin = {
      name: "react-context",
      description: "spy",
      rules: {
        "provider-missing": {
          ...rule,
          summarize(ctx) {
            const summary = rule.summarize(ctx);
            if (summary !== undefined) collected.push(summary);
            return summary;
          },
        },
      },
    };
    for (const name of names) checkFixture(fixture(name), [spy]);
    expect(collected.length).toBeGreaterThan(names.length);
    for (const summary of collected) {
      expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
    }
  });

  it("explains the rule with a bad and a good example", () => {
    const rule = ruleCode(reactContext(), "provider-missing");
    expect(rule.kind).toBe("project");
    expect(rule.meta.defaultSeverity).toBe("error");
    expect(rule.meta.explain).toContain("## Bad");
    expect(rule.meta.explain).toContain("## Good");
  });

  it("can be switched off", () => {
    const { findings } = checkFixture(fixture("missing-dashboard"), [reactContext()], {
      "react-context/provider-missing": "off",
    });
    expect(findings).toEqual([]);
  });

  it("reports problems as errors by default", () => {
    const { findings } = checkFixture(fixture("missing-dashboard"), [reactContext()]);
    expect(
      findings.map((finding) => (finding.kind === "problem" ? finding.severity : finding.kind)),
    ).toEqual(["error"]);
  });
});

describe("react-context/provider-missing: dynamic-components add-on", () => {
  const dynamic = (name: string): string[][] => run(name, reactContext(), DYNAMIC_ADDON);

  it.each(["dynamic-map-satisfied", "dynamic-conditional-satisfied"])(
    "reports nothing for %s",
    (name) => {
      expect(dynamic(name)).toEqual([]);
    },
  );

  it("renders every component a map key can select, and names the entry that lacks a Provider", () => {
    expect(dynamic("dynamic-map")).toEqual([
      missing(
        "src/main.tsx:7",
        "Dashboard",
        "ThemeCtx",
        "src/Dashboard.tsx:8: `<Panel>` is rendered here",
        'src/Dashboard.tsx:4: `panels["settings"]` is `<Settings>`',
        "src/Settings.tsx:5: `Settings` reads `ThemeCtx`",
      ),
    ]);
  });

  it("asks for the add-on, and reports what nothing renders, when the add-on is off", () => {
    expect(run("dynamic-map")).toEqual([
      cannotTell("src/Dashboard.tsx:8", "Panel", FIX_DYNAMIC),
      unreachable("src/Profile.tsx:4", "Profile", "AuthCtx"),
      unreachable("src/Settings.tsx:4", "Settings", "ThemeCtx"),
    ]);
  });

  it("selects by the type of the key: a literal union, a number key, a literal at the use", () => {
    expect(dynamic("dynamic-map-literal")).toEqual([
      missing(
        "src/main.tsx:6",
        "Dashboard",
        "AuthCtx",
        "src/Dashboard.tsx:8: `<Panel>` is rendered here",
        'src/Dashboard.tsx:4: `panels["profile"]` is `<Profile>`',
        reads,
      ),
      missing(
        "src/main.tsx:6",
        "Dashboard",
        "ThemeCtx",
        "src/Dashboard.tsx:8: `<Panel>` is rendered here",
        "src/Dashboard.tsx:4: `panels[3]` is `<Settings>`",
        "src/Settings.tsx:5: `Settings` reads `ThemeCtx`",
      ),
      missing(
        "src/main.tsx:7",
        "Account",
        "AuthCtx",
        "src/Dashboard.tsx:13: `<Panel>` is rendered here",
        'src/Dashboard.tsx:4: `panels["profile"]` is `<Profile>`',
        reads,
      ),
    ]);
  });

  it("follows lazy imports, also the named export picked by `.then`, and a condition between them", () => {
    expect(dynamic("dynamic-lazy")).toEqual([
      missing(
        "src/main.tsx:11",
        "SettingsPage",
        "ThemeCtx",
        "src/pages/Settings.tsx:5: `Settings` reads `ThemeCtx`",
      ),
    ]);
  });

  it("follows a lazy import of a named export without the add-on; a condition still asks for it", () => {
    expect(run("dynamic-lazy")).toEqual([
      missing(
        "src/main.tsx:11",
        "SettingsPage",
        "ThemeCtx",
        "src/pages/Settings.tsx:5: `Settings` reads `ThemeCtx`",
      ),
      cannotTell("src/main.tsx:13", "Page", FIX_DYNAMIC),
    ]);
  });

  it("follows a condition between components, naming the branch", () => {
    expect(dynamic("dynamic-conditional")).toEqual([
      missing(
        "src/main.tsx:4",
        "Home",
        "AuthCtx",
        "src/Home.tsx:6: `<Page>` is rendered here",
        "src/Home.tsx:5: `Page` may be `<Profile>`",
        reads,
      ),
    ]);
    expect(run("dynamic-conditional")).toEqual([
      cannotTell("src/Home.tsx:6", "Page", FIX_DYNAMIC),
      unreachable("src/Profile.tsx:4", "Profile", "AuthCtx"),
    ]);
  });

  it("stays unknown for a key of a wide type, with a fix that says what would work", () => {
    expect(dynamic("dynamic-map-wide")).toEqual([
      cannotTell("src/Dashboard.tsx:10", "Other", NARROW),
      cannotTell("src/Dashboard.tsx:10", "Panel", PLAIN),
      unreachable("src/Profile.tsx:4", "Profile", "AuthCtx"),
      unreachable("src/Settings.tsx:4", "Settings", "ThemeCtx"),
    ]);
  });

  it("stays unknown for a dynamic tag that is given children", () => {
    expect(dynamic("dynamic-map-children")).toEqual([
      cannotTell("src/Dashboard.tsx:9", "Frame", PLAIN),
      unreachable("src/Profile.tsx:4", "Profile", "AuthCtx"),
      unreachable("src/Settings.tsx:4", "Settings", "ThemeCtx"),
    ]);
  });

  it("stays unknown for a map with a value that is no component, and for a `let`", () => {
    expect(dynamic("dynamic-other")).toEqual([
      cannotTell("src/Dashboard.tsx:9", "Mutable", PLAIN),
      cannotTell("src/Dashboard.tsx:9", "Panel", NARROW),
      unreachable("src/Profile.tsx:4", "Profile", "AuthCtx"),
    ]);
  });
});
