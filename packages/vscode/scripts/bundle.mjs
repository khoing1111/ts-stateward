// Bundles the extension and its fallback language server into dist/ as CommonJS.
//
// The server loads stateward.config.* with jiti, which reads `import.meta.url` and then loads its
// own `dist/babel.cjs` next to that URL. A CommonJS bundle has no `import.meta`, so it is defined
// from `__filename`, and babel.cjs is copied beside the bundle, where jiti then looks for it.
import { copyFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { writeNotices } from "./notices.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const dist = path.join(pkg, "dist");

const extension = await build({
  entryPoints: [path.join(pkg, "src", "extension.ts")],
  metafile: true,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: path.join(dist, "extension.cjs"),
  logLevel: "warning",
});

const server = await build({
  entryPoints: [path.join(pkg, "..", "language-server", "src", "bin.ts")],
  metafile: true,
  bundle: true,
  platform: "node",
  format: "cjs",
  conditions: ["source"],
  outfile: path.join(dist, "server.cjs"),
  define: { "import.meta.url": "__statewardModuleUrl" },
  banner: { js: "const __statewardModuleUrl = require('url').pathToFileURL(__filename).href;" },
  logLevel: "warning",
});

// jiti is a dependency of @stateward/core; find it from there.
const fromCore = createRequire(path.join(pkg, "..", "core", "src", "index.ts"));
const jitiEntry = fromCore.resolve("jiti");
const babel = path.join(path.dirname(jitiEntry), "..", "dist", "babel.cjs");
copyFileSync(babel, path.join(dist, "babel.cjs"));

// TypeScript reads lib.*.d.ts (where `Record`, `Array`, `Promise` are declared) from the folder of
// the file it runs from. Bundled, that folder is dist/: without these copies every standard type
// is an error type, and the rules that read a `Record` (records/lookup-misses-key, records/table-type-too-loose)
// report nothing. .vscodeignore lets them into the .vsix.
const tsLib = path.dirname(fromCore.resolve("typescript"));
for (const name of readdirSync(tsLib)) {
  if (/^lib\..*\.d\.ts$/.test(name)) copyFileSync(path.join(tsLib, name), path.join(dist, name));
}

// The licences of everything bundled above, which .vscodeignore lets into the .vsix.
const babelRoot = path.resolve(path.dirname(jitiEntry), "..");
writeNotices({
  inputs: [extension, server].flatMap((result) => Object.keys(result.metafile.inputs)),
  cwd: process.cwd(),
  jitiRoot: babelRoot,
  appendix: path.join(pkg, "third-party", "jiti-bundled.txt"),
  out: path.join(dist, "THIRD-PARTY-NOTICES.txt"),
});
