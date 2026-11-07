import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Tests that change process-wide state (the environment, a module mock) keep a fresh worker per
 * file. Every other file shares its worker with the files that run after it: a worker started anew
 * for each of the ~170 files spends about a quarter of the run loading the packs again. A new test
 * file is shared unless it is named here.
 */
const ISOLATED = [
  "packages/cli/test/deps.test.ts",
  "packages/core/test/package-cache.test.ts",
  "packages/language-server/test/memory.test.ts",
  "packages/plugin-errors/test/library-facts.test.ts",
];

const EXCLUDED = ["**/node_modules/**", "**/dist/**", "**/fixtures/**"];

const common = {
  // Several tests build a TypeScript program or run tsc; the first one in a file also parses the
  // libraries, which on a busy machine can take longer than vitest's default 5 seconds.
  testTimeout: 30_000,
  hookTimeout: 30_000,
  // Library facts are cached per machine (~/.cache/stateward/packages): tests never write there.
  env: { STATEWARD_PACKAGE_CACHE_DIR: path.join(tmpdir(), "stateward-test-package-cache") },
  // Loads every pack's rule modules: a test checks a fixture synchronously (vitest.setup.ts).
  setupFiles: ["./vitest.setup.ts"],
};

export default defineConfig({
  test: {
    // The gate's machine has 4 cores; a test that spawns tsc or the CLI keeps one busy.
    maxWorkers: 4,
    projects: [
      {
        extends: true,
        test: {
          ...common,
          name: "isolated",
          include: ISOLATED,
          exclude: EXCLUDED,
          pool: "forks",
          isolate: true,
        },
      },
      {
        extends: true,
        test: {
          ...common,
          name: "shared",
          include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
          exclude: [...EXCLUDED, ...ISOLATED],
          pool: "threads",
          isolate: false,
        },
      },
    ],
  },
});
