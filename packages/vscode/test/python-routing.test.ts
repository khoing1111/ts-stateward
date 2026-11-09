import path from "node:path";
import { describe, expect, it } from "vitest";
import { qualifyPythonFolder } from "../src/python-folders.js";
import { noServerMessage, pythonFolderOf, routeFor } from "../src/routing.js";

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
  const running = { running: true, project: true };
  const pythonOnly = { running: false, project: false };
  const app = path.resolve("/work/app");
  const lib = path.resolve("/work/app/lib");
  const web = path.resolve("/work/web");
  const file = (...parts: string[]): string => path.join(...parts);

  it("sends a Python document to the server of its folder, the deepest one holding it", () => {
    expect(pythonFolderOf(file(lib, "a.py"), [app, lib])).toBe(lib);
    expect(
      routeFor({ fsPath: file(app, "main.py"), languageId: "python" }, [app, lib], running),
    ).toEqual({ kind: "python", folder: app });
    expect(
      routeFor({ fsPath: file(lib, "x", "a.py"), languageId: "python" }, [lib, app], running),
    ).toEqual({ kind: "python", folder: lib });
  });

  it("sends TypeScript, and Python outside every Python folder, to the TypeScript server", () => {
    expect(
      routeFor({ fsPath: file(app, "ui.tsx"), languageId: "typescriptreact" }, [app], running),
    ).toEqual({ kind: "typescript" });
    expect(
      routeFor({ fsPath: file(web, "tool.py"), languageId: "python" }, [app], running),
    ).toEqual({
      kind: "typescript",
    });
    expect(routeFor(undefined, [app], running)).toEqual({ kind: "typescript" });
  });

  it("without a TypeScript server, falls back to the first Python folder, or to none", () => {
    expect(routeFor(undefined, [web, app], pythonOnly)).toEqual({ kind: "python", folder: app });
    expect(
      routeFor({ fsPath: file(app, "README.md"), languageId: "markdown" }, [], pythonOnly),
    ).toBe(undefined);
  });

  it("never sends a command in a TypeScript project to a Python server", () => {
    const stopped = { running: false, project: true };
    // The workspace has a stateward config: no file, a Markdown file or a TypeScript file.
    expect(routeFor(undefined, [app], stopped)).toBe(undefined);
    expect(
      routeFor({ fsPath: file(app, "README.md"), languageId: "markdown" }, [app], stopped),
    ).toBe(undefined);
    expect(
      routeFor({ fsPath: file(app, "ui.tsx"), languageId: "typescriptreact" }, [app], stopped),
    ).toBe(undefined);
    // No config, but the active file is TypeScript or JavaScript.
    for (const languageId of ["typescript", "typescriptreact", "javascript", "javascriptreact"]) {
      expect(routeFor({ fsPath: file(web, "a.ts"), languageId }, [app], pythonOnly)).toBe(
        undefined,
      );
    }
    // A Python document in a Python folder still goes to its server.
    expect(
      routeFor({ fsPath: file(app, "main.py"), languageId: "python" }, [app], stopped),
    ).toEqual({ kind: "python", folder: app });
  });

  it("does not take a sibling folder sharing a prefix for a parent", () => {
    expect(pythonFolderOf(file(`${app}-old`, "a.py"), [app])).toBe(undefined);
  });
});

describe("noServerMessage", () => {
  it("says the folder has no config, or why the TypeScript server is not running", () => {
    expect(noServerMessage(false, undefined)).toBe(
      'Stateward is not checking this folder: it has no stateward config. Run "Stateward: Set up the project".',
    );
    expect(noServerMessage(true, "Cannot find module '/old/bin.js'")).toBe(
      "Stateward's TypeScript server is not running: Cannot find module '/old/bin.js'. See View › Output › Stateward.",
    );
    // The reason's own final period is not doubled.
    expect(noServerMessage(true, "the server stopped.")).toBe(
      "Stateward's TypeScript server is not running: the server stopped. See View › Output › Stateward.",
    );
    expect(noServerMessage(true, undefined)).toBe(
      "Stateward's TypeScript server is not running yet. Try again in a moment, or see View › Output › Stateward.",
    );
  });
});
