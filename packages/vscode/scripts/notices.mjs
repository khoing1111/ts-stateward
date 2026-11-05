// Writes THIRD-PARTY-NOTICES.txt for the bundled extension: the licence of every package esbuild
// put into a bundle, read from the installed package, then the packages jiti carries inside its
// own dist (third-party/jiti-bundled.txt, written by jiti-licences.mjs).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const LICENCE_FILE = /^(?:licen[cs]e|copying|notice|thirdpartynotice)/i;
/** The last `node_modules/<name>` or `node_modules/@scope/name` of a path: the package it is in. */
const PACKAGE_DIR = /^(.*[/\\]node_modules[/\\](?:@[^/\\]+[/\\])?[^/\\]+)[/\\]/;

/** The root folders of the installed packages the bundles hold, sorted by package name. */
export function bundledPackages(inputs, cwd) {
  const roots = new Map();
  for (const input of inputs) {
    const match = PACKAGE_DIR.exec(path.resolve(cwd, input));
    if (match === null) continue;
    const root = match[1];
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    roots.set(`${manifest.name}@${manifest.version}`, { root, manifest });
  }
  return [...roots.values()].sort((a, b) =>
    a.manifest.name < b.manifest.name ? -1 : a.manifest.name > b.manifest.name ? 1 : 0,
  );
}

function licenceText(root, manifest) {
  const files = readdirSync(root)
    .filter((file) => LICENCE_FILE.test(file))
    .sort();
  if (files.length === 0) {
    throw new Error(
      `${manifest.name} ${manifest.version} has no licence file to include in THIRD-PARTY-NOTICES.txt`,
    );
  }
  return files.map((file) => readFileSync(path.join(root, file), "utf8").trim()).join("\n\n");
}

export function writeNotices({ inputs, cwd, jitiRoot, appendix, out }) {
  const jiti = JSON.parse(readFileSync(path.join(jitiRoot, "package.json"), "utf8"));
  const recorded = existsSync(appendix) ? readFileSync(appendix, "utf8") : "";
  if (!recorded.startsWith(`jiti ${jiti.version}\n`)) {
    throw new Error(
      `third-party/jiti-bundled.txt is not for jiti ${jiti.version}: run node packages/vscode/scripts/jiti-licences.mjs (needs network)`,
    );
  }
  const rule = "=".repeat(72);
  const parts = [
    "Third-party software in the stateward VS Code extension",
    "",
    "stateward itself is under the MIT licence (LICENSE). The extension bundles the packages",
    "below; each one's licence follows its name.",
    "",
  ];
  for (const { root, manifest } of bundledPackages(inputs, cwd)) {
    parts.push(
      rule,
      `${manifest.name} ${manifest.version} (${String(manifest.license)})`,
      rule,
      licenceText(root, manifest),
      "",
    );
  }
  parts.push(rule, `Packages bundled inside ${recorded.split("\n", 1)[0]}`, rule, recorded.trim());
  writeFileSync(out, `${parts.join("\n")}\n`);
}
