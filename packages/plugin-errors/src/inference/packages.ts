import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "@stateward/core/typescript";
import {
  findPackageRoot,
  openPackageSource,
  packageCodeId,
  readPackageCache,
  reparsedWithJsDoc,
  writePackageCache,
} from "@stateward/core";
import type {
  FileContext,
  FunctionFacts,
  Json,
  PackageCacheKey,
  PackageSource,
} from "@stateward/core";
import { BUILTIN_ERRORS, builtinId, isBuiltin } from "./builtins.js";
import { solveFunctions } from "./solve.js";
import type { FunctionEntry, Source, Thrown } from "./solve.js";
import { REASON, packageClassId, summarizeThrows } from "./summarize.js";
import type { PackageCall, PackageResolver } from "./summarize.js";
import { readClass } from "./summary.js";
import type { ClassFact, Effect, PackageFacts, Side, ThrowsSummary } from "./summary.js";

/**
 * Library facts for the Errors pack: what a call into a
 * package throws, from the first source that answers:
 *
 * 1. the project's config (`facts`);
 * 2. curated fact files shipped with stateward (`curatedFacts` answers nothing yet);
 * 3. `@throws {X}` on the called declaration in the package's `.d.ts`;
 * 4. inferred from the package's JavaScript, with the summarizer of the project's own code, from
 *    the called function to what it calls in the package (bounded), cached globally;
 * 5. unknown, with one of the reasons below.
 */

/** Why a package's function is not (fully) known: fixed strings, shown as they are. */
export const UNKNOWN_REASONS = [
  // The package as a whole cannot be read.
  "no readable source",
  "not found in its source",
  "native addon",
  "minified",
  "eval",
  "dynamic require",
  "too large to follow",
  // Read, but part of what the function does cannot be followed.
  "untyped @throws",
  "calls a callback",
  "calls code it cannot see",
  "dynamic call",
  "throws a value of unknown class",
  "awaits a promise it cannot follow",
] as const;

export type UnknownReason = (typeof UNKNOWN_REASONS)[number];

/**
 * At most this many functions are read per package function asked for.
 * The bounds count, never time: a verdict by time would differ between machines.
 */
export const MAX_FUNCTIONS = 200;
/** A package whose entry reaches more files than this is not parsed further. */
const MAX_FILES = 500;
/** Folder entries looked at for a native addon (`.node`, `binding.gyp`). */
const MAX_SCANNED = 5000;
/** Average line length above which a file is minified. */
const MINIFIED_LINE = 500;

const NOTHING: Side = { classes: [], unknown: [] };

type Sides = { readonly throws: Side; readonly rejects: Side };

/** What source 4 found for one function: its sides and classes, or why it is unknown. */
type Inferred =
  | { readonly kind: "known"; readonly sides: Sides; readonly classes: readonly ClassFact[] }
  | { readonly kind: "unknown"; readonly reason: UnknownReason };

// ---- the package: where it is, its version and integrity ----------------------------------------

type Manifest = Readonly<Record<string, unknown>>;

