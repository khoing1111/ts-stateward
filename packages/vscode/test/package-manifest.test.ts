import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "../src/quick-pick.js";
import { STATUS_COMMAND } from "../src/status.js";
import { CONFIG_FILE_NAMES } from "../src/workspace-config.js";

const manifest: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);

describe("the extension manifest", () => {
  it("activates in a workspace with a stateward config at any depth (a package two levels down too), or a root tsconfig (only to offer setup)", () => {
    const events =
      typeof manifest === "object" && manifest !== null && "activationEvents" in manifest
        ? manifest.activationEvents
        : undefined;
    expect(events).toEqual([
      "workspaceContains:**/stateward.config.ts",
      "workspaceContains:**/stateward.config.mts",
      "workspaceContains:**/stateward.config.js",
      "workspaceContains:**/stateward.config.mjs",
      "workspaceContains:tsconfig.json",
    ]);
    expect(Array.isArray(events) ? events.slice(0, -1) : events).toEqual(
      CONFIG_FILE_NAMES.map((name) => `workspaceContains:**/${name}`),
    );
  });

  it("covers a config two levels below the opened folder", () => {
    const events =
      typeof manifest === "object" && manifest !== null && "activationEvents" in manifest
        ? manifest.activationEvents
        : undefined;
    // VS Code reads `workspaceContains:` as a glob from the folder root: only a leading `**/`
    // reaches a nested config. Each stateward event is `**/<file name>`.
    const covers = (pattern: string, file: string): boolean => {
      const name = pattern.replace(/^workspaceContains:\*\*\//, "");
      return (
        pattern.startsWith("workspaceContains:**/") && (file === name || file.endsWith(`/${name}`))
      );
    };
    const nested = ["packages/app/stateward.config.ts", "app/web/stateward.config.mjs"];
    for (const file of nested) {
      expect(Array.isArray(events) && events.some((event) => covers(String(event), file))).toBe(
        true,
      );
    }
  });

  it("lists every palette command the extension registers, and hides the status bar's menu", () => {
    const commands =
      typeof manifest === "object" && manifest !== null && "contributes" in manifest
        ? manifest.contributes
        : undefined;
    expect(commands).toMatchObject({
      commands: [...Object.values(COMMANDS), STATUS_COMMAND].map((command) => ({
        command,
        category: "Stateward",
      })),
    });
    expect(commands).toMatchObject({
      menus: { commandPalette: [{ command: STATUS_COMMAND, when: "false" }] },
    });
  });

  it("declares the two inline-hint settings, on by default, under the names the server reads", () => {
    const properties =
      typeof manifest === "object" &&
      manifest !== null &&
      "contributes" in manifest &&
      typeof manifest.contributes === "object" &&
      manifest.contributes !== null &&
      "configuration" in manifest.contributes &&
      typeof manifest.contributes.configuration === "object" &&
      manifest.contributes.configuration !== null &&
      "properties" in manifest.contributes.configuration
        ? manifest.contributes.configuration.properties
        : undefined;
    expect(properties).toMatchObject({
      "stateward.inlayHints.throws": { type: "boolean", default: true },
      "stateward.inlayHints.catchVariable": { type: "boolean", default: true },
    });
  });
});

describe("the extension in an untrusted workspace", () => {
  it("does not run: it would load the workspace's config and server, which run code", () => {
    const capabilities =
      typeof manifest === "object" && manifest !== null && "capabilities" in manifest
        ? manifest.capabilities
        : undefined;
    expect(capabilities).toEqual({
      untrustedWorkspaces: {
        supported: false,
        description: "stateward runs the workspace's stateward config and server.",
      },
    });
  });
});
