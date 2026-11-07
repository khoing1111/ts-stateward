import { describe, expect, it } from "vitest";
import {
  checkPythonVersion,
  locatePythonServer,
  missingServerMessage,
  parsePythonVersion,
  pythonServerArgs,
} from "../src/python-server.js";

function existing(...files: string[]): (file: string) => boolean {
  const set = new Set(files);
  return (file) => set.has(file);
}

describe("locatePythonServer", () => {
  const posix = { folder: "/work/app", configured: "", platform: "linux" as const };

  it("prefers stateward.python.serverPath when that file exists", () => {
    expect(
      locatePythonServer({
        ...posix,
        configured: "/builds/py-stateward",
        pathVariable: "/usr/bin",
        exists: existing("/builds/py-stateward", "/work/app/.venv/bin/py-stateward"),
      }),
    ).toEqual({ kind: "configured", command: "/builds/py-stateward" });
  });

  it("ignores a serverPath that does not exist and uses the project's .venv", () => {
    expect(
      locatePythonServer({
        ...posix,
        configured: "/nowhere/py-stateward",
        pathVariable: "/usr/bin",
        exists: existing("/work/app/.venv/bin/py-stateward", "/usr/bin/py-stateward"),
      }),
    ).toEqual({ kind: "environment", command: "/work/app/.venv/bin/py-stateward" });
  });

  it("looks in venv after .venv, and at PATH last", () => {
    expect(
      locatePythonServer({
        ...posix,
        pathVariable: "/usr/bin",
        exists: existing("/work/app/venv/bin/py-stateward", "/usr/bin/py-stateward"),
      }),
    ).toEqual({ kind: "environment", command: "/work/app/venv/bin/py-stateward" });
    expect(
      locatePythonServer({
        ...posix,
        pathVariable: "/opt/none::/usr/local/tools/bin",
        exists: existing("/usr/local/tools/bin/py-stateward"),
      }),
    ).toEqual({ kind: "path", command: "/usr/local/tools/bin/py-stateward" });
  });

  it("finds nothing when no place has it, or PATH is unset", () => {
    expect(locatePythonServer({ ...posix, pathVariable: undefined, exists: () => false })).toBe(
      undefined,
    );
  });

  it("reads a Windows environment's Scripts folder and a Windows PATH", () => {
    const windows = { folder: "C:\\work\\app", configured: "", platform: "win32" as const };
    expect(
      locatePythonServer({
        ...windows,
        pathVariable: "C:\\Python\\Scripts",
        exists: existing("C:\\work\\app\\.venv\\Scripts\\py-stateward.exe"),
      }),
    ).toEqual({ kind: "environment", command: "C:\\work\\app\\.venv\\Scripts\\py-stateward.exe" });
    expect(
      locatePythonServer({
        ...windows,
        pathVariable: "C:\\Windows;C:\\Users\\me\\.local\\bin",
        exists: existing("C:\\Users\\me\\.local\\bin\\py-stateward.exe"),
      }),
    ).toEqual({ kind: "path", command: "C:\\Users\\me\\.local\\bin\\py-stateward.exe" });
  });
});

describe("pythonServerArgs", () => {
  it("passes the checker processes always, and Pyrefly only when set", () => {
    expect(pythonServerArgs({ pyrefly: "", checkerProcesses: 1 })).toEqual([
      "server",
      "--checker-processes",
      "1",
    ]);
    expect(pythonServerArgs({ pyrefly: "/bin/pyrefly", checkerProcesses: 3 })).toEqual([
      "server",
      "--pyrefly",
      "/bin/pyrefly",
      "--checker-processes",
      "3",
    ]);
  });

  it("keeps the processes a whole number of at least one", () => {
    expect(pythonServerArgs({ pyrefly: "", checkerProcesses: 0 })).toContain("1");
    expect(pythonServerArgs({ pyrefly: "", checkerProcesses: 2.7 })).toContain("2");
  });
});

describe("the py-stateward version", () => {
  it("reads PyPI's spelling", () => {
    expect(parsePythonVersion("0.1.0a6")).toEqual({ release: [0, 1, 0], pre: [0, 6] });
    expect(parsePythonVersion("1.0.0")).toEqual({ release: [1, 0, 0], pre: undefined });
    expect(parsePythonVersion("next")).toBe(undefined);
  });

  it("accepts 0.1.0a6 and later, pre-releases before their release", () => {
    expect(checkPythonVersion("py-stateward 0.1.0a6\n")).toEqual({
      kind: "ok",
      version: "0.1.0a6",
    });
    expect(checkPythonVersion("py-stateward 0.1.0b1")).toEqual({ kind: "ok", version: "0.1.0b1" });
    expect(checkPythonVersion("py-stateward 0.1.0rc2")).toEqual({
      kind: "ok",
      version: "0.1.0rc2",
    });
    expect(checkPythonVersion("py-stateward 0.1.0")).toEqual({ kind: "ok", version: "0.1.0" });
    expect(checkPythonVersion("py-stateward 0.2")).toEqual({ kind: "ok", version: "0.2" });
    expect(checkPythonVersion("py-stateward 0.1.0a5")).toEqual({
      kind: "too-old",
      version: "0.1.0a5",
    });
    expect(checkPythonVersion("py-stateward 0.0.9")).toEqual({ kind: "too-old", version: "0.0.9" });
    expect(checkPythonVersion("something else")).toEqual({
      kind: "unreadable",
      output: "something else",
    });
  });

  it("says how to install it, once, naming the folder", () => {
    expect(missingServerMessage("app", { kind: "missing" })).toBe(
      'Stateward could not find py-stateward for app. Install it in the project (`uv add --dev py-stateward` or `pip install py-stateward`), then run "Stateward: Restart Python server".',
    );
    expect(missingServerMessage("app", { kind: "too-old", version: "0.1.0a2" })).toContain(
      "needs py-stateward 0.1.0a6 or later for app; it found 0.1.0a2.",
    );
  });
});