type PackageInfo = {
  readonly name: string;
  /** The folder of the package's JavaScript (not its `@types` package). */
  readonly root: string;
  readonly version: string;
  readonly manifest: Manifest;
  readonly key: PackageCacheKey;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/** The folder of the installed package a file in node_modules belongs to. */
function installedRoot(file: string): { root: string; name: string } | undefined {
  const marker = "/node_modules/";
  const at = file.lastIndexOf(marker);
  if (at < 0) return undefined;
  const parts = file.slice(at + marker.length).split("/");
  const [first = "", second = ""] = parts;
  const name = first.startsWith("@") ? `${first}/${second}` : first;
  return { root: `${file.slice(0, at + marker.length)}${name}`, name };
}

/**
 * What this process read of each package's package.json, with the file's size and time when it
 * was read: a package upgraded or reinstalled while the process runs (a language server) is read
 * again, and its new content hash keys every cache below, so no old fact is served for it.
 */
const infos = new Map<string, { readonly stamp: string; readonly info: PackageInfo | undefined }>();

let codeId: string | undefined;

/** The size and time of a file, to tell a changed one; "" when it cannot be read. */
function stampOf(file: string): string {
  try {
    const stats = statSync(file);
    return `${String(stats.size)}:${String(stats.mtimeMs)}`;
  } catch {
    return "";
  }
}

/**
 * The package at `root`, from its package.json. `checked` holds what this resolver already read,
 * so a package.json is looked at (one stat) once per file summarized, not once per call.
 */
function readInfo(
  name: string,
  root: string,
  checked: Map<string, PackageInfo | undefined>,
): PackageInfo | undefined {
  if (checked.has(root)) return checked.get(root);
  const manifestFile = path.join(root, "package.json");
  const stamp = stampOf(manifestFile);
  const known = infos.get(root);
  if (known?.stamp === stamp) {
    checked.set(root, known.info);
    return known.info;
  }
  let info: PackageInfo | undefined;
  try {
    const text = readFileSync(manifestFile, "utf8");
    const parsed: unknown = JSON.parse(text);
    const manifest = isRecord(parsed) ? parsed : {};
    const version = typeof manifest.version === "string" ? manifest.version : "";
    codeId ??= packageCodeId(import.meta.url);
    info = {
      name,
      root,
      version,
      manifest,
      key: { name, version, integrity: sha1(text), implementation: codeId },
    };
  } catch {
    info = undefined;
  }
  infos.set(root, { stamp, info });
  checked.set(root, info);
  return info;
}

/** The per-process caches' key of a package: its folder and its package.json's content. */
function packageKey(info: PackageInfo): string {
  return `${info.root}\u0000${info.key.integrity}`;
}

/** The package whose JavaScript a call reaches: next to its declaration, or found by name. */
function packageOf(
  call: PackageCall,
  from: string,
  checked: Map<string, PackageInfo | undefined>,
): PackageInfo | undefined {
  const installed = installedRoot(call.file.replaceAll("\\", "/"));
  if (installed?.name === call.name) return readInfo(call.name, installed.root, checked);
  // `@types/x`, a linked package, or `declare module "x"` in the project: the package by its
  // name, as Node finds it from the calling file (a package manager's store keeps `@types/x`
  // away from `x`), else from the declaration.
  const root =
    findPackageRoot(path.dirname(from), call.name) ??
    findPackageRoot(path.dirname(installed?.root ?? call.file), call.name);
  return root === undefined ? undefined : readInfo(call.name, root, checked);
}

const JAVASCRIPT_EXTENSIONS = [".js", ".mjs", ".cjs"];

function existingFile(file: string): string | undefined {
  const candidates = [
    file,
    ...JAVASCRIPT_EXTENSIONS.map((extension) => `${file}${extension}`),
    ...JAVASCRIPT_EXTENSIONS.map((extension) => path.join(file, `index${extension}`)),
  ];
  return candidates.find((candidate) => {
    try {
      return readdirSync(path.dirname(candidate)).includes(path.basename(candidate));
    } catch {
      return false;
    }
  });
}

/** The first file an `exports` value names for `import`, `default`, `require` or `node`. */
function exportTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  for (const key of [".", "import", "default", "require", "node"]) {
    const found = exportTarget(value[key]);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The JavaScript file a declaration file describes: its sibling, else the package's entry. */
function entryOf(declarationFile: string, info: PackageInfo): string | undefined {
  const file = declarationFile.replaceAll("\\", "/");
  if (file.startsWith(`${info.root}/`)) {
    const stem = file.replace(/\.d\.[mc]?ts$/, "");
    const sibling = JAVASCRIPT_EXTENSIONS.map((extension) => `${stem}${extension}`).find(
      (candidate) => existingFile(candidate) === candidate,
    );
    if (sibling !== undefined) return sibling;
  }
  const { manifest } = info;
  const named =
    exportTarget(manifest.exports) ??
    (typeof manifest.module === "string" ? manifest.module : undefined) ??
    (typeof manifest.main === "string" ? manifest.main : undefined) ??
    "index.js";
  return existingFile(path.join(info.root, named));
}

// ---- the called declaration ---------------------------------------------------------------------

function declarationName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
    if (node.name !== undefined) return node.name.text;
    return node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) === true
      ? "default"
      : undefined;
  }
  if (ts.isExportAssignment(node)) return "default";
  if (ts.isModuleDeclaration(node)) return ts.isIdentifier(node.name) ? node.name.text : undefined;
  if (
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isInterfaceDeclaration(node)
  ) {
    return ts.isIdentifier(node.name) ? node.name.text : undefined;
  }
  return undefined;
}

