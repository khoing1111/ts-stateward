// The examples of the rule pages, run for real. A rule's explain text marks its examples with the
// fence's info string: ```ts example-bad (or tsx), ```ts example-good, and `file=<name>` when an
// example spans files (`ts example-bad file=store.ts`). The bad files are checked as a small
// project with only that rule on, and what `stateward check` prints for them goes on the page under
// the code; the good files must give no finding of the rule. Both must compile under `strict`.
// Used by scripts/docs.mjs, which fails in `--check` mode when a printed output changed.
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import ts from "typescript";
import { check, parseConfig } from "@stateward/core/internal";

/** An example fence: ```ts example-bad, ```tsx example-good file=Panel.tsx. */
const FENCE = /^```(ts|tsx) example-(bad|good)(?: file=([\w./-]+))?$/;

/**
 * The examples of an explain text: each block's role, file name, language and code, in order.
 * A block without `file=` is `example.ts` (or `.tsx`); two blocks of one role must name their files.
 */
export function exampleBlocks(explain) {
  const lines = explain.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = FENCE.exec(lines[index] ?? "");
    if (match === null) continue;
    const end = lines.findIndex((line, at) => at > index && line === "```");
    if (end === -1) throw new Error(`an example fence at line ${String(index + 1)} is not closed`);
    const [, lang, role, file] = match;
    blocks.push({
      role,
      lang,
      file: file ?? `example.${lang}`,
      code: lines.slice(index + 1, end).join("\n"),
      line: index,
      endLine: end,
    });
    index = end;
  }
  for (const role of ["bad", "good"]) {
    const files = blocks.filter((block) => block.role === role).map((block) => block.file);
    const twice = files.find((file, index) => files.indexOf(file) !== index);
    if (twice !== undefined) {
      throw new Error(`two example-${role} blocks are the file ${twice}; name them with file=`);
    }
  }
  return blocks;
}

/**
 * The packages an example may import, one set for every rule: React's own types, and stubs of
 * the libraries the fixtures use (an example imports nothing else).
 */
function linkPackages(root, dir) {
  const modules = path.join(dir, "node_modules");
  mkdirSync(path.join(modules, "@types"), { recursive: true });
  const fromContext = path.join(root, "packages/plugin-react-context/node_modules");
  const links = [
    ["react", path.join(fromContext, "react")],
    ["react-dom", path.join(fromContext, "react-dom")],
    ["@types/react", path.join(fromContext, "@types/react")],
    ["@types/react-dom", path.join(fromContext, "@types/react-dom")],
    [
      "react-error-boundary",
      path.join(root, "packages/plugin-errors/test/fixtures/stubs/react-error-boundary"),
    ],
    [
      "react-router-dom",
      path.join(root, "packages/plugin-react-context/test/fixtures/stubs/react-router-dom"),
    ],
  ];
  // A stub is copied, not linked: its own `import "react"` must resolve from the example.
  for (const [name, target] of links) {
    if (target.includes(`${path.sep}stubs${path.sep}`))
      cpSync(target, path.join(modules, name), { recursive: true });
    else symlinkSync(target, path.join(modules, name), "dir");
  }
}

const COMPILER_OPTIONS = {
  strict: true,
  module: "NodeNext",
  moduleResolution: "NodeNext",
  target: "ES2022",
  lib: ["ES2022", "DOM"],
  jsx: "react-jsx",
  noEmit: true,
  types: [],
};

/** TypeScript's lib and React's types, parsed once for every example's type check. */
const registry = ts.createDocumentRegistry();

