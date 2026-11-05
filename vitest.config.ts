import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several tests build a TypeScript program or run tsc; the first one in a file also parses the
    // libraries, which on a busy machine can take longer than vitest's default 5 seconds.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Library facts are cached per machine (~/.cache/stateward/packages): tests never write there.
    env: { STATEWARD_PACKAGE_CACHE_DIR: path.join(tmpdir(), "stateward-test-package-cache") },
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
    // Loads every pack's rule modules: a test checks a fixture synchronously (vitest.setup.ts).
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
    // Most tests build a real TypeScript program for a fixture project: a second or two each, and
    // several times that on a busy machine. A timeout is not what these tests check.
    testTimeout: 30_000,
  },
});