/** The declaration's path in the package's types: `["Client", "get"]`. */
export function pathOf(node: ts.Node): string[] {
  const names: string[] = [];
  for (let at: ts.Node = node; !ts.isSourceFile(at); at = at.parent) {
    const name = declarationName(at);
    if (name !== undefined) names.unshift(name);
  }
  return names;
}

/** Whether the declaration says it returns a promise: its facts are what the promise rejects with. */
function returnsPromise(node: ts.Node): boolean {
  let type: ts.TypeNode | undefined;
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node)
  ) {
    type = node.type;
  } else if (
    (ts.isVariableDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isPropertyDeclaration(node)) &&
    node.type !== undefined &&
    ts.isFunctionTypeNode(node.type)
  ) {
    type = node.type.type;
  }
  return (
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    (type.typeName.text === "Promise" || type.typeName.text === "PromiseLike")
  );
}

/** A class a fact names: a built-in error, or the package's own class. */
function classIdOf(packageName: string, name: string): string {
  return BUILTIN_ERRORS.has(name) ? builtinId(name) : packageClassId(packageName, name);
}

function side(classes: readonly string[], unknown: readonly string[] = []): Side {
  return { classes: [...new Set(classes)].sort(), unknown: [...new Set(unknown)].sort() };
}

function onSide(set: Side, promise: boolean): Sides {
  return promise ? { throws: NOTHING, rejects: set } : { throws: set, rejects: NOTHING };
}

// ---- 1. config ----------------------------------------------------------------------------------

function configured(entry: FunctionFacts, packageName: string, promise: boolean): Sides {
  const named = (list: readonly string[] | undefined): string[] =>
    (list ?? []).map((name) => classIdOf(packageName, name));
  const thrown = side(named(entry.throws));
  const rejected = side(named(entry.rejects));
  // A promise's function "throws" what its promise rejects with, as a developer says it.
  return promise
    ? { throws: NOTHING, rejects: side([...thrown.classes, ...rejected.classes]) }
    : { throws: thrown, rejects: rejected };
}

// ---- 2. curated ---------------------------------------------------------------------------

/**
 * Curated fact files shipped with stateward: none ship yet, so nothing answers between the config
 * and the declarations. Reading `facts/<package>@<major>.json` here would add the `curated`
 * source, and the resolver would ask it after the config.
 */
export function curatedFacts(): undefined {
  return undefined;
}

// ---- 3. declared --------------------------------------------------------------------------------

function sameNode(root: ts.Node, target: ts.Node): ts.Node | undefined {
  if (root.pos === target.pos && root.end === target.end && root.kind === target.kind) return root;
  return ts.forEachChild(root, (child) =>
    child.pos <= target.pos && target.end <= child.end ? sameNode(child, target) : undefined,
  );
}

