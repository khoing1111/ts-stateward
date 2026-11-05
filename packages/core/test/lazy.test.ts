import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Config, Plugin, Rule, RuleInfo } from "../src/internal.js";
import {
  RuleDeclarationError,
  RuleLoadError,
  RuleNotLoadedError,
  check,
  explain,
  lazyRule,
  loadConfigFile,
  loadRules,
  moduleLoader,
  parseConfig,
} from "../src/internal.js";
import { fixturePath } from "./fixture-path.js";
import { callProbe, meta } from "./probe-plugin.js";

const probeDir = fixturePath("probe");
/** The probe rule's metadata without its explain text: what a pack declares up front. */
const info: RuleInfo = {
  description: meta.description,
  defaultSeverity: meta.defaultSeverity,
  tier: meta.tier,
  group: meta.group,
};

/** A module loader that counts its imports and can fail the first `failures` of them. */
function counted(rule: Rule, failures = 0) {
  let imports = 0;
  const loader = moduleLoader(() => {
    imports += 1;
    return imports <= failures
      ? Promise.reject(new Error("Cannot find module './gone.js'"))
      : Promise.resolve({ rule });
  });
  return { loader, imports: () => imports };
}

/** A pack with two lazy rules, `on` (a core rule) and `extra` (an add-on rule, off by default). */
function pack(rule: Rule = callProbe) {
  const on = counted(rule);
  const extra = counted(rule);
  const plugin: Plugin = {
    name: "probe",
    description: "probe plugin",
    rules: {
      on: lazyRule({ kind: "file", meta: info }, on.loader, (module) => module.rule),
      extra: lazyRule(
        { kind: "file", meta: { ...info, tier: "addon", addon: "extras" } },
        extra.loader,
        (module) => ({
          ...module.rule,
          meta: { ...module.rule.meta, tier: "addon", addon: "extras" },
        }),
      ),
    },
  };
  return { plugin, on, extra };
}

function configOf(plugin: Plugin, settings: Record<string, unknown> = {}): Config {
  const parsed = parseConfig({ preset: "recommended", plugins: [plugin], ...settings }, probeDir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
}

describe("lazy rules", () => {
  it("loads a rule that is on and never one that is off", async () => {
    const { plugin, on, extra } = pack();
    const config = configOf(plugin);
    await loadRules(config);
    expect(on.imports()).toBe(1);
    expect(extra.imports()).toBe(0);
    const { findings } = check({ config, cwd: probeDir });
    expect(findings.some((finding) => finding.ruleId === "probe/on")).toBe(true);
  });

  it("loads a rule an override turns on in some folder", async () => {
    const { plugin, extra } = pack();
    await loadRules(
      configOf(plugin, { overrides: [{ files: ["src/**"], addons: ["probe/extras"] }] }),
    );
    expect(extra.imports()).toBe(1);
  });

  it("imports a module once, for every instance of the pack that shares its loader", async () => {
    const { plugin, on } = pack();
    await loadRules(configOf(plugin));
    await loadRules(configOf(plugin));
    expect(on.imports()).toBe(1);
  });

  it("refuses to check with a rule that is on but not loaded: a bug of the caller", () => {
    const { plugin } = pack();
    expect(() => check({ config: configOf(plugin), cwd: probeDir })).toThrow(RuleNotLoadedError);
  });

  it("says which rule could not be loaded, and tries again on the next load", async () => {
    const loader = counted(callProbe, 2);
    const plugin: Plugin = {
      name: "probe",
      description: "probe plugin",
      rules: { on: lazyRule({ kind: "file", meta: info }, loader.loader, (module) => module.rule) },
    };
    const config = configOf(plugin);
    await expect(loadRules(config)).rejects.toThrow(RuleLoadError);
    await expect(loadRules(config)).rejects.toThrow(
      "probe/on: its code could not be loaded: Cannot find module './gone.js'",
    );
    await loadRules(config);
    expect(loader.imports()).toBe(3);
  });

  it("refuses a module whose rule says other than the pack declared", async () => {
    const { plugin } = pack({ ...callProbe, meta: { ...meta, group: "elsewhere" } });
    await expect(loadRules(configOf(plugin))).rejects.toThrow(
      new RuleDeclarationError("probe/on", "meta.group"),
    );
  });

  it("loads a rule's module for its explain text, even when the rule is off", async () => {
    const { plugin, extra } = pack();
    expect(await explain(configOf(plugin), "probe/extra")).toBe("probe explain");
    expect(extra.imports()).toBe(1);
  });
});

describe("loadConfigFile with lazy rules", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("reports a rule module that fails to load as a config error", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "stateward-lazy-"));
    const core = pathToFileURL(path.resolve("packages/core/src/index.ts")).href;
    writeFileSync(
      path.join(dir, "stateward.config.ts"),
      [
        `import { defineConfig, lazyRule, moduleLoader } from ${JSON.stringify(core)};`,
        "const meta = { description: 'd', defaultSeverity: 'warning', tier: 'core', group: 'g' } as const;",
        "export default defineConfig({",
        "  preset: 'recommended',",
        "  plugins: [{ name: 'p', description: 'p', rules: {",
        "    r: lazyRule({ kind: 'file', meta }, moduleLoader(() => import('./gone.js')), (m) => m.rule),",
        "  } }],",
        "});",
      ].join("\n"),
    );
    const loaded = await loadConfigFile(path.join(dir, "stateward.config.ts"));
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.errors).toHaveLength(1);
      expect(loaded.errors[0]).toContain("p/r: its code could not be loaded");
    }
  });
});
