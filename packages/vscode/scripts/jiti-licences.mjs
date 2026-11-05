// Writes third-party/jiti-bundled.txt: the licences of the packages jiti ships bundled inside its
// own dist (babel, mlly, json5, …). Those packages are not installed next to jiti, so their licence
// files cannot be read at bundle time; this script fetches them once from the npm registry, and
// bundle.mjs refuses to bundle a different jiti version until it is run again.
// Run it with: node packages/vscode/scripts/jiti-licences.mjs (needs network)
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../../../scripts/run.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const fromCore = createRequire(path.join(pkg, "..", "core", "src", "index.ts"));
const jitiRoot = path.resolve(path.dirname(fromCore.resolve("jiti")), "..");
const jitiVersion = JSON.parse(readFileSync(path.join(jitiRoot, "package.json"), "utf8")).version;

// jiti's bundles name each module by its pnpm store path: `.pnpm/<name+version>/node_modules/<name>`.
const STORE_PATH = /node_modules\/\.pnpm\/([^/"]+)\/node_modules\/((?:@[^/"]+\/)?[^/"]+)/g;
const found = new Map();
for (const file of readdirSync(path.join(jitiRoot, "dist"))) {
  if (!file.endsWith(".cjs")) continue;
  const text = readFileSync(path.join(jitiRoot, "dist", file), "utf8");
  for (const [, store, name] of text.matchAll(STORE_PATH)) {
    const version = /@(\d[^_@]*)/.exec(store.slice(name.replace("/", "+").length))?.[1];
    if (version !== undefined) found.set(`${name}@${version}`, { name, version });
  }
}

const temp = mkdtempSync(path.join(os.tmpdir(), "stateward-jiti-licences-"));
const LICENCE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i;
const entries = [];
try {
  for (const { name, version } of [...found.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const into = path.join(temp, `${name.replace("/", "+")}@${version}`);
    mkdirSync(into);
    const packed = run("npm", ["pack", `${name}@${version}`, "--silent"], { cwd: into });
    if (packed.status !== 0) throw new Error(`npm pack ${name}@${version}: ${packed.output}`);
    const tarball = readdirSync(into).find((file) => file.endsWith(".tgz"));
    const untar = run("tar", ["-xzf", tarball], { cwd: into });
    if (untar.status !== 0) throw new Error(`tar ${tarball}: ${untar.output}`);
    const root = path.join(into, "package");
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const texts = readdirSync(root)
      .filter((file) => LICENCE_FILE.test(file))
      .sort()
      .map((file) => readFileSync(path.join(root, file), "utf8").trim());
    entries.push({
      id: `${name} ${version}`,
      licence: typeof manifest.license === "string" ? manifest.license : "see below",
      text:
        texts.length > 0
          ? texts.join("\n\n")
          : `(no licence file; package.json says ${manifest.license})`,
    });
    rmSync(into, { recursive: true, force: true });
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

// Many of these share one licence text (every @babel package): it is written once, after the list
// of the packages that carry it.
const byText = new Map();
for (const entry of entries) {
  const group = byText.get(entry.text) ?? [];
  group.push(entry);
  byText.set(entry.text, group);
}
const rule = "-".repeat(72);
const out = [`jiti ${jitiVersion}`, ""];
for (const [text, group] of byText) {
  out.push(rule, ...group.map((entry) => `${entry.id} (${entry.licence})`), rule, text, "");
}
mkdirSync(path.join(pkg, "third-party"), { recursive: true });
writeFileSync(path.join(pkg, "third-party", "jiti-bundled.txt"), `${out.join("\n")}\n`);
console.log(
  `wrote third-party/jiti-bundled.txt: ${String(entries.length)} packages bundled in jiti ${jitiVersion}`,
);
