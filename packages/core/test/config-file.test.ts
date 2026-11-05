import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findConfigFile, loadConfig } from "../src/internal.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("fails with a clear message when there is no config file", async () => {
    const result = await loadConfig(dir);
    expect(result).toEqual({
      ok: false,
      errors: [
        `no stateward.config.{ts,mts,js,mjs} found in ${dir}\n  = fix: run \`npx stateward init\` in your project's folder to create one (or \`--cwd <dir>\` to name the folder)`,
      ],
    });
    expect(findConfigFile(dir)).toBeUndefined();
  });

  it("loads a TypeScript config and validates it", async () => {
    const file = path.join(dir, "stateward.config.ts");
    const source = [
      "type P = { name: string; description: string; rules: Record<string, never> };",
      "const plugin: P = { name: 'p', description: 'd', rules: {} };",
      "export default { plugins: [plugin], include: ['src/**'] };",
    ].join("\n");
    writeFileSync(file, source);
    const result = await loadConfig(dir);
    expect(result).toMatchObject({
      ok: true,
      value: { configFile: file, tsconfig: [path.join(dir, "tsconfig.json")], include: ["src/**"] },
    });
    expect(findConfigFile(dir)).toBe(file);
  });

  it("loads a plain .mjs config", async () => {
    writeFileSync(path.join(dir, "stateward.config.mjs"), "export default { plugins: [] };\n");
    expect(await loadConfig(dir)).toMatchObject({ ok: true, value: { plugins: [] } });
  });

  it.each(["mjs", "js", "ts"])(
    "reloads an edited .%s config instead of a cached one",
    async (ext) => {
      const file = path.join(dir, `stateward.config.${ext}`);
      writeFileSync(file, "export default { plugins: [], include: ['first/**'] };\n");
      expect(await loadConfig(dir)).toMatchObject({ ok: true, value: { include: ["first/**"] } });
      writeFileSync(file, "export default { plugins: [], include: ['second/**'] };\n");
      expect(await loadConfig(dir)).toMatchObject({ ok: true, value: { include: ["second/**"] } });
    },
  );

  it("reads the new text of the local JavaScript files a config imports when it loads again", async () => {
    // What the language server does after `team.mjs` (or a file it imports) is saved.
    writeFileSync(
      path.join(dir, "stateward.config.ts"),
      'import { include } from "./team.mjs";\nimport { tsconfig } from "./shared.cjs";\nexport default { plugins: [], include, tsconfig };\n',
    );
    writeFileSync(path.join(dir, "team.mjs"), 'export { include } from "./paths.mjs";\n');
    writeFileSync(path.join(dir, "paths.mjs"), 'export const include = ["a/**"];\n');
    writeFileSync(path.join(dir, "shared.cjs"), 'exports.tsconfig = "a.json";\n');
    const first = await loadConfig(dir);
    expect(first.ok && [first.value.include, first.value.tsconfig]).toEqual([
      ["a/**"],
      [path.join(dir, "a.json")],
    ]);
    writeFileSync(path.join(dir, "paths.mjs"), 'export const include = ["b/**"];\n');
    writeFileSync(path.join(dir, "shared.cjs"), 'exports.tsconfig = "b.json";\n');
    const second = await loadConfig(dir);
    expect(second.ok && [second.value.include, second.value.tsconfig]).toEqual([
      ["b/**"],
      [path.join(dir, "b.json")],
    ]);
  });

  it("prefixes validation errors with the config file", async () => {
    const file = path.join(dir, "stateward.config.mjs");
    writeFileSync(file, "export default { plugins: 1 };\n");
    expect(await loadConfig(dir)).toEqual({
      ok: false,
      errors: [`${file}: plugins must be an array`],
    });
  });

  it("says to export the config when the module has no default export", async () => {
    writeFileSync(path.join(dir, "stateward.config.mjs"), "export const plugins = [];\n");
    expect(await loadConfig(dir)).toEqual({
      ok: false,
      errors: ["stateward.config.mjs must export the config: export default defineConfig({ ... })"],
    });
  });

  it("says the same when the default export is not an object", async () => {
    writeFileSync(path.join(dir, "stateward.config.ts"), "export default 5;\n");
    expect(await loadConfig(dir)).toEqual({
      ok: false,
      errors: ["stateward.config.ts must export the config: export default defineConfig({ ... })"],
    });
  });

  it("reports a config that throws while loading", async () => {
    const file = path.join(dir, "stateward.config.mjs");
    writeFileSync(file, "throw new Error('bad config');\n");
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toContain(`could not load ${file}`);
    expect(!result.ok && result.errors[0]).toContain("bad config");
  });

  it("names a package the config imports that is not installed, and how to install it", async () => {
    const file = path.join(dir, "stateward.config.mjs");
    writeFileSync(file, "import { nope } from '@stateward/plugin-nope';\nexport default nope;\n");
    const result = await loadConfig(dir);
    expect(result).toEqual({
      ok: false,
      errors: [
        `could not load ${file}: it imports "@stateward/plugin-nope", which is not installed in this project\n  = fix: install it (for example \`npm install --save-dev @stateward/plugin-nope\`), or remove it from the config`,
      ],
    });
  });

  it("says a syntax error is one, with its place and what to do", async () => {
    const file = path.join(dir, "stateward.config.ts");
    writeFileSync(file, "export default {{{\n");
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    const message = !result.ok ? (result.errors[0] ?? "") : "";
    expect(message.startsWith(`could not load ${file}: syntax error at line:column `)).toBe(true);
    expect(message).not.toContain("ParseError");
    expect(message.split("\n").at(-1)).toBe(
      "  = fix: correct the syntax in the config, then run the command again",
    );
  });
});
