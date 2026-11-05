import { describe, expect, it } from "vitest";
import { classifyChange, createErrorGate, isImportableJson } from "../src/watch.js";

describe("classifyChange", () => {
  it("tells a config change from a source change", () => {
    expect(classifyChange("/work/app/stateward.config.ts")).toBe("config");
    expect(classifyChange("/work/app/stateward.config.mjs")).toBe("config");
    expect(classifyChange("/work/app/src/a.ts")).toBe("source");
    expect(classifyChange("/work/app/tsconfig.json")).toBe("source");
    // The rollout file changes which rules run (`stateward next` in a terminal): a re-check.
    expect(classifyChange("/work/app/stateward.rollout.json")).toBe("source");
    // A nested config has its own engine: its change reloads that one.
    expect(classifyChange("/work/app/packages/x/stateward.config.ts")).toBe("config");
  });

  it("tells a change to a local file a config imports, and ignores JavaScript no config imports", () => {
    const imports = new Set(["/work/app/team.mjs", "/work/app/rules/shared.ts"]);
    expect(classifyChange("/work/app/team.mjs", imports)).toBe("config-import");
    expect(classifyChange("/work/app/rules/shared.ts", imports)).toBe("config-import");
    expect(classifyChange("/work/app/dist/index.js", imports)).toBe("ignored");
    expect(classifyChange("/work/app/src/a.ts", imports)).toBe("source");
  });

  it("ignores node_modules, even a config inside it", () => {
    expect(classifyChange("/work/app/node_modules/pkg/index.ts")).toBe("ignored");
    expect(classifyChange("/work/app/node_modules/stateward.config.ts")).toBe("ignored");
  });
});

describe("classifyChange for JSON files", () => {
  it("counts an imported JSON file as a source change", () => {
    expect(classifyChange("/work/app/src/data.json")).toBe("source");
    expect(classifyChange("/work/app/stateward.baseline.json")).toBe("source");
    expect(classifyChange("/work/app/tsconfig.app.json")).toBe("source");
  });

  it("ignores package.json, the lockfile and anything in node_modules", () => {
    expect(classifyChange("/work/app/package.json")).toBe("ignored");
    expect(classifyChange("/work/app/packages/x/package-lock.json")).toBe("ignored");
    expect(classifyChange("/work/app/node_modules/pkg/data.json")).toBe("ignored");
  });
});

describe("isImportableJson", () => {
  it("is true for JSON a program may import, false for configuration and manifests", () => {
    expect(isImportableJson("/work/app/src/data.json")).toBe(true);
    expect(isImportableJson("/work/app/src/data.ts")).toBe(false);
    expect(isImportableJson("/work/app/package.json")).toBe(false);
    expect(isImportableJson("/work/app/tsconfig.json")).toBe(false);
    expect(isImportableJson("/work/app/stateward.rollout.json")).toBe(false);
    expect(isImportableJson("/work/app/node_modules/pkg/data.json")).toBe(false);
  });
});

describe("createErrorGate", () => {
  it("shows an error once, a different one at once, and the first again after a recovery", () => {
    const gate = createErrorGate();
    expect(gate.shouldShow("a")).toBe(true);
    expect(gate.shouldShow("a")).toBe(false);
    expect(gate.shouldShow("b")).toBe(true);
    gate.recovered();
    expect(gate.shouldShow("b")).toBe(true);
  });
});
