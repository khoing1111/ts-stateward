/** What the developer answered to "Set up stateward for this project?" for one folder. */
export type SetupAnswer = "set-up" | "not-now" | "never";

export type FolderFacts = {
  hasPackageJson: boolean;
  hasTsconfig: boolean;
  hasConfig: boolean;
  /** Remembered from an earlier offer; undefined when never offered. */
  answer: SetupAnswer | undefined;
};

export type SetupDecision =
  | { kind: "offer" }
  /** A project with a config is already set up. */
  | { kind: "skip"; why: "configured" | "not-a-typescript-project" | "already-asked" };

/** Offer once: only a TypeScript project (package.json and tsconfig) without a config, never asked before. */
export function decideSetup(facts: FolderFacts): SetupDecision {
  if (facts.hasConfig) return { kind: "skip", why: "configured" };
  if (!facts.hasPackageJson || !facts.hasTsconfig) {
    return { kind: "skip", why: "not-a-typescript-project" };
  }
  if (facts.answer !== undefined) return { kind: "skip", why: "already-asked" };
  return { kind: "offer" };
}

/** The workspaceState key that holds the answer for a folder. */
export function answerKey(folder: string): string {
  return `stateward.setup:${folder}`;
}

/** The remembered answer; anything else stored under the key counts as never asked. */
export function readAnswer(stored: unknown): SetupAnswer | undefined {
  return stored === "set-up" || stored === "not-now" || stored === "never" ? stored : undefined;
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];

/** From the lockfile, the first found in the order npm, pnpm, yarn, bun; npm when there is none (as `stateward init` does). */
export function detectPackageManager(exists: (file: string) => boolean): PackageManager {
  return LOCKFILES.find(([file]) => exists(file))?.[1] ?? "npm";
}

/** The command that adds stateward to the project as a dev dependency. */
export function installCommand(manager: PackageManager): string {
  switch (manager) {
    case "npm":
      return "npm install --save-dev stateward";
    case "pnpm":
      return "pnpm add --save-dev stateward";
    case "yarn":
      return "yarn add --dev stateward";
    case "bun":
      return "bun add --dev stateward";
    default: {
      const unreachable: never = manager;
      return unreachable;
    }
  }
}

/** What the extension does for "Set up the project", from whether stateward is installed there. */
export type SetupPlan =
  /** Run `npx stateward init` in an integrated terminal in the folder. */
  | { kind: "run-init"; command: string }
  /** Say how to install it; the extension never installs. */
  | { kind: "explain-install"; command: string; message: string };

export function planSetup(installed: boolean, manager: PackageManager): SetupPlan {
  if (installed) return { kind: "run-init", command: "npx stateward init" };
  const command = installCommand(manager);
  return {
    kind: "explain-install",
    command,
    message: `Stateward is not installed in this project. Run \`${command}\` in the project folder, then choose "Stateward: Set up the project" again.`,
  };
}