/** `@throws {X}` on the called declaration in the package's types, or undefined without a tag. */
function declared(call: PackageCall): Sides | undefined {
  const reparsed = reparsedWithJsDoc(call.node.getSourceFile());
  const node = sameNode(reparsed, call.node);
  if (node === undefined) return undefined;
  const tags = ts.getJSDocTags(node).filter(ts.isJSDocThrowsTag);
  if (tags.length === 0) return undefined;
  const classes: string[] = [];
  const unknown: UnknownReason[] = [];
  const add = (type: ts.TypeNode): void => {
    if (ts.isParenthesizedTypeNode(type)) add(type.type);
    else if (ts.isUnionTypeNode(type)) for (const member of type.types) add(member);
    else if (type.kind === ts.SyntaxKind.NeverKeyword) return;
    else if (ts.isTypeReferenceNode(type)) {
      const name = ts.isIdentifier(type.typeName) ? type.typeName : type.typeName.right;
      classes.push(classIdOf(call.name, name.text));
    } else unknown.push("untyped @throws");
  };
  for (const tag of tags) {
    const type = tag.typeExpression?.type;
    if (type === undefined) unknown.push("untyped @throws");
    else add(type);
  }
  return onSide(side(classes, unknown), returnsPromise(node));
}

// ---- 4. inferred --------------------------------------------------------------------------------

/** What makes a package's code not open to read, file by file. */
function unreadable(sourceFile: ts.SourceFile): UnknownReason | undefined {
  const text = sourceFile.text;
  const lines = text.split("\n").length;
  if (text.length / lines > MINIFIED_LINE) return "minified";
  let names = 0;
  let short = 0;
  let found: UnknownReason | undefined;
  const isLiteral = (node: ts.Node | undefined): boolean =>
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      names++;
      if (node.name.text.length <= 2) short++;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && (callee.text === "eval" || callee.text === "Function")) {
        found = "eval";
        return;
      }
      const dynamicRequire = ts.isIdentifier(callee) && callee.text === "require";
      const dynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      if ((dynamicRequire || dynamicImport) && !isLiteral(node.arguments?.[0])) {
        found = "dynamic require";
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  // Mostly one- and two-letter names: a minifier renamed them.
  if (names >= 20 && short * 2 > names) return "minified";
  return found;
}

const natives = new Map<string, boolean>();

/** Every entry under `dir`, relative; none when it cannot be read. */
function listed(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
}

/** Whether the package ships a native addon (a `.node` file or a `binding.gyp`). */
function hasNativeAddon(info: PackageInfo): boolean {
  const known = natives.get(packageKey(info));
  if (known !== undefined) return known;
  const entries = listed(info.root).slice(0, MAX_SCANNED);
  const found = entries.some(
    (entry) =>
      !entry.split(path.sep).includes("node_modules") &&
      (entry.endsWith(".node") || path.basename(entry) === "binding.gyp"),
  );
  natives.set(packageKey(info), found);
  return found;
}

type Opened = {
  readonly source: PackageSource;
  readonly verdict: UnknownReason | undefined;
  readonly summaries: Map<string, ThrowsSummary>;
};

/**
 * Package sources by package (root and content) and entry, most recently used last. Each holds a
 * program with its type checker, so only the last few stay open: what was inferred from them is
 * kept in `memo`, and a package needed again is opened again (it rarely is: a project's calls
 * into one package are mostly answered from `memo`).
 */
const opened = new Map<string, Opened>();
/** How many package sources stay open at once. */
const OPEN_PACKAGES = 4;

function open(info: PackageInfo, entry: string): Opened {
  const key = `${packageKey(info)}\u0000${entry}`;
  const known = opened.get(key);
  if (known !== undefined) {
    opened.delete(key);
    opened.set(key, known);
    return known;
  }
  const source = openPackageSource(info.root, entry);
  let verdict: UnknownReason | undefined;
  if (hasNativeAddon(info)) verdict = "native addon";
  else if (source.files.length > MAX_FILES) verdict = "too large to follow";
  else {
    for (const file of source.files) {
      const sourceFile = source.sourceFile(file);
      verdict = sourceFile === undefined ? undefined : unreadable(sourceFile);
      if (verdict !== undefined) break;
    }
  }
  const made = { source, verdict, summaries: new Map<string, ThrowsSummary>() };
  opened.set(key, made);
  for (const oldest of opened.keys()) {
    if (opened.size <= OPEN_PACKAGES) break;
    opened.delete(oldest);
  }
  return made;
}

