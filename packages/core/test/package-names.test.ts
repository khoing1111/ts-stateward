import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  packageDependencies,
  packageEntries,
  packageManifests,
  packageNames,
  parentFolder,
} from "../src/backend/fingerprints.js";

let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "stateward-package-names-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, text: string): string {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file.replaceAll("\\", "/");
}

const packageOf = () => packageNames(ts.createCompilerHost({}));

describe("packageOf: the package a file belongs to", () => {
  it("is the name of the package that contains the file, wherever it is installed", () => {
    write("node_modules/@acme/values/package.json", '{"name":"@acme/values"}');
    const file = write("node_modules/@acme/values/dist/index.d.ts", "");
    expect(packageOf()(file)).toBe("@acme/values");
  });

  it("looks past package.json files that have no name or are not JSON", () => {
    write("lib/package.json", '{"name":"@acme/values"}');
    write("lib/dist/package.json", '{"type":"module"}');
    write("lib/broken/package.json", "{");
    expect(packageOf()(write("lib/dist/index.d.ts", ""))).toBe("@acme/values");
    expect(packageOf()(write("lib/broken/index.d.ts", ""))).toBe("@acme/values");
  });

  it("is another package's name, or none outside any package", () => {
    write("app/package.json", '{"name":"app"}');
    expect(packageOf()(write("app/src/money.ts", ""))).toBe("app");
    expect(packageOf()(path.posix.join("/", "stateward-no-package", "a.ts"))).toBeUndefined();
  });
});

describe("packageManifests: the hash of a file's package.json", () => {
  it("changes with the manifest (a new version), not with the file", () => {
    write("node_modules/zod/package.json", '{"name":"zod","version":"3.23.8"}');
    const file = write("node_modules/zod/lib/index.d.ts", "");
    const before = packageManifests(ts.createCompilerHost({}))(file);
    write("node_modules/zod/lib/index.d.ts", "export {};");
    expect(packageManifests(ts.createCompilerHost({}))(file)).toBe(before);
    write("node_modules/zod/package.json", '{"name":"zod","version":"3.24.0"}');
    expect(packageManifests(ts.createCompilerHost({}))(file)).not.toBe(before);
    expect(before).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("walking up for package.json at a root", () => {
  /** A host whose only files are the given ones: `./package.json` (the cwd's) exists too. */
  const hostWith = (files: Record<string, string>): ts.CompilerHost => ({
    ...ts.createCompilerHost({}),
    fileExists: (file) => file === "./package.json" || file in files,
    readFile: (file) => (file === "./package.json" ? '{"name":"cwd-package"}' : files[file]),
  });

  it("stops at a drive root and never reads the working directory's package.json", () => {
    const host = hostWith({});
    for (const file of ["C:/a/b/file.ts", "C:/file.ts", "c:\\a\\file.ts"]) {
      expect(packageNames(host)(file)).toBeUndefined();
      expect(packageManifests(host)(file)).toBeUndefined();
      expect(packageEntries(host)(file)).toBe(false);
      expect(packageDependencies(host)(file)).toEqual([]);
    }
  });

  it("finds a package at a drive root or above a file on a drive", () => {
    const host = hostWith({
      "C:/package.json": '{"name":"at-root"}',
      "D:/app/package.json": '{"name":"app"}',
    });
    expect(packageNames(host)("C:/a/b/file.ts")).toBe("at-root");
    expect(packageNames(host)("D:\\app\\src\\file.ts")).toBe("app");
  });

  it("stops at a UNC share and at a posix root", () => {
    const host = hostWith({});
    expect(packageNames(host)("//server/share/a/file.ts")).toBeUndefined();
    expect(packageNames(host)("/a/b/file.ts")).toBeUndefined();
  });

  it("never returns a relative parent", () => {
    for (const folder of ["C:", "C:/", "//server/share", "/", "a", "."]) {
      expect(parentFolder(folder)?.startsWith(".")).not.toBe(true);
    }
    expect(parentFolder("C:/a")).toBe("C:");
    expect(parentFolder("C:")).toBeUndefined();
    expect(parentFolder("//server/share/a")).toBe("//server/share");
    expect(parentFolder("//server/share")).toBeUndefined();
  });
});
