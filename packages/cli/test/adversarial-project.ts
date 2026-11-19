import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

/**
 * The adversarial cases as projects: each case copied with the shared files, a tsconfig and a
 * config of every pack (`fixtures/adversarial/<group>/<case>`), and the CLI run in it.
 */

export const root = fileURLToPath(new URL("fixtures/adversarial", import.meta.url));
const scratchRoot = fileURLToPath(new URL("fixtures", import.meta.url));

const copies: string[] = [];

/** Removes every project `prepare` made: call it after the tests that use them. */
export function removeCopies(): void {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** The case copied into a project of its own: the shared files, a tsconfig and the config. */
export function prepare(dir: string): { project: string; cache: string } {
  const scratch = mkdtempSync(path.join(scratchRoot, ".adversarial-"));
  copies.push(scratch);
  const project = path.join(scratch, "project");
  const [group = ""] = dir.split("/");
  mkdirSync(path.join(project, "src"), { recursive: true });
  for (const shared of [path.join(root, "_shared"), path.join(root, group, "_shared")]) {
    if (existsSync(shared)) cpSync(shared, path.join(project, "src"), { recursive: true });
  }
  cpSync(path.join(root, dir, "src"), path.join(project, "src"), { recursive: true });
  writeFileSync(
    path.join(project, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        jsx: "react-jsx",
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2022",
        noEmit: true,
      },
      include: ["src"],
    }),
  );
  const own = path.join(root, dir, "config.json");
  const extra: unknown = existsSync(own) ? JSON.parse(readFileSync(own, "utf8")) : {};
  writeFileSync(
    path.join(project, "stateward.config.mjs"),
    [
      'import { asyncFlow } from "@stateward/plugin-async";',
      'import { ownership } from "@stateward/plugin-ownership";',
      'import { reactContext } from "@stateward/plugin-react-context";',
      'import { unions } from "@stateward/plugin-unions";',
      'import { errors } from "@stateward/plugin-errors";',
      'import { reducers } from "@stateward/plugin-reducers";',
      'import { react } from "@stateward/plugin-react";',
      // `"react": true` in the case's config.json adds the React pack (its effect rules).
      `const { reactContext: contextOptions = {}, react: withReact = false, ...extra } = ${JSON.stringify(extra)};`,
      'export default { preset: "recommended", plugins: [asyncFlow(), ownership(), reactContext(contextOptions), unions(), errors(), reducers(), ...(withReact ? [react()] : [])], include: ["src/**"], ...extra };',
      "",
    ].join("\n"),
  );
  return { project, cache: path.join(scratch, "cache") };
}

export async function run(
  argv: readonly string[],
  cwd: string,
  cache: string,
): Promise<{ code: ExitCode; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const env: CliEnv = {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    color: false,
    cacheDir: () => cache,
  };
  const code = await main(argv, env);
  return { code, stdout, stderr };
}