function summaryOf(state: Opened, file: string): ThrowsSummary | undefined {
  const known = state.summaries.get(file);
  if (known !== undefined) return known;
  const sourceFile = state.source.sourceFile(file);
  if (sourceFile === undefined) return undefined;
  const ctx: FileContext = {
    file,
    options: {},
    sourceFile,
    types: state.source.types,
    addons: [],
    facts: {},
    report() {
      // A package's source is read for facts, never reported on.
    },
    unknown() {
      // As above.
    },
  };
  const summary = summarizeThrows(ctx);
  state.summaries.set(file, summary);
  return summary;
}

function callIds(effects: readonly Effect[], into: string[]): void {
  for (const effect of effects) {
    if (effect.k === "call") into.push(effect.id);
    else if (effect.k === "try") {
      callIds(effect.body, into);
      callIds(effect.fin, into);
      const handler = effect.handler;
      if (handler !== null) {
        callIds(handler.pre, into);
        for (const branch of handler.branches) callIds(branch.body, into);
        callIds(handler.otherwise ?? [], into);
        callIds(handler.after, into);
      }
    }
  }
}

/** Why part of a function read from source is unknown, as one of the fixed reasons. */
function reasonOf(source: Source): UnknownReason {
  switch (source.reason) {
    case REASON.callback:
      return "calls a callback";
    case REASON.dynamic:
      return "dynamic call";
    case REASON.promise:
      return "awaits a promise it cannot follow";
    case REASON.thrownValue:
    case REASON.madeError:
      return "throws a value of unknown class";
    default:
      return source.reason.includes("@throws") ? "untyped @throws" : "calls code it cannot see";
  }
}

/** Reads the function at `names` in the package's source, within the bounds. */
function inferFrom(info: PackageInfo, entry: string, names: readonly string[]): Inferred {
  const state = open(info, entry);
  if (state.verdict !== undefined) {
    return { kind: "unknown", reason: state.verdict };
  }
  const notFound: Inferred = { kind: "unknown", reason: "not found in its source" };
  const target = state.source.exported(entry, names);
  if (target === undefined) return notFound;
  const tooLarge: Inferred = { kind: "unknown", reason: "too large to follow" };
  const functions = new Map<string, FunctionEntry>();
  const classes = new Map<string, ClassFact>();
  const files = new Set(state.source.files);
  const queue = [target.id];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (functions.has(id)) continue;
    const file = path.join(info.root, id.slice(0, id.indexOf("#")));
    const summary = files.has(file.replaceAll("\\", "/")) ? summaryOf(state, file) : undefined;
    const fact = summary?.functions.find((one) => one.id === id);
    if (summary === undefined || fact === undefined) continue;
    functions.set(id, { file, fact });
    for (const one of summary.classes) classes.set(one.id, one);
    if (functions.size > MAX_FUNCTIONS) return tooLarge;
    const called: string[] = [];
    callIds(fact.body, called);
    callIds(fact.returns, called);
    queue.push(...called);
  }
  const result = solveFunctions(functions, classes).get(target.id);
  if (result === undefined) return notFound;

  const mapped = (id: string): string =>
    isBuiltin(id)
      ? id
      : packageClassId(info.name, classes.get(id)?.name ?? id.slice(id.indexOf("#") + 1));
  const sideOf = (thrown: Thrown): Side =>
    side([...thrown.classes.keys()].map(mapped), [
      ...thrown.unknowns.map(reasonOf),
      ...(thrown.more ? ["calls code it cannot see"] : []),
    ]);
  const facts: ClassFact[] = [...classes.values()]
    .map((one) => ({
      id: mapped(one.id),
      name: one.name,
      parent: one.parent === null ? null : mapped(one.parent),
      open: one.open,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    kind: "known",
    sides: { throws: sideOf(result.throws), rejects: sideOf(result.rejects) },
    classes: facts,
  };
}

// ---- the global cache ---------------------------------------------------------------------------

let inferences = 0;
let cacheHits = 0;

/** What this process computed and read back, for tests: inference runs and global-cache hits. */
export function packageFactsStats(): { inferences: number; cacheHits: number } {
  return { inferences, cacheHits };
}

/** Forgets what this process knows about packages (tests: the next run reads the global cache). */
export function forgetPackageFacts(): void {
  infos.clear();
  opened.clear();
  natives.clear();
  memo.clear();
  entries.clear();
  verified.clear();
}

/** Inferred facts by package (root and content), entry and function, for this process. */
const memo = new Map<string, Inferred>();
/** The global cache's entry of each package (root and content), read once per process. */
const entries = new Map<string, Map<string, Json>>();
/** Whether the files behind a cached digest still hold what they held, by root and digest. */
const verified = new Map<string, boolean>();

/**
 * The files inference read, by path relative to the package, with a hash of each; and one digest
 * of them all. A package.json says nothing of a linked workspace package's source, or of a
 * patched file in node_modules, so each inferred entry carries the digest of the files it was
 * inferred from, and a file that no longer matches makes the entry a miss.
 */
function sourcesOf(info: PackageInfo, files: readonly string[]): { digest: string; hashes: Json } {
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const relative = path.relative(info.root, file).replaceAll("\\", "/");
    hashes[relative] = fileHash(file) ?? "";
  }
  const lines = Object.keys(hashes)
    .sort()
    .map((relative) => `${relative} ${hashes[relative] ?? ""}`);
  return { digest: sha1(lines.join("\n")), hashes };
}

