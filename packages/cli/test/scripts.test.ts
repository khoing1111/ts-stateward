import { describe, expect, it } from "vitest";
import { scriptRunningStateward, scriptsOf } from "../src/scripts.js";

const scripts = scriptsOf(
  JSON.stringify({
    scripts: {
      lint: "eslint . && pnpm run types && pnpm state",
      types: "tsc --noEmit",
      state: "stateward check --max-warnings 0",
      test: "vitest run",
      loop: "npm run loop",
    },
  }),
);

describe("scriptRunningStateward", () => {
  it("finds the script a command runs that runs stateward, with how the command named it", () => {
    expect(scriptRunningStateward("pnpm lint", scripts)).toEqual({
      invocation: "pnpm lint",
      script: "lint",
    });
    expect(scriptRunningStateward("npm run-script state", scripts)?.script).toBe("state");
  });

  it("ignores commands that are not scripts, scripts that do not run it, and cycles", () => {
    expect(scriptRunningStateward("yarn install && npm test", scripts)).toBeUndefined();
    expect(scriptRunningStateward("npm run loop", scripts)).toBeUndefined();
  });

  it("reads no scripts from a package.json that is not JSON", () => {
    expect(scriptsOf("{")).toEqual(new Map());
    expect(scriptsOf(JSON.stringify({ scripts: { a: 1, b: "x" } }))).toEqual(new Map([["b", "x"]]));
  });
});
