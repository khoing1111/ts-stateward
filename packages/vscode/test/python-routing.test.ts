import path from "node:path";
import { describe, expect, it } from "vitest";
import { qualifyPythonFolder } from "../src/python-folders.js";
import { pythonFolderOf, routeFor } from "../src/routing.js";

describe("qualifyPythonFolder", () => {
  it("serves a folder whose pyproject.toml has a [tool.stateward] table", () => {
    expect(
      qualifyPythonFolder({
        pyproject: '[project]\nname = "app"\n\n[tool.stateward]\npreset = "recommended"\n',
        enabled: false,
      }),
    ).toEqual({ kind: "serve", reason: "table" });
    // An empty table counts, and so does a dotted key that makes one.
    expect(qualifyPythonFolder({ pyproject: "[tool.stateward]\n", enabled: false }).kind).toBe(
      "serve",
    );
    expect(
      qualifyPythonFolder({ pyproject: 'tool.stateward.preset = "recommended"\n', enabled: false })
        .kind,
    ).toBe("serve");
  });

  it("does not serve one that only mentions it in a comment or a string", () => {
    expect(
      qualifyPythonFolder({
        pyproject:
          '# [tool.stateward] later\n[project]\ndescription = "[tool.stateward]"\n[tool.ruff]\n',
        enabled: false,
      }),
    ).toEqual({ kind: "skip" });
    expect(qualifyPythonFolder({ pyproject: undefined, enabled: false })).toEqual({ kind: "skip" });
  });

  it("serves any folder when stateward.python.enabled is on", () => {
    expect(qualifyPythonFolder({ pyproject: undefined, enabled: true })).toEqual({
      kind: "serve",
      reason: "setting",
    });
  });

  it("says when pyproject.toml is not valid TOML", () => {
    expect(qualifyPythonFolder({ pyproject: "[tool.stateward\n", enabled: false }).kind).toBe(
      "unreadable",
    );
  });
});

describe("routeFor", () => {
  const app = path.resolve("/work/app");
  const lib = path.resolve("/work/app/lib");
  const web = path.resolve("/work/web");
  const file = (...parts: string[]): string => path.join(...parts);

  it("sends a Python document to the server of its folder, the deepest one holding it", () => {
    expect(pythonFolderOf(file(lib, "a.py"), [app, lib])).toBe(lib);
    expect(
      routeFor({ fsPath: file(app, "main.py"), languageId: "python" }, [app, lib], true),
    ).toEqual({ kind: "python", folder: app });
    expect(
      routeFor({ fsPath: file(lib, "x", "a.py"), languageId: "python" }, [lib, app], true),
    ).toEqual({ kind: "python", folder: lib });
  });

  it("sends TypeScript, and Python outside every Python folder, to the TypeScript server", () => {
    expect(
      routeFor({ fsPath: file(app, "ui.tsx"), languageId: "typescriptreact" }, [app], true),
    ).toEqual({ kind: "typescript" });
    expect(routeFor({ fsPath: file(web, "tool.py"), languageId: "python" }, [app], true)).toEqual({
      kind: "typescript",
    });
    expect(routeFor(undefined, [app], true)).toEqual({ kind: "typescript" });
  });

  it("without a TypeScript server, falls back to the first Python folder, or to none", () => {
    expect(routeFor(undefined, [web, app], false)).toEqual({ kind: "python", folder: app });
    expect(routeFor({ fsPath: file(app, "README.md"), languageId: "markdown" }, [], false)).toBe(
      undefined,
    );
  });

  it("does not take a sibling folder sharing a prefix for a parent", () => {
    expect(pythonFolderOf(file(`${app}-old`, "a.py"), [app])).toBe(undefined);
  });
});