function fileHash(file: string): string | undefined {
  try {
    return createHash("sha1").update(readFileSync(file)).digest("hex");
  } catch {
    return undefined;
  }
}

/** Whether every file a cached digest lists still has the hash it had. */
function stillTheSame(
  info: PackageInfo,
  digest: string,
  cached: ReadonlyMap<string, Json>,
): boolean {
  const key = `${packageKey(info)}\u0000${digest}`;
  const known = verified.get(key);
  if (known !== undefined) return known;
  const hashes = fieldsOf(cached.get(`sources ${digest}`));
  const same =
    hashes !== undefined &&
    Object.entries(hashes).every(
      ([relative, hash]) =>
        typeof hash === "string" && fileHash(path.join(info.root, relative)) === hash,
    );
  verified.set(key, same);
  return same;
}

/** An entry of the global cache; `sources`: the digest of the files it was inferred from. */
function toJson(inferred: Inferred, sources: string): Json {
  return inferred.kind === "unknown"
    ? { unknown: inferred.reason, sources }
    : {
        sources,
        throws: { classes: inferred.sides.throws.classes, unknown: inferred.sides.throws.unknown },
        rejects: {
          classes: inferred.sides.rejects.classes,
          unknown: inferred.sides.rejects.unknown,
        },
        classes: inferred.classes.map((one) => ({ ...one })),
      };
}

function isReason(value: unknown): value is UnknownReason {
  return UNKNOWN_REASONS.some((reason) => reason === value);
}

type JsonFields = Readonly<Record<string, Json>>;

