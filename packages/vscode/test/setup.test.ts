import { describe, expect, it } from "vitest";
import {
  answerKey,
  decideSetup,
  detectPackageManager,
  installCommand,
  planSetup,
  readAnswer,
} from "../src/setup.js";

const project = { hasPackageJson: true, hasTsconfig: true, hasConfig: false, answer: undefined };

describe("decideSetup", () => {
  it("offers to a TypeScript project without a config that was never asked", () => {
    expect(decideSetup(project)).toEqual({ kind: "offer" });
  });

  it("does not offer where a config exists", () => {
    expect(decideSetup({ ...project, hasConfig: true })).toEqual({
      kind: "skip",
      why: "configured",
    });
  });

  it("does not offer without package.json or without tsconfig", () => {
    const notTs = { kind: "skip", why: "not-a-typescript-project" };
    expect(decideSetup({ ...project, hasPackageJson: false })).toEqual(notTs);
    expect(decideSetup({ ...project, hasTsconfig: false })).toEqual(notTs);
  });

  it("does not offer twice, whatever the answer was", () => {
    for (const answer of ["set-up", "not-now", "never"] as const) {
      expect(decideSetup({ ...project, answer })).toEqual({ kind: "skip", why: "already-asked" });
    }
  });
});

describe("remembered answers", () => {
  it("keys the answer by folder", () => {
    expect(answerKey("/a")).not.toBe(answerKey("/b"));
  });

  it("reads the three answers and treats anything else as never asked", () => {
    expect(readAnswer("never")).toBe("never");
    expect(readAnswer("not-now")).toBe("not-now");
    expect(readAnswer("set-up")).toBe("set-up");
    expect(readAnswer(undefined)).toBeUndefined();
    expect(readAnswer(3)).toBeUndefined();
    expect(readAnswer("maybe")).toBeUndefined();
  });
});

describe("package manager and setup plan", () => {
  it("finds the manager from the lockfile, npm without one", () => {
    expect(detectPackageManager((file) => file === "pnpm-lock.yaml")).toBe("pnpm");
    expect(detectPackageManager((file) => file === "yarn.lock")).toBe("yarn");
    expect(detectPackageManager((file) => file === "bun.lockb")).toBe("bun");
    expect(detectPackageManager(() => false)).toBe("npm");
  });

  it("names the install command of each manager", () => {
    expect(installCommand("npm")).toBe("npm install --save-dev stateward");
    expect(installCommand("pnpm")).toBe("pnpm add --save-dev stateward");
    expect(installCommand("yarn")).toBe("yarn add --dev stateward");
    expect(installCommand("bun")).toBe("bun add --dev stateward");
  });

  it("runs init when stateward is installed, else only says how to install it", () => {
    expect(planSetup(true, "pnpm")).toEqual({ kind: "run-init", command: "npx stateward init" });
    expect(planSetup(false, "pnpm")).toMatchObject({
      kind: "explain-install",
      command: "pnpm add --save-dev stateward",
    });
  });
});