/** The project's type errors, one line each; empty when it compiles. */
function typeErrors(dir, files) {
  const parsed = ts.convertCompilerOptionsFromJson(COMPILER_OPTIONS, dir);
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  // Files outside the example (the lib, node_modules) are the same for every example.
  host.getSourceFile = (fileName, languageVersion, onError) => {
    if (fileName.startsWith(dir) && !fileName.includes("node_modules")) {
      return getSourceFile(fileName, languageVersion, onError);
    }
    const text = ts.sys.readFile(fileName);
    if (text === undefined) return undefined;
    return registry.acquireDocument(
      fileName,
      parsed.options,
      ts.ScriptSnapshot.fromString(text),
      "1",
    );
  };
  const program = ts.createProgram(
    files.map((file) => path.join(dir, file)),
    parsed.options,
    host,
  );
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    if (diagnostic.file === undefined || diagnostic.start === undefined) return text;
    const at = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${path.basename(diagnostic.file.fileName)}:${String(at.line + 1)}: ${text}`;
  });
}

/**
 * Checks the files (name to code) with only `ruleId` on, as `recommended` sets it (an add-on
 * rule with its add-on listed). Returns the rule's findings and the type errors of the code.
 */
function runExample(root, plugin, key, files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "stateward-docs-"));
  try {
    const names = [...files.keys()];
    for (const [name, code] of files) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), `${code}\n`);
    }
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: COMPILER_OPTIONS, files: names }),
    );
    linkPackages(root, dir);
    const rule = plugin.rules[key];
    const rules = Object.fromEntries(
      Object.keys(plugin.rules)
        .filter((other) => other !== key)
        .map((other) => [`${plugin.name}/${other}`, "off"]),
    );
    const addons = rule.meta.addon === undefined ? [] : [`${plugin.name}/${rule.meta.addon}`];
    const parsed = parseConfig({ plugins: [plugin], preset: "recommended", rules, addons }, dir);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const result = check({ config: parsed.value, cwd: dir });
    const texts = new Map(names.map((name) => [path.join(dir, name), `${files.get(name)}\n`]));
    return { dir, result, texts, errors: typeErrors(dir, names) };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** The files of one role: name to code. */
function filesOf(blocks, role) {
  return new Map(blocks.filter((block) => block.role === role).map((b) => [b.file, b.code]));
}

/**
 * Runs a rule's examples. Returns the output `stateward check` prints for the bad example (no
 * summary line, paths relative to the example), its first finding's headline and fix line, and
 * the problems: an example that does not compile, a bad one that does not trigger the rule, or a
 * good one that does.
 */
export async function exampleOutput(root, plugin, key, explain) {
  const id = `${plugin.name}/${key}`;
  const { formatPretty } = await import(
    pathToFileURL(path.join(root, "packages/cli/dist/format.js")).href
  );
  const blocks = exampleBlocks(explain);
  const problems = [];
  let output = "";
  let first;
  for (const role of ["bad", "good"]) {
    // The good example is the bad one with its good files in place of theirs: a file it leaves
    // out (the brand's own file, the store) is the same in both.
    const files =
      role === "bad"
        ? filesOf(blocks, "bad")
        : new Map([...filesOf(blocks, "bad"), ...filesOf(blocks, "good")]);
    if (filesOf(blocks, role).size === 0) continue;
    const run = runExample(root, plugin, key, files);
    try {
      for (const error of run.errors) problems.push(`${id}: the ${role} example: ${error}`);
      const findings = run.result.findings.filter((finding) => finding.ruleId === id);
      const others = run.result.findings.filter((finding) => finding.ruleId !== id);
      for (const other of others) {
        problems.push(`${id}: the ${role} example: ${other.ruleId}: ${other.message}`);
      }
      if (role === "good") {
        for (const finding of findings) {
          problems.push(`${id}: the good example still gives: ${finding.message}`);
        }
        continue;
      }
      if (!findings.some((finding) => finding.kind === "problem")) {
        problems.push(`${id}: the bad example no longer triggers the rule`);
      }
      const shown = { ...run.result, findings };
      const text = formatPretty(shown, {
        cwd: run.dir,
        readText: (file) => run.texts.get(file),
        color: false,
        verbose: true,
      });
      // The last line is the summary, with the time the check took: not the same twice.
      output = text.trimEnd().split("\n").slice(0, -1).join("\n").trimEnd();
      const [top] = findings;
      if (top !== undefined) {
        first = {
          headline: output.split("\n")[0] ?? "",
          hint: top.hint.split("\n")[0] ?? "",
          file: path.basename(top.location.file),
          line: lineOf(run.texts.get(top.location.file) ?? "", top.location.start),
        };
      }
    } finally {
      rmSync(run.dir, { recursive: true, force: true });
    }
  }
  return { blocks, output, first, problems };
}

function lineOf(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

/** Every file under `dir` that `keep` accepts, in a stable order, as "path:content" for a hash. */
function hashFiles(hash, dir, keep) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) hashFiles(hash, full, keep);
    else if (keep(entry.name))
      hash.update(`${entry.name}\0`).update(readFileSync(full)).update("\0");
  }
}

/** The hash of the built code (.js and package.json) of a package folder. */
function builtHash(root, folder) {
  const hash = createHash("sha256");
  hashFiles(hash, path.join(root, "packages", folder, "dist"), (name) => name.endsWith(".js"));
  return hash
    .update(readFileSync(path.join(root, "packages", folder, "package.json")))
    .digest("hex");
}

/**
 * What every example's output depends on besides its own text and its pack: the engine and the
 * CLI's formatter (built), TypeScript's and React's versions, the stubs, and these scripts.
 */
function environmentHash(root) {
  const hash = createHash("sha256");
  hash.update(`typescript ${ts.version}\0node-major ${process.versions.node.split(".")[0]}\0`);
  hash.update(builtHash(root, "core")).update(builtHash(root, "cli"));
  const context = path.join(root, "packages/plugin-react-context/node_modules");
  for (const name of ["react", "react-dom", "@types/react", "@types/react-dom"]) {
    const file = path.join(context, name, "package.json");
    hash.update(existsSync(file) ? readFileSync(file) : `no ${name}`);
  }
  for (const stubs of [
    "packages/plugin-errors/test/fixtures/stubs/react-error-boundary",
    "packages/plugin-react-context/test/fixtures/stubs/react-router-dom",
  ]) {
    hashFiles(hash, path.join(root, stubs), () => true);
  }
  for (const script of ["docs-examples.mjs", "docs-examples-worker.mjs", "rule-meta.mjs"]) {
    hash.update(readFileSync(fileURLToPath(new URL(script, import.meta.url))));
  }
  return hash.digest("hex");
}

/** A miss runs the example as before; a hit is a JSON file named by the hash of everything it reads. */
function cacheDir(root) {
  return path.join(root, "node_modules/.cache/stateward/docs-examples");
}

function readCached(dir, key) {
  try {
    return JSON.parse(readFileSync(path.join(dir, `${key}.json`), "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Runs the examples of the rules in `entries` ({ id: "pack/rule", folder: "plugin-x", explain })
 * in worker threads, one per CPU (at most 4): each check builds a TypeScript program, which takes
 * a second or two. Returns the results by id.
 *
 * A result is cached (node_modules/.cache, ignored by git) under the hash of the example's text,
 * the rule's pack as built, the engine as built, and the versions it reads (environmentHash), so
 * a change to any of them is a miss and runs the example as before. `cache: false` skips the cache.
 */
export async function runExamples(root, entries, { cache = true } = {}) {
  const results = new Map();
  const dir = cacheDir(root);
  const keys = new Map();
  const misses = [];
  if (cache) {
    const environment = environmentHash(root);
    const packs = new Map();
    for (const entry of entries) {
      if (!packs.has(entry.folder)) packs.set(entry.folder, builtHash(root, entry.folder));
      const key = createHash("sha256")
        .update(`${environment}\0${packs.get(entry.folder)}\0${entry.id}\0${entry.explain}`)
        .digest("hex");
      keys.set(entry.id, key);
      const hit = readCached(dir, key);
      if (hit === undefined) misses.push(entry.id);
      else results.set(entry.id, hit);
    }
  } else {
    misses.push(...entries.map((entry) => entry.id));
  }
  if (misses.length > 0) {
    const fresh = await runInWorkers(root, misses);
    mkdirSync(dir, { recursive: true });
    // Entries of an earlier build are of no use any more.
    const current = new Set([...keys.values()].map((key) => `${key}.json`));
    for (const name of readdirSync(dir)) if (!current.has(name)) rmSync(path.join(dir, name));
    for (const [id, result] of fresh) {
      results.set(id, result);
      const key = keys.get(id);
      if (key !== undefined) writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(result));
    }
  }
  return results;
}

async function runInWorkers(root, ids) {
  const count = Math.max(1, Math.min(4, os.availableParallelism(), ids.length));
  const shares = Array.from({ length: count }, (_, index) =>
    ids.filter((_, at) => at % count === index),
  );
  const workerFile = fileURLToPath(new URL("./docs-examples-worker.mjs", import.meta.url));
  const results = await Promise.all(
    shares.map(
      (share) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(workerFile, { workerData: { root, ids: share } });
          worker.once("message", resolve);
          worker.once("error", reject);
          worker.once("exit", (code) => {
            if (code !== 0)
              reject(new Error(`an examples worker stopped with code ${String(code)}`));
          });
        }),
    ),
  );
  return new Map(results.flat());
}