function isList(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

function fieldsOf(value: Json | undefined): JsonFields | undefined {
  if (value === undefined || typeof value !== "object" || value === null || isList(value)) {
    return undefined;
  }
  return value;
}

function listOf(value: Json | undefined): readonly Json[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readSide(value: Json | undefined): Side | undefined {
  const fields = fieldsOf(value);
  const classes = listOf(fields?.classes);
  const unknown = listOf(fields?.unknown);
  if (classes === undefined || unknown === undefined) return undefined;
  const ids = classes.filter((one) => typeof one === "string");
  const reasons = unknown.filter(isReason);
  return ids.length === classes.length && reasons.length === unknown.length
    ? { classes: ids, unknown: reasons }
    : undefined;
}

/** A cached entry as `toJson` wrote it; undefined (a miss) for anything else. */
function fromJson(value: Json | undefined): Inferred | undefined {
  const fields = fieldsOf(value);
  if (fields === undefined) return undefined;
  if (isReason(fields.unknown)) return { kind: "unknown", reason: fields.unknown };
  const throws = readSide(fields.throws);
  const rejects = readSide(fields.rejects);
  const list = listOf(fields.classes);
  if (throws === undefined || rejects === undefined || list === undefined) return undefined;
  const classes: ClassFact[] = [];
  for (const item of list) {
    const one = readClass(item);
    if (one === undefined) return undefined;
    classes.push(one);
  }
  return { kind: "known", sides: { throws, rejects }, classes };
}

function inferred(info: PackageInfo, entry: string, names: readonly string[]): Inferred {
  const relative = path.relative(info.root, entry).replaceAll("\\", "/");
  const cacheKey = `throws ${relative} ${names.join(".")}`;
  const key = `${packageKey(info)}\u0000${cacheKey}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  let cached = entries.get(packageKey(info));
  if (cached === undefined) {
    cached = new Map(readPackageCache(info.key));
    entries.set(packageKey(info), cached);
  }
  const stored = cached.get(cacheKey);
  const digest = fieldsOf(stored)?.sources;
  const hit =
    typeof digest === "string" && stillTheSame(info, digest, cached) ? fromJson(stored) : undefined;
  if (hit !== undefined) {
    cacheHits++;
    memo.set(key, hit);
    return hit;
  }
  inferences++;
  const found = inferFrom(info, entry, names);
  memo.set(key, found);
  const { files } = open(info, entry).source;
  const sources = sourcesOf(info, files.length > MAX_FILES ? [] : files);
  const value = toJson(found, sources.digest);
  const written = new Map<string, Json>([
    [cacheKey, value],
    [`sources ${sources.digest}`, sources.hashes],
  ]);
  for (const [name, one] of written) cached.set(name, one);
  verified.set(`${packageKey(info)}\u0000${sources.digest}`, true);
  // A failure to write costs the next run time, not facts.
  writePackageCache(info.key, written);
  return found;
}

// ---- the resolver -------------------------------------------------------------------------------

/** Finds the facts of the calls into packages of the file `ctx` summarizes. */
export function packageResolver(ctx: Pick<FileContext, "file" | "facts">): PackageResolver {
  const checked = new Map<string, PackageInfo | undefined>();
  return (call) => {
    const info = packageOf(call, ctx.file, checked);
    const names = pathOf(call.node);
    const fn = names.join(".") || call.id.slice(call.id.indexOf("#") + 1);
    const base = { name: call.name, version: info?.version ?? "", fn };
    const facts = (source: PackageFacts["source"], sides: Sides): PackageFacts => ({
      ...base,
      source,
      ...sides,
    });
    const unknown = (reason: UnknownReason): PackageFacts => {
      const set = side([], [reason]);
      return facts("unknown", { throws: set, rejects: set });
    };

    const fromConfig = ctx.facts[call.name];
    const entry = fromConfig?.[fn] ?? fromConfig?.[names.at(-1) ?? fn];
    if (entry !== undefined) {
      return {
        facts: facts("config", configured(entry, call.name, returnsPromise(call.node))),
        classes: [],
      };
    }
    // 2. Curated fact files: not shipped yet (`curatedFacts`).
    const tagged = declared(call);
    if (tagged !== undefined) return { facts: facts("declared", tagged), classes: [] };
    if (info === undefined) return { facts: unknown("no readable source"), classes: [] };
    const file = entryOf(call.file, info);
    if (file === undefined) return { facts: unknown("no readable source"), classes: [] };
    const read = inferred(info, file, names);
    return read.kind === "unknown"
      ? { facts: unknown(read.reason), classes: [] }
      : { facts: facts("inferred", read.sides), classes: read.classes };
  };
}
