import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeImplementationId, implementationId } from "../src/implementation.js";

let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "stateward-implementation-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, text: string): string {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/** An app with a plugin package in node_modules and a local rule file with a helper. */
function app(): string {
  write("app/package.json", '{"name":"app","version":"1.0.0"}');
  write("app/node_modules/team-plugin/package.json", '{"name":"team-plugin","version":"0.0.0"}');
  write("app/node_modules/team-plugin/dist/index.js", 'export { message } from "./message.js";');
  write("app/node_modules/team-plugin/dist/message.js", 'export const message = "old";');
  write("app/node_modules/team-plugin/src/notes.md", "not code");
  write("app/rules/team.mjs", 'import { LIMIT } from "./helper.mjs";\nexport const team = LIMIT;');
  write("app/rules/helper.mjs", "export const LIMIT = 3;");
  return write(
    "app/stateward.config.mjs",
    [
      'import path from "node:path";',
      'import { message } from "team-plugin";',
      'import { team } from "./rules/team.mjs";',
      "export default { plugins: [], message, team, path };",
    ].join("\n"),
  );
}

describe("the implementation id", () => {
  it("changes with a helper of a plugin package, though the package's version does not", () => {
    const config = app();
    const before = computeImplementationId(config);
    expect(computeImplementationId(config)).toBe(before);
    write("app/node_modules/team-plugin/dist/message.js", 'export const message = "new";');
    expect(computeImplementationId(config)).not.toBe(before);
  });

  it("changes with a package's version, and not with a file that is not JavaScript", () => {
    const config = app();
    const before = computeImplementationId(config);
    write("app/node_modules/team-plugin/src/notes.md", "edited");
    expect(computeImplementationId(config)).toBe(before);
    write("app/node_modules/team-plugin/package.json", '{"name":"team-plugin","version":"0.0.1"}');
    expect(computeImplementationId(config)).not.toBe(before);
  });

  it("follows a local rule file to the local files it imports", () => {
    const config = app();
    const before = computeImplementationId(config);
    write("app/rules/helper.mjs", "export const LIMIT = 4;");
    expect(computeImplementationId(config)).not.toBe(before);
  });

  it("hashes a plugin imported by an absolute path as its whole package", () => {
    write("clone/packages/plugin/package.json", '{"name":"@x/plugin","version":"0.0.0"}');
    write("clone/packages/plugin/dist/index.js", 'export * from "./rule.js";');
    write("clone/packages/plugin/dist/rule.js", "export const n = 1;");
    write("app/package.json", '{"name":"app"}');
    const config = write(
      "app/stateward.config.mjs",
      `import { n } from ${JSON.stringify(path.join(root, "clone/packages/plugin/dist/index.js"))};\nexport default { n };`,
    );
    const before = computeImplementationId(config);
    write("clone/packages/plugin/dist/rule.js", "export const n = 2;");
    expect(computeImplementationId(config)).not.toBe(before);
  });

  it("is computed once per config file in a process", () => {
    const config = app();
    const first = implementationId(config);
    write("app/rules/helper.mjs", "export const LIMIT = 5;");
    expect(implementationId(config)).toBe(first);
  });

  it("changes with a shared config the config extends, a local file or a package", () => {
    write("app/package.json", '{"name":"app","version":"1.0.0"}');
    write("app/team/config.mjs", "export default { rules: { a: 'error' } };");
    write(
      "app/node_modules/@acme/config/package.json",
      '{"name":"@acme/config","version":"1.0.0"}',
    );
    write(
      "app/node_modules/@acme/config/dist/index.js",
      "export default { rules: { b: 'error' } };",
    );
    const config = write(
      "app/stateward.config.mjs",
      [
        'import team from "./team/config.mjs";',
        'import shared from "@acme/config";',
        "export default { extends: [team, shared], plugins: [] };",
      ].join("\n"),
    );
    const before = computeImplementationId(config);
    write("app/team/config.mjs", "export default { rules: { a: 'warning' } };");
    const local = computeImplementationId(config);
    expect(local).not.toBe(before);
    write("app/node_modules/@acme/config/dist/index.js", "export default { rules: { b: 'off' } };");
    expect(computeImplementationId(config)).not.toBe(local);
  });
});
