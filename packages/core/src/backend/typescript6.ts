import path from "node:path";
import picomatch from "picomatch";
import ts from "typescript";
import type { ResultCache } from "../cache.js";
import {
  computeFingerprints,
  declarationTextHash,
  packageDependencies,
  packageEntries,
  packageManifests,
  packageNames,
} from "./fingerprints.js";
import { markedComments } from "./comments.js";
import type { MarkedComment } from "./comments.js";
import type { DependenciesOf, IsPackageEntry, PackageOf } from "./fingerprints.js";
import { recordInputs, recordingHost, replays } from "./program-record.js";
import type { HostQuery, ProgramRecord } from "./program-record.js";
import { declarationAtPath, declarationPath } from "./qualified-ids.js";
import { displayPath } from "../display-path.js";
import { expandTsconfigs } from "../tsconfigs.js";
import type {
  AliasRef,
  Config,
  FixForm,
  FixVerdict,
  Literal,
  NarrowedMembers,
  NarrowingTest,
  SymbolRef,
  TextEdit,
  TypeQueries,
} from "../types.js";

/** The tsconfig could not be read or is invalid. */
export class TsconfigError extends Error {
  /** The one change that fixes it, shown on a `= fix:` line. */
  readonly hint: string;

  constructor(message: string, hint: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TsconfigError";
    this.hint = hint;
  }
}

/**
 * TypeScript's own `lib.*.d.ts` files are not where TypeScript looks for them. Every standard type
 * (`Record`, `Array`, `Promise`) would be an error type, and rules that read them would report
 * nothing, so this stops the check instead.
 */
export class TypeScriptLibMissingError extends Error {
  readonly hint =
    "run stateward from an installed @stateward/language-server or the CLI, or set stateward.serverPath in VS Code to one";

  constructor(libFile: string) {
    super(`TypeScript's library file ${libFile} is missing`);
    this.name = "TypeScriptLibMissingError";
  }
}

/** The default library file the program would need, when it is not there; undefined when fine. */
export function missingDefaultLib(
  options: ts.CompilerOptions,
  fileExists: (file: string) => boolean,
): string | undefined {
  if (options.noLib === true) return undefined;
  const libFile = ts.getDefaultLibFilePath(options);
  return fileExists(libFile) ? undefined : libFile;
}

const MISSING_TSCONFIG_HINT =
  'point "tsconfig" in stateward.config.ts at your project\'s tsconfig.json';
const UNMATCHED_TSCONFIG_HINT =
  'correct the glob in "tsconfig" in stateward.config.ts (it is relative to the config\'s folder), or remove it';
const INVALID_TSCONFIG_HINT = "fix the tsconfig errors above, then run stateward check again";

/** The configured tsconfig, and every project it references, lists no file for stateward to check. */
export class NothingToCheckError extends Error {
  readonly hint =
    'point "tsconfig" in stateward.config.ts at a tsconfig that lists your source files, or widen "include"';

  constructor(tsconfig: string) {
    super(`\`${tsconfig}\` gives stateward no files to check`);
    this.name = "NothingToCheckError";
  }
}

/**
 * The own files of one TypeScript program, and the queries that answer for that program. The
 * program may not be built yet (a CLI run that proved it unchanged, `program-record.ts`): it is
 * built on the first call that needs it (`sourceFile`, `types`, `bind`).
 */
export type ProjectUnit = {
  /** The tsconfig of this project, absolute. */
  readonly tsconfig: string;
  /** The own files this project is the first to list and that its program has, in tsconfig order. */
  readonly files: readonly string[];
  /**
   * Whether another project lists `file` too: it is checked here only, with this project's
   * options, so a finding that depends on them says which project it was checked in.
   */
  listedElsewhere(file: string): boolean;
  sourceFile(file: string): ts.SourceFile | undefined;
  readonly types: TypeQueries;
  /**
   * The dependency fingerprint of one of `files` (backend/fingerprints.ts): equal fingerprints
   * mean equal inputs to every rule, so a result cached under it can be reused.
   */
  fingerprint(file: string): string | undefined;
  /**
   * The queries for the rules of one run on one of `files`: `types`, except that each node of
   * another file that `declarationOf` hands out is noted as read for `file` (`readsOf`). A new
   * object per call, so a plugin's memo kept by queries (a `WeakMap` on them) lasts one file's
   * rules: what it remembers was read, and noted, for that file.
   */
  typesFor(file: string): TypeQueries;
  /**
   * What a rule on `file` was handed of other files in this program, as read ids, sorted: the
   * qualified id of each declaration of an own file (`src/a.ts#load`), or the file's own id
   * (`src/a.ts#`, its whole text) for any other file, a module, a declaration whose id is placed by
   * offset, and a file `mentioned` says the results name (they keep its offsets: a comment added
   * above would move them).
   */
  readsOf(file: string, mentioned: (readFile: string) => boolean): readonly string[];
  /**
   * The hash of what a read id stands for in this program (`declarationTextHash`, or the whole
   * text for a file's own id); undefined when the program has no such declaration (renamed, moved,
   * removed). A result that read it holds while it is the same.
   */
  readFingerprint(read: string): string | undefined;
  /** The first syntax error of one of `files`, or undefined when it parses cleanly. */
  syntaxError(file: string): SyntaxError | undefined;
  /**
   * The imports of one of `files` whose module does not resolve (no file, no declaration, no
   * ambient or wildcard module), in source order. A side-effect import (`import "./a.css"`) brings
   * no types and is not listed.
   */
  unresolvedImports(file: string): readonly UnresolvedImport[];
  /**
   * Whether the project checks with `strictNullChecks` (its own setting, else `strict`, else
   * TypeScript 6's default, on). Read from the tsconfig: no program is built for it.
   */
  readonly strictNullChecks: boolean;
  /**
   * Whether `module` resolves to declarations (types) from the project's folder, by its options:
   * `react` does when `@types/react` or a typed `react` is installed. No program is built for it.
   */
  typesResolve(module: string): boolean;
  /**
   * Binds the program (creating its type checker), which gives every node its parent: call it
   * before a rule or a plugin sees a node of `files`. Parsing does not set parents.
   */
  bind(): void;
  /**
   * The comments of one of `files` that hold `stateward-ignore`, with the file's text: syntax
   * only, so it needs no type checker.
   */
  ignoreComments(file: string): { text: string; comments: readonly MarkedComment[] } | undefined;
  /**
   * Applies every candidate's edits together to a copy of this program's files and says, per
   * candidate, whether TypeScript reports an error on the lines it edits that the file did not
   * have before (`tryEdits`). The candidates must not overlap, except that two may make the same
   * edit (the same import), which is made once; the program itself is unchanged. An import the
   * edits leave unused is removed with them (`EditTrial`), so its "never used" is no new error.
   */
  tryEdits(candidates: readonly FixForm[]): EditTrial;
};

/** An error's message as one line: TypeScript's first line, which says the most. */
function firstLine(diagnostic: ts.Diagnostic): string {
  const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  return (text.split("\n")[0] ?? text).trim();
}

/**
 * The errors TypeScript reports for one file: syntax, then types. Types are checked even when a
 * line does not parse: fixes tried together share the file, and one fix that does not parse must
 * not hide another's type error.
 */
function errorsOf(program: ts.Program, sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  return [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ].filter((d) => d.category === ts.DiagnosticCategory.Error);
}

/** The key that tells an error that was there before from a new one: its code and its message. */
function errorKey(diagnostic: ts.Diagnostic): string {
  return `${String(diagnostic.code)}\u0000${firstLine(diagnostic)}`;
}

function countErrors(errors: readonly ts.Diagnostic[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const diagnostic of errors) {
    const key = errorKey(diagnostic);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Whether the program made `sourceFile` stand for another copy of the same package file. */
function isRedirect(sourceFile: ts.SourceFile): boolean {
  return "redirectInfo" in sourceFile && sourceFile.redirectInfo !== undefined;
}

type PlacedEdit = { candidate: number; edit: TextEdit };

/**
 * What trying candidates together showed: a verdict per candidate (a candidate that alone leaves
 * an import unused compiles with `removesImports`), and `cleanup`, every import the whole set
 * leaves unused, removed (`Checker.verifyFixSet`).
 */
export type EditTrial = { verdicts: readonly FixVerdict[]; cleanup: readonly TextEdit[] };

function sameEdit(a: TextEdit, b: TextEdit): boolean {
  return (
    a.location.start === b.location.start &&
    a.location.end === b.location.end &&
    a.newText === b.newText
  );
}

/** TypeScript's codes for a declaration that is never read: one name, a whole import, a type. */
const UNUSED_CODES: ReadonlySet<number> = new Set([6133, 6192, 6196]);

/** One name an import declaration binds: its local name and the node that binds it. */
type ImportBinding = { name: string; node: ts.Identifier; declaration: ts.ImportDeclaration };

function importBindingsOf(sourceFile: ts.SourceFile): readonly ImportBinding[] {
  const found: ImportBinding[] = [];
  for (const declaration of sourceFile.statements) {
    if (!ts.isImportDeclaration(declaration)) continue;
    const clause = declaration.importClause;
    if (clause === undefined) continue;
    const add = (node: ts.Identifier): void => {
      found.push({ name: node.text, node, declaration });
    };
    if (clause.name !== undefined) add(clause.name);
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) add(bindings.name);
    else for (const element of bindings.elements) add(element.name);
  }
  return found;
}

/**
 * Whether an identifier may refer to a binding of its name: not a property or member name, and
 * not the name an import binds. A shadowing local counts too, so a binding is never thought
 * unused when it is not; at worst an unused one is left in place.
 */
function mayReference(identifier: ts.Identifier, parent: ts.Node): boolean {
  if (ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
    return parent.propertyName !== identifier && !ts.isImportSpecifier(parent);
  }
  if (ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) {
    return ts.isPropertyAccessExpression(parent)
      ? parent.name !== identifier
      : parent.right !== identifier;
  }
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isJsxAttribute(parent)
  ) {
    return parent.name !== identifier;
  }
  if (ts.isBindingElement(parent)) return parent.propertyName !== identifier;
  return true;
}

/**
 * The positions of the identifiers in a file that may refer to a binding, by name. The parent is
 * passed down: an edited copy of a file is parsed without parent pointers.
 */
function referencesByName(sourceFile: ts.SourceFile): Map<string, number[]> {
  const found = new Map<string, number[]>();
  const visit = (node: ts.Node, parent: ts.Node): void => {
    if (ts.isIdentifier(node) && mayReference(node, parent)) {
      const list = found.get(node.text) ?? [];
      list.push(node.getStart(sourceFile));
      found.set(node.text, list);
    }
    ts.forEachChild(node, (child) => {
      visit(child, node);
    });
  };
  ts.forEachChild(sourceFile, (child) => {
    visit(child, sourceFile);
  });
  return found;
}

type Span = { start: number; end: number };

/** `[start, end)` of a statement with the line break after it, so no empty line is left. */
function statementRange(statement: ts.Statement, sourceFile: ts.SourceFile): Span {
  const { text } = sourceFile;
  let end = statement.end;
  if (text.startsWith("\r\n", end)) end += 2;
  else if (text.startsWith("\n", end)) end += 1;
  return { start: statement.getStart(sourceFile), end };
}

/**
 * The deletions that remove `removed` (names the declaration binds) from an import declaration:
 * the whole statement when nothing else is left, else each name with the comma that joins it to
 * its neighbour.
 */
function removalSpans(
  declaration: ts.ImportDeclaration,
  removed: ReadonlySet<string>,
  sourceFile: ts.SourceFile,
): Span[] {
  const clause = declaration.importClause;
  if (clause === undefined) return [];
  const bindings = clause.namedBindings;
  const elements =
    bindings !== undefined && ts.isNamedImports(bindings) ? [...bindings.elements] : [];
  const keptDefault = clause.name !== undefined && !removed.has(clause.name.text);
  const keptNamespace =
    bindings !== undefined && ts.isNamespaceImport(bindings) && !removed.has(bindings.name.text);
  const keptElements = elements.filter((element) => !removed.has(element.name.text));
  if (!keptDefault && !keptNamespace && keptElements.length === 0) {
    return [statementRange(declaration, sourceFile)];
  }
  const spans: Span[] = [];
  if (clause.name !== undefined && !keptDefault && bindings !== undefined) {
    // `import D, { A }` without `D`: `import { A }`.
    spans.push({ start: clause.name.getStart(sourceFile), end: bindings.getStart(sourceFile) });
  }
  const bindingsGone = bindings !== undefined && !keptNamespace && keptElements.length === 0;
  if (bindingsGone && clause.name !== undefined) {
    // `import D, { A }` without `A`: `import D`.
    spans.push({ start: clause.name.end, end: bindings.end });
    return spans;
  }
  const lastKept = elements.findLastIndex((element) => !removed.has(element.name.text));
  elements.forEach((element, at) => {
    if (!removed.has(element.name.text)) return;
    const next = elements[at + 1];
    const previous = elements[at - 1];
    if (at < lastKept && next !== undefined) {
      spans.push({ start: element.getStart(sourceFile), end: next.getStart(sourceFile) });
    } else if (previous !== undefined) {
      spans.push({ start: previous.end, end: element.end });
    }
  });
  return spans;
}

/** What `importCleanup` found: per candidate, the imports it alone leaves unused; for the set, all. */
type Cleanup = {
  byCandidate: Map<number, TextEdit[]>;
  set: TextEdit[];
  /** The import declarations (start offsets in the edited text) whose unused names are cleaned. */
  cleaned: Span[];
};

/**
 * The imports the candidates' edits leave unused: a name some candidate's replaced text referred
 * to that nothing refers to in the edited text. An import a candidate edits itself is left alone.
 * A name only one candidate referred to is that candidate's to remove (alone it leaves it unused
 * too); a name several referred to is unused only when they are applied together.
 */
function importCleanup(
  before: ts.SourceFile,
  after: ts.SourceFile,
  placed: readonly PlacedEdit[],
  toAfter: (offset: number) => number,
): Cleanup {
  const empty: Cleanup = { byCandidate: new Map(), set: [], cleaned: [] };
  const bindings = importBindingsOf(before);
  if (bindings.length === 0) return empty;
  const touches = (declaration: ts.ImportDeclaration): boolean =>
    placed.some(
      ({ edit: { location } }) =>
        location.start <= declaration.end && declaration.getStart(before) <= location.end,
    );
  const referencedBefore = referencesByName(before);
  const owners = new Map<ImportBinding, Set<number>>();
  for (const binding of bindings) {
    if (touches(binding.declaration)) continue;
    const at = referencedBefore.get(binding.name) ?? [];
    for (const { candidate, edit } of placed) {
      if (at.some((offset) => offset >= edit.location.start && offset < edit.location.end)) {
        owners.set(binding, (owners.get(binding) ?? new Set()).add(candidate));
      }
    }
  }
  if (owners.size === 0) return empty;
  const referencedAfter = referencesByName(after);
  const unused = [...owners].filter(([binding]) => !referencedAfter.has(binding.name));
  if (unused.length === 0) return empty;
  const file = placed[0]?.edit.location.file ?? before.fileName;
  const edits = (byDeclaration: Map<ts.ImportDeclaration, Set<string>>): TextEdit[] =>
    [...byDeclaration].flatMap(([declaration, removed]) =>
      removalSpans(declaration, removed, before).map((span) => ({
        location: { file, start: span.start, end: span.end },
        newText: "",
      })),
    );
  const group = (list: readonly ImportBinding[]): Map<ts.ImportDeclaration, Set<string>> => {
    const byDeclaration = new Map<ts.ImportDeclaration, Set<string>>();
    for (const binding of list) {
      byDeclaration.set(
        binding.declaration,
        (byDeclaration.get(binding.declaration) ?? new Set()).add(binding.name),
      );
    }
    return byDeclaration;
  };
  const byCandidate = new Map<number, TextEdit[]>();
  const alone = new Map<number, ImportBinding[]>();
  for (const [binding, set] of unused) {
    const [only] = set;
    if (set.size === 1 && only !== undefined) {
      alone.set(only, [...(alone.get(only) ?? []), binding]);
    }
  }
  for (const [candidate, list] of alone) byCandidate.set(candidate, edits(group(list)));
  const declarations = [...new Set(unused.map(([binding]) => binding.declaration))];
  return {
    byCandidate,
    set: edits(group(unused.map(([binding]) => binding))),
    cleaned: declarations.map((declaration) => ({
      start: toAfter(declaration.getStart(before)),
      end: toAfter(declaration.end),
    })),
  };
}

/**
 * `tryEdits` for one program: one more program, built on `program` (so every file the edits do not
 * touch is reused as it is), serves the edited texts. A new error is attributed to the candidate
 * whose edited lines it starts on; a syntax error outside every candidate's lines breaks every
 * candidate of that file, since it cannot be told which caused it (the caller tries each alone).
 */
function tryEditsOn(
  program: ts.Program,
  host: ts.CompilerHost,
  candidates: readonly FixForm[],
): EditTrial {
  const verdicts: FixVerdict[] = candidates.map(() => ({ kind: "compiles" }));
  const cleanup: TextEdit[] = [];
  const byFile = new Map<string, PlacedEdit[]>();
  candidates.forEach(({ edits }, candidate) => {
    for (const edit of edits) {
      const file = toTypeScriptPath(edit.location.file);
      const list = byFile.get(file) ?? [];
      list.push({ candidate, edit });
      byFile.set(file, list);
    }
  });
  const texts = new Map<string, string>();
  /** Per edited file, each candidate's edited ranges in the new text. */
  const ranges = new Map<string, { candidate: number; start: number; end: number }[]>();
  /** Per edited file, the edits placed in it and how an offset of the old text moves. */
  const moves = new Map<string, { placed: PlacedEdit[]; toAfter: (offset: number) => number }>();
  /** Files a fix creates: edits at the start of a file that does not exist yet. */
  const created = new Set<string>();
  for (const [file, placed] of byFile) {
    const sourceFile = program.getSourceFile(file);
    const creates =
      sourceFile === undefined &&
      !host.fileExists(file) &&
      placed.every(({ edit: { location } }) => location.start === 0 && location.end === 0);
    if (creates) created.add(file);
    const text = creates ? "" : sourceFile?.text;
    const fits = placed.every(
      ({ edit: { location } }) =>
        text !== undefined &&
        location.start >= 0 &&
        location.start <= location.end &&
        location.end <= text.length,
    );
    if (text === undefined || !fits) {
      const reason =
        text === undefined
          ? `${path.basename(file)} is not part of the program`
          : `an edit lies outside ${path.basename(file)}`;
      for (const { candidate } of placed) verdicts[candidate] = { kind: "unchecked", reason };
      continue;
    }
    const sorted = [...placed].sort(
      (a, b) =>
        a.edit.location.start - b.edit.location.start ||
        a.edit.location.end - b.edit.location.end ||
        (a.edit.newText < b.edit.newText ? -1 : a.edit.newText > b.edit.newText ? 1 : 0) ||
        a.candidate - b.candidate,
    );
    let next = "";
    let at = 0;
    const spans: { candidate: number; start: number; end: number }[] = [];
    const shifts: { end: number; delta: number }[] = [];
    let previous: PlacedEdit | undefined;
    for (const entry of sorted) {
      const { candidate, edit } = entry;
      const last = spans.at(-1);
      // Two fixes that make the same edit (the same import) share it: it is made once.
      if (previous !== undefined && last !== undefined && sameEdit(previous.edit, edit)) {
        spans.push({ candidate, start: last.start, end: last.end });
        continue;
      }
      next += text.slice(at, edit.location.start);
      const start = next.length;
      next += edit.newText;
      spans.push({ candidate, start, end: next.length });
      shifts.push({
        end: edit.location.end,
        delta: edit.newText.length - (edit.location.end - edit.location.start),
      });
      at = edit.location.end;
      previous = entry;
    }
    next += text.slice(at);
    texts.set(file, next);
    ranges.set(file, spans);
    moves.set(file, {
      placed,
      toAfter: (offset) =>
        offset + shifts.reduce((sum, shift) => (shift.end <= offset ? sum + shift.delta : sum), 0),
    });
  }
  if (texts.size === 0) return { verdicts, cleanup };
  const edited: ts.CompilerHost = {
    ...host,
    fileExists: (fileName) => texts.has(fileName) || host.fileExists(fileName),
    readFile: (fileName) => texts.get(fileName) ?? host.readFile(fileName),
    getSourceFile: (fileName, requested, onError) => {
      const text = texts.get(fileName);
      if (text !== undefined) return ts.createSourceFile(fileName, text, requested, false);
      const kept = program.getSourceFile(fileName);
      // A package installed twice is one file to TypeScript: the program holds the second copy as
      // a "redirect" to the first, which a host must not hand back (TypeScript asserts it).
      if (kept !== undefined && !isRedirect(kept)) return kept;
      return host.getSourceFile(fileName, requested, onError);
    },
  };
  const copy = ts.createProgram({
    rootNames: program.getRootFileNames(),
    options: program.getCompilerOptions(),
    host: edited,
    oldProgram: program,
  });
  for (const [file, spans] of ranges) {
    const before = program.getSourceFile(file);
    const after = copy.getSourceFile(file);
    if (created.has(file) && after !== undefined) {
      // Every error in a file the fix writes is the fix's own.
      const [error] = errorsOf(copy, after);
      if (error === undefined) continue;
      for (const { candidate } of spans) {
        if (verdicts[candidate]?.kind === "compiles") {
          verdicts[candidate] = { kind: "breaks", error: firstLine(error) };
        }
      }
      continue;
    }
    if (before === undefined || after === undefined) continue;
    // A fix that changes a declaration's type answers for every line of the files it edits.
    const lines = spans.map((span) =>
      candidates[span.candidate]?.changesType === true
        ? { candidate: span.candidate, first: 0, last: Number.POSITIVE_INFINITY }
        : {
            candidate: span.candidate,
            first: after.getLineAndCharacterOfPosition(span.start).line,
            last: after.getLineAndCharacterOfPosition(span.end).line,
          },
    );
    const syntaxErrors: ReadonlySet<ts.Diagnostic> = new Set(copy.getSyntacticDiagnostics(after));
    const move = moves.get(file);
    const cleaned =
      move === undefined || syntaxErrors.size > 0
        ? undefined
        : importCleanup(before, after, move.placed, move.toAfter);
    if (cleaned !== undefined) {
      cleanup.push(...cleaned.set);
      for (const [candidate, edits] of cleaned.byCandidate) {
        const verdict = verdicts[candidate];
        if (verdict?.kind === "compiles") {
          verdicts[candidate] = {
            kind: "compiles",
            removesImports: [...(verdict.removesImports ?? []), ...edits],
          };
        }
      }
    }
    // An import the edits leave unused is removed with them: its "never used" is not their error.
    const removed = (diagnostic: ts.Diagnostic): boolean =>
      UNUSED_CODES.has(diagnostic.code) &&
      diagnostic.start !== undefined &&
      (cleaned?.cleaned ?? []).some(
        (span) =>
          diagnostic.start !== undefined &&
          diagnostic.start >= span.start &&
          diagnostic.start < span.end,
      );
    const errors = errorsOf(copy, after).filter((diagnostic) => !removed(diagnostic));
    const suspects = errors.flatMap((diagnostic) => {
      const line =
        diagnostic.start === undefined
          ? undefined
          : after.getLineAndCharacterOfPosition(diagnostic.start).line;
      const owners = lines.filter(
        (span) => line !== undefined && line >= span.first && line <= span.last,
      );
      const blamed = owners.length > 0 ? owners : syntaxErrors.has(diagnostic) ? lines : [];
      return blamed.length > 0 ? [{ diagnostic, blamed }] : [];
    });
    // Most fixes compile: the file's errors before the edit (a second full check of the file)
    // are read only when there is an error to tell apart from one that was already there.
    if (suspects.length === 0) continue;
    const now = countErrors(errors);
    const was = countErrors(errorsOf(program, before));
    for (const { diagnostic, blamed } of suspects) {
      const key = errorKey(diagnostic);
      if ((now.get(key) ?? 0) <= (was.get(key) ?? 0)) continue;
      for (const { candidate } of blamed) {
        if (verdicts[candidate]?.kind === "compiles") {
          verdicts[candidate] = { kind: "breaks", error: firstLine(diagnostic) };
        }
      }
    }
  }
  return { verdicts, cleanup };
}

/** The first syntax error TypeScript found in a file; `line` and `column` count from 1. */
export type SyntaxError = {
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
};

/** An import whose module does not resolve: the specifier as written, and where it is. */
export type UnresolvedImport = {
  readonly specifier: string;
  /** `missing`: nothing found; `untyped`: it resolves to JavaScript that has no types. */
  readonly kind: "missing" | "untyped";
  readonly start: number;
  readonly end: number;
};

function unresolvedImportsOf(program: ts.Program, file: string): readonly UnresolvedImport[] {
  const sourceFile = program.getSourceFile(file);
  if (sourceFile === undefined) return [];
  const checker = program.getTypeChecker();
  const found: UnresolvedImport[] = [];
  const consider = (specifier: ts.Expression | undefined): void => {
    if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return;
    if (checker.getSymbolAtLocation(specifier) !== undefined) return;
    const options = program.getCompilerOptions();
    const resolved = ts.resolveModuleName(
      specifier.text,
      sourceFile.fileName,
      options,
      ts.sys,
      undefined,
      undefined,
      ts.getModeForUsageLocation(sourceFile, specifier, options),
    ).resolvedModule;
    found.push({
      specifier: specifier.text,
      kind: resolved === undefined ? "missing" : "untyped",
      start: specifier.getStart(sourceFile),
      end: specifier.getEnd(),
    });
  };
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause !== undefined) consider(statement.moduleSpecifier);
    } else if (ts.isExportDeclaration(statement)) {
      consider(statement.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      consider(statement.moduleReference.expression);
    }
  }
  return found;
}

/** Whether a project with these options checks with `strictNullChecks` (TypeScript 6: on unless turned off). */
export function checksNulls(options: ts.CompilerOptions): boolean {
  return options.strictNullChecks ?? options.strict ?? true;
}

const TYPED_EXTENSIONS: ReadonlySet<string> = new Set([
  ts.Extension.Dts,
  ts.Extension.Dmts,
  ts.Extension.Dcts,
  ts.Extension.Ts,
  ts.Extension.Tsx,
  ts.Extension.Mts,
  ts.Extension.Cts,
]);

/** `ProjectUnit.typesResolve` for a project, remembered by module name. */
function typesResolver(tsconfig: string, options: ts.CompilerOptions): (module: string) => boolean {
  const known = new Map<string, boolean>();
  // A file that need not exist: resolution only looks at its folder and above.
  const from = path.join(path.dirname(tsconfig), "__stateward_types__.ts");
  return (module) => {
    const before = known.get(module);
    if (before !== undefined) return before;
    const resolved = ts.resolveModuleName(module, from, options, ts.sys).resolvedModule;
    const typed = resolved !== undefined && TYPED_EXTENSIONS.has(resolved.extension);
    known.set(module, typed);
    return typed;
  };
}

function firstSyntaxError(program: ts.Program, file: string): SyntaxError | undefined {
  const sourceFile = program.getSourceFile(file);
  if (sourceFile === undefined) return undefined;
  const [first] = program.getSyntacticDiagnostics(sourceFile);
  if (first === undefined) return undefined;
  const { start } = first;
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    message: ts.flattenDiagnosticMessageText(first.messageText, " "),
    start,
    end: start + first.length,
    line: line + 1,
    column: character + 1,
  };
}

export type Backend = {
  /** One unit per project that has own files, in references order (depth first). */
  open(overlays: ReadonlyMap<string, string>): readonly ProjectUnit[];
  /**
   * Lets go of the programs (and the parsed files kept to build the next ones on): the next
   * `open` builds them from nothing. For a caller that asks nothing more of this run's units.
   */
  release(): void;
  /**
   * The same units as the last `open`, for the editor's fast pass: the file lists and the text of
   * every file that is not in `overlays` are taken from that run, not read from disk again (a
   * change on disk is for the next `open`). Behaves as `open` when none ran yet.
   */
  reopen(overlays: ReadonlyMap<string, string>): readonly ProjectUnit[];
};

/**
 * TypeScript names files with forward slashes on every platform; callers (an editor on Windows)
 * may pass backslashes. Every path entering the backend goes through this.
 */
export function toTypeScriptPath(file: string): string {
  return file.replaceAll("\\", "/");
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n");
}

/** TS18002: the "files" list is empty. TS18003: no inputs were found. */
const NO_INPUT_CODES: ReadonlySet<number> = new Set([18002, 18003]);

/** The folder of a tsconfig, in TypeScript's form, whichever slashes the path came with. */
export function tsconfigDirectory(tsconfigPath: string): string {
  return path.posix.dirname(toTypeScriptPath(tsconfigPath));
}

function readTsconfig(given: string): ts.ParsedCommandLine {
  // TypeScript compares the config's name with the one it was given (and asserts they are equal),
  // so the same form, forward slashes, goes to every call; a Windows path would break that.
  const tsconfigPath = toTypeScriptPath(given);
  if (!ts.sys.fileExists(tsconfigPath)) {
    throw new TsconfigError(`tsconfig not found: ${tsconfigPath}`, MISSING_TSCONFIG_HINT);
  }
  const read = ts.readConfigFile(tsconfigPath, (file) => ts.sys.readFile(file));
  if (read.error !== undefined) {
    throw new TsconfigError(
      `invalid tsconfig ${tsconfigPath}:\n${formatDiagnostics([read.error])}`,
      INVALID_TSCONFIG_HINT,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    tsconfigDirectory(tsconfigPath),
    undefined,
    tsconfigPath,
  );
  // "no inputs" is not a tsconfig error: a solution tsconfig has none, and an empty result is
  // reported once for the whole run as a NothingToCheckError.
  const errors = parsed.errors.filter((error) => !NO_INPUT_CODES.has(error.code));
  if (errors.length > 0) {
    throw new TsconfigError(
      `invalid tsconfig ${tsconfigPath}:\n${formatDiagnostics(errors)}`,
      INVALID_TSCONFIG_HINT,
    );
  }
  return parsed;
}

type CachedSource = { text: string; sourceFile: ts.SourceFile };

/**
 * Parsed library files (TypeScript's own lib.*.d.ts and anything under node_modules, such as
 * `@types/react`), shared by every backend in the process: they are large, the user never edits
 * them, and a source file is reused only when its text and options are the same. Parsing them
 * dominates a check of a small project, so one parse serves every later check.
 */
const libraryCache = new Map<string, CachedSource>();
const DEFAULT_LIB_DIRECTORY = toTypeScriptPath(path.dirname(ts.getDefaultLibFilePath({})));

function isLibraryFile(fileName: string): boolean {
  return isTypeScriptLib(fileName) || fileName.includes("/node_modules/");
}

function isTypeScriptLib(fileName: string): boolean {
  return fileName.startsWith(DEFAULT_LIB_DIRECTORY);
}

/**
 * What decides whether a cached source file still fits: how it is parsed. The options object
 * TypeScript passes also carries package.json data that changes while it resolves modules, so
 * comparing it whole (as JSON) made every `@types` file miss, and a program that had to re-parse
 * a file never reused the old one.
 */
function parseKey(
  languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
  options: ts.CompilerOptions,
): string {
  const { languageVersion, impliedNodeFormat, jsDocParsingMode } =
    typeof languageVersionOrOptions === "number"
      ? {
          languageVersion: languageVersionOrOptions,
          impliedNodeFormat: undefined,
          jsDocParsingMode: undefined,
        }
      : languageVersionOrOptions;
  return JSON.stringify([
    languageVersion,
    impliedNodeFormat,
    jsDocParsingMode,
    options.moduleDetection,
    options.jsx,
  ]);
}

/**
 * Serves the unsaved `overlays`. A source file is parsed again only when its text changed, so a
 * program built with `oldProgram` can reuse what did not.
 */
export function hostWithOverlays(
  options: ts.CompilerOptions,
  overlays: ReadonlyMap<string, string>,
  cache: Map<string, CachedSource>,
  /** Serve a file that is not in `overlays` from `cache` without reading it from disk. */
  trustCache = false,
  /** Parse the JSDoc of TypeScript files too: a rule that is on reads it (`RuleMeta.needsJsDoc`). */
  jsDoc = false,
  /**
   * The files kept in the process-wide `libraryCache` rather than in `cache`. A package's own
   * JavaScript (`openPackageSource`) goes in `cache`, so it is freed with the package's program:
   * kept for the process, the packages a first run reads held over 500 MB on a large app.
   */
  shared: (fileName: string) => boolean = isLibraryFile,
): ts.CompilerHost {
  const base = ts.createCompilerHost(options, true);
  return {
    ...base,
    // As tsc itself: JSDoc is parsed where it matters to types (JavaScript files), not in
    // TypeScript files, unless a rule that is on reads it (the Errors pack's `@throws`).
    jsDocParsingMode: jsDoc ? ts.JSDocParsingMode.ParseAll : ts.JSDocParsingMode.ParseForTypeErrors,
    fileExists: (fileName) => overlays.has(fileName) || base.fileExists(fileName),
    readFile: (fileName) => overlays.get(fileName) ?? base.readFile(fileName),
    getSourceFile: (fileName, requested, onError) => {
      const library = isLibraryFile(fileName);
      // Rules read the JSDoc of the project's own files only: library files keep tsc's mode,
      // which is cheaper (lib.dom.d.ts is mostly JSDoc) and shares them with other programs.
      const languageVersionOrOptions =
        library && typeof requested !== "number"
          ? { ...requested, jsDocParsingMode: ts.JSDocParsingMode.ParseForTypeErrors }
          : requested;
      const optionsKey = parseKey(languageVersionOrOptions, options);
      const store = shared(fileName) ? libraryCache : cache;
      // By parse settings and name: two projects (a Vite app and its node config) read the same
      // library file with different settings, and one entry per name made each evict the other,
      // so every program parsed TypeScript's lib files and @types/react again.
      const key = `${optionsKey}\u0000${fileName}`;
      if (trustCache && !overlays.has(fileName)) {
        const kept = store.get(key);
        if (kept !== undefined) return kept.sourceFile;
      }
      const text = overlays.get(fileName) ?? base.readFile(fileName);
      if (text === undefined) return undefined;
      const cached = store.get(key);
      if (cached?.text === text) return cached.sourceFile;
      try {
        // No parent pointers here: the binder sets them when the type checker is created
        // (`ProjectUnit.bind`), and setting them twice was a tenth of parsing. A run answered
        // from the cache never binds.
        const sourceFile = ts.createSourceFile(fileName, text, languageVersionOrOptions, false);
        store.set(key, { text, sourceFile });
        return sourceFile;
      } catch (error) {
        onError?.(error instanceof Error ? error.message : String(error));
        return undefined;
      }
    },
  };
}

/**
 * The host a recorded program is replayed against: the disk, with `overlays` in front of it as
 * `hostWithOverlays` serves them (an overlay exists, and its text is what is read), so a replay
 * answers as the build it stands for would have.
 */
function replayHost(
  options: ts.CompilerOptions,
  overlays: ReadonlyMap<string, string>,
): ts.CompilerHost {
  const base = ts.createCompilerHost(options, false);
  if (overlays.size === 0) return base;
  return {
    ...base,
    fileExists: (fileName) => overlays.has(fileName) || base.fileExists(fileName),
    readFile: (fileName) => overlays.get(fileName) ?? base.readFile(fileName),
  };
}

function matcher(patterns: readonly string[]): (relativePath: string) => boolean {
  if (patterns.length === 0) return () => false;
  return picomatch([...patterns], { dot: true });
}

/** The files of `parsed` that stateward checks and no earlier project has claimed. */
function ownFileNames(
  parsed: ts.ParsedCommandLine,
  config: Config,
  cwd: string,
  claimed: ReadonlySet<string>,
): string[] {
  const included = matcher(config.include);
  const excluded = matcher(config.exclude);
  const own: string[] = [];
  for (const file of parsed.fileNames) {
    if (claimed.has(file)) continue;
    const relative = path.relative(cwd, file).split(path.sep).join("/");
    const generated = file.endsWith(".d.ts") || file.includes("/node_modules/");
    if (!generated && included(relative) && !excluded(relative)) own.push(file);
  }
  return own;
}

/**
 * An array, a tuple, or a type read by position like one: a number index signature and a numeric
 * `length`, and no string index signature (`RegExpMatchArray`, a DOM `FileList`, a class that
 * extends `Array`). Its reads are positions, not keyed lookups.
 */
function isArrayLike(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (checker.isArrayType(type) || checker.isTupleType(type)) return true;
  if (checker.getIndexInfoOfType(type, ts.IndexKind.String) !== undefined) return false;
  if (checker.getIndexInfoOfType(type, ts.IndexKind.Number) === undefined) return false;
  const length = checker.getPropertyOfType(type, "length");
  if (length === undefined) return false;
  return (checker.getTypeOfSymbol(length).flags & ts.TypeFlags.NumberLike) !== 0;
}

function compareLabels(a: Literal, b: Literal): number {
  if (a.label < b.label) return -1;
  return a.label > b.label ? 1 : 0;
}

function literalOf(checker: ts.TypeChecker, member: ts.Type): Literal | undefined {
  const label = checker.typeToString(member);
  if (member.isStringLiteral() || member.isNumberLiteral()) return { value: member.value, label };
  if (member.flags & ts.TypeFlags.BooleanLiteral) return { value: label === "true", label };
  if (member.flags & ts.TypeFlags.Null) return { value: null, label };
  if (member.flags & ts.TypeFlags.Undefined) return { value: undefined, label };
  return undefined;
}

/** The types compared by value: `===` on two of them never tells apart equal values. */
const PRIMITIVE_FLAGS =
  ts.TypeFlags.StringLike |
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.EnumLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void;

function widened(checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined {
  return type.isTypeParameter() ? checker.getBaseConstraintOfType(type) : type;
}

/**
 * The alias that declares every member of `type` (a union is taken apart; `Result<T, E>` is the
 * union of two object literals written inside the alias), or undefined when a member is written
 * anywhere else or the members belong to different aliases.
 */
function sharedAlias(type: ts.Type): { name: string; file: string } | undefined {
  const members = type.isUnion() ? type.types : [type];
  let found: ts.TypeAliasDeclaration | undefined;
  for (const member of members) {
    const alias = aliasOfLiteral(member.getSymbol()?.declarations?.[0]);
    if (alias === undefined || (found !== undefined && found !== alias)) return undefined;
    found = alias;
  }
  return found === undefined
    ? undefined
    : { name: found.name.text, file: found.getSourceFile().fileName };
}

/** The alias an object literal type is written in, directly or as a member of a union. */
function aliasOfLiteral(
  declaration: ts.Declaration | undefined,
): ts.TypeAliasDeclaration | undefined {
  if (declaration === undefined || !ts.isTypeLiteralNode(declaration)) return undefined;
  let parent: ts.Node = declaration.parent;
  while (ts.isUnionTypeNode(parent) || ts.isParenthesizedTypeNode(parent)) parent = parent.parent;
  return ts.isTypeAliasDeclaration(parent) ? parent : undefined;
}

function aliasOfType(checker: ts.TypeChecker, type: ts.Type): AliasRef | undefined {
  const awaited = checker.getAwaitedType(type) ?? type;
  const alias = sharedAlias(awaited);
  return alias === undefined ? undefined : { ...alias, promised: awaited !== type };
}

/** Whether awaiting the type gives another one; `any` and `unknown` await to themselves. */
function isPromiseType(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
  const awaited = checker.getAwaitedType(type);
  return awaited !== undefined && awaited !== type;
}

const NULLISH = ts.TypeFlags.Null | ts.TypeFlags.Undefined;

/** The property a stated guarantee is written in (`TypeQueries.guaranteesOf`). */
const GUARANTEE_PROPERTY = "__guarantee";

/** The guarantee names of one type that is not a union: its optional `__guarantee` literals. */
function memberGuarantees(checker: ts.TypeChecker, type: ts.Type): readonly string[] {
  const property = checker.getPropertyOfType(type, GUARANTEE_PROPERTY);
  if (property === undefined || !(property.flags & ts.SymbolFlags.Optional)) return [];
  const value = checker.getTypeOfSymbol(property);
  const names: string[] = [];
  for (const part of value.isUnion() ? value.types : [value]) {
    if (part.flags & NULLISH) continue;
    if (!part.isStringLiteral()) return [];
    names.push(part.value);
  }
  return names;
}

/**
 * The guarantees every member of `type` states (`null` and `undefined` left out), sorted. A
 * member that states none makes the whole type state none.
 */
function guaranteesOfType(checker: ts.TypeChecker, found: ts.Type): readonly string[] {
  const type = widened(checker, found);
  if (type === undefined) return [];
  const members = (type.isUnion() ? type.types : [type]).filter(
    (member) => (member.flags & NULLISH) === 0,
  );
  let shared: string[] | undefined;
  for (const member of members) {
    const names = memberGuarantees(checker, member);
    shared = shared === undefined ? [...names] : shared.filter((name) => names.includes(name));
    if (shared.length === 0) return [];
  }
  return [...new Set(shared ?? [])].sort();
}

/** The declared type of a declaration: a variable's or property's type, or a type alias's. */
function declaredTypeOf(checker: ts.TypeChecker, declaration: ts.Node): ts.Type | undefined {
  const name =
    ts.isDeclarationStatement(declaration) || ts.isVariableDeclaration(declaration)
      ? ts.getNameOfDeclaration(declaration)
      : undefined;
  const symbol = name === undefined ? undefined : checker.getSymbolAtLocation(name);
  if (symbol === undefined) return checker.getTypeAtLocation(declaration);
  return symbol.flags & ts.SymbolFlags.Value
    ? checker.getTypeOfSymbol(symbol)
    : checker.getDeclaredTypeOfSymbol(symbol);
}

/** A string, number or boolean literal, or an enum member: a type with exactly one value. */
function isUnitLiteral(type: ts.Type): boolean {
  return (
    type.isStringLiteral() ||
    type.isNumberLiteral() ||
    (type.flags & ts.TypeFlags.BooleanLiteral) !== 0
  );
}

/**
 * The declarations of the members of a union of enum members (or of one member): they sit in
 * their enum, so they tell where it is. Undefined when a member is not an enum member.
 */
function enumMemberDeclarations(type: ts.Type): readonly ts.Declaration[] | undefined {
  const members = type.isUnion() ? type.types : [type];
  if (!members.every((member) => member.flags & ts.TypeFlags.EnumLiteral)) return undefined;
  return members.flatMap((member) => member.getSymbol()?.declarations ?? []);
}

/** One unit literal, or a union of them (`"rect" | "ellipse"`): a tag TypeScript narrows by. */
function isLiteralTag(type: ts.Type): boolean {
  return type.isUnion() ? type.types.every(isUnitLiteral) : isUnitLiteral(type);
}

/**
 * A mapped type (`Record<K, V>`, `{ [P in K]: V }`) that lists no property and has no index
 * signature: its keys come from a type parameter, so they are not known here.
 */
function hasGenericKeys(checker: ts.TypeChecker, type: ts.Type): boolean {
  const parts = type.isIntersection() ? type.types : [type];
  return parts.some(
    (part) =>
      part.getSymbol()?.declarations?.some(ts.isMappedTypeNode) === true &&
      checker.getPropertiesOfType(part).length === 0 &&
      checker.getIndexInfosOfType(part).length === 0,
  );
}

function includesUndefined(type: ts.Type): boolean {
  const open = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Undefined | ts.TypeFlags.Void;
  return (type.isUnion() ? type.types : [type]).some((member) => (member.flags & open) !== 0);
}

const READONLY_COLLECTIONS: ReadonlySet<string> = new Set([
  "ReadonlyMap",
  "ReadonlySet",
  "ReadonlyArray",
]);

function isReadonlyPart(program: ts.Program, checker: ts.TypeChecker, type: ts.Type): boolean {
  const resolved = widened(checker, type);
  if (resolved === undefined) return false;
  if (resolved.isIntersection()) {
    return resolved.types.every((member) => isReadonlyPart(program, checker, member));
  }
  if (!(resolved.flags & ts.TypeFlags.Object)) return false;
  const declaration = resolved.getSymbol()?.declarations?.[0];
  if (
    declaration !== undefined &&
    READONLY_COLLECTIONS.has(resolved.getSymbol()?.getName() ?? "") &&
    program.isSourceFileDefaultLibrary(declaration.getSourceFile())
  ) {
    return true;
  }
  if (checker.getSignaturesOfType(resolved, ts.SignatureKind.Call).length > 0) return false;
  if (checker.getSignaturesOfType(resolved, ts.SignatureKind.Construct).length > 0) return false;
  const indexes = checker.getIndexInfosOfType(resolved);
  const properties = checker.getPropertiesOfType(resolved);
  return (
    indexes.length > 0 &&
    indexes.every((info) => info.isReadonly) &&
    properties.every(
      (property) =>
        !(property.flags & ts.SymbolFlags.Method) &&
        (property.declarations ?? []).every(
          (declaration) =>
            (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) !== 0,
        ),
    )
  );
}

/** Every member of the type, ignoring `null` and `undefined`, is a readonly view. */
function isReadonlyView(program: ts.Program, checker: ts.TypeChecker, type: ts.Type): boolean {
  const nothing = ts.TypeFlags.Null | ts.TypeFlags.Undefined;
  const members = (type.isUnion() ? type.types : [type]).filter(
    (member) => !(member.flags & nothing),
  );
  return members.length > 0 && members.every((member) => isReadonlyPart(program, checker, member));
}

const TYPEOF_NAMES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined",
  "object",
  "function",
]);

/** What `typeof` gives for a value of this member type, or undefined when that is not certain. */
function typeofResult(checker: ts.TypeChecker, member: ts.Type): string | undefined {
  const flags = member.flags;
  if (flags & ts.TypeFlags.StringLike) return "string";
  if (flags & ts.TypeFlags.NumberLike) return "number";
  if (flags & ts.TypeFlags.BigIntLike) return "bigint";
  if (flags & ts.TypeFlags.BooleanLike) return "boolean";
  if (flags & ts.TypeFlags.ESSymbolLike) return "symbol";
  if (flags & ts.TypeFlags.Undefined) return "undefined";
  if (flags & ts.TypeFlags.Null) return "object";
  if (flags & ts.TypeFlags.Object) {
    const callable =
      checker.getSignaturesOfType(member, ts.SignatureKind.Call).length > 0 ||
      checker.getSignaturesOfType(member, ts.SignatureKind.Construct).length > 0;
    return callable ? "function" : "object";
  }
  return undefined;
}

/** The class or interface symbols a type extends or implements, itself included. */
function derivesFrom(
  checker: ts.TypeChecker,
  type: ts.Type,
  target: ts.Symbol,
  seen: Set<ts.Symbol>,
): boolean {
  const symbol = type.getSymbol();
  if (symbol === undefined || seen.has(symbol)) return false;
  if (symbol === target) return true;
  seen.add(symbol);
  const declared = checker.getDeclaredTypeOfSymbol(symbol);
  if (!declared.isClassOrInterface()) return false;
  return checker.getBaseTypes(declared).some((base) => derivesFrom(checker, base, target, seen));
}

const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(["Object", "Function", "Array"]);

/**
 * The class symbol that `x instanceof <expression>` removes, or undefined when TypeScript's
 * narrowing there is not the plain "derived from this class" (a custom `Symbol.hasInstance`, a
 * constructor type with no single instance type, `Object`, `Function` and `Array`, which it treats
 * specially).
 */
function instanceSymbol(
  program: ts.Program,
  checker: ts.TypeChecker,
  expression: ts.Expression,
): ts.Symbol | undefined {
  const constructorType = checker.getTypeAtLocation(expression);
  if (
    checker
      .getPropertiesOfType(constructorType)
      .some((p) => p.getName().startsWith("__@hasInstance"))
  ) {
    return undefined;
  }
  const signatures = constructorType.getConstructSignatures();
  const [first] = signatures;
  if (first === undefined) return undefined;
  const instance = first.getReturnType().getSymbol();
  if (instance === undefined) return undefined;
  if (signatures.some((signature) => signature.getReturnType().getSymbol() !== instance)) {
    return undefined;
  }
  const declaration = instance.declarations?.[0];
  if (
    declaration !== undefined &&
    program.isSourceFileDefaultLibrary(declaration.getSourceFile()) &&
    GLOBAL_OBJECTS.has(instance.getName())
  ) {
    return undefined;
  }
  return instance;
}

function isObjectLike(type: ts.Type): boolean {
  return (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0;
}

/** Whether the member is among the types the narrowing forms can place (not `any`, a type parameter, ...). */
function isSettled(type: ts.Type): boolean {
  const known =
    ts.TypeFlags.StringLike |
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.BigIntLike |
    ts.TypeFlags.BooleanLike |
    ts.TypeFlags.ESSymbolLike |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Null |
    ts.TypeFlags.Object |
    ts.TypeFlags.Intersection;
  return (type.flags & known) !== 0;
}

/** The members a test removes from the type of the reference; see `TypeQueries.narrowedBy`. */
function narrowedMembers(
  program: ts.Program,
  checker: ts.TypeChecker,
  reference: ts.Node,
  test: NarrowingTest,
): NarrowedMembers | "undecided" {
  const type = widened(checker, checker.getTypeAtLocation(reference));
  if (type === undefined) return "undecided";
  const members = type.isUnion() ? type.types : [type];
  if (!members.every(isSettled)) return "undecided";
  const labels = members.map((member) => checker.typeToString(member));
  if (new Set(labels).size !== labels.length) return "undecided";

  let removes: (member: ts.Type) => boolean | undefined;
  switch (test.kind) {
    case "typeof": {
      if (!TYPEOF_NAMES.has(test.typeName)) return "undecided";
      removes = (member) => {
        const result = typeofResult(checker, member);
        return result === undefined ? undefined : result === test.typeName;
      };
      break;
    }
    case "in": {
      // The false branch keeps a member that lacks the property or has it optional.
      removes = (member) => {
        if (!isObjectLike(member)) return undefined;
        const property = checker.getPropertyOfType(member, test.property);
        return property !== undefined && !(property.flags & ts.SymbolFlags.Optional);
      };
      break;
    }
    case "instanceof": {
      const target = instanceSymbol(program, checker, test.constructorExpression);
      if (target === undefined) return "undecided";
      removes = (member) =>
        member.flags & ts.TypeFlags.Object
          ? derivesFrom(checker, member, target, new Set())
          : undefined;
      break;
    }
    case "guard": {
      const predicate = guardPredicate(checker, test.call);
      if (predicate?.type === undefined) return "undecided";
      const candidate = predicate.type;
      if (candidate.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return "undecided";
      removes = (member) => checker.isTypeAssignableTo(member, candidate);
      break;
    }
  }

  const removed: string[] = [];
  for (const [index, member] of members.entries()) {
    const gone = removes(member);
    if (gone === undefined) return "undecided";
    const label = labels[index];
    if (gone && label !== undefined) removed.push(label);
  }
  return { members: [...labels].sort(), removed: removed.sort() };
}

/** The identifier type predicate of a call to a user type guard (not an `asserts` one). */
function guardPredicate(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): { type: ts.Type | undefined; parameterIndex: number } | undefined {
  const signature = checker.getResolvedSignature(call);
  if (signature === undefined) return undefined;
  const predicate = checker.getTypePredicateOfSignature(signature);
  if (predicate?.kind !== ts.TypePredicateKind.Identifier) return undefined;
  return { type: predicate.type, parameterIndex: predicate.parameterIndex };
}

/** A mapped type with a `readonly` modifier: `Readonly<T>`, or a `DeepReadonly` written by hand. */
function isReadonlyMapped(type: ts.Type): boolean {
  return (
    type
      .getSymbol()
      ?.declarations?.some(
        (declaration) =>
          ts.isMappedTypeNode(declaration) &&
          declaration.readonlyToken !== undefined &&
          declaration.readonlyToken.kind !== ts.SyntaxKind.MinusToken,
      ) === true
  );
}

function isReadonlyProperty(owner: ts.Type, property: ts.Symbol): boolean {
  if (isReadonlyMapped(owner)) return true;
  const declarations = property.declarations ?? [];
  return (
    declarations.length > 0 &&
    declarations.every(
      (declaration) => (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) !== 0,
    )
  );
}

/** An object type with an `aborted: boolean` property: `AbortSignal`, or a library's own signal type. */
function isSignal(checker: ts.TypeChecker, type: ts.Type): boolean {
  const members = withoutNullish(type);
  return (
    members.length > 0 &&
    members.every((member) => {
      if (!(member.flags & ts.TypeFlags.Object)) return false;
      const aborted = checker.getPropertyOfType(member, "aborted");
      if (aborted === undefined) return false;
      const value = checker.getTypeOfSymbol(aborted);
      return withoutNullish(value).every((part) => (part.flags & ts.TypeFlags.BooleanLike) !== 0);
    })
  );
}

/** Where the callee takes a signal: a parameter that is one, or an options object holding one. */
function signalParameter(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): { index: number; property: "signal" | undefined } | undefined {
  const signature = checker.getResolvedSignature(call);
  if (signature === undefined) return undefined;
  for (const [index, parameter] of signature.parameters.entries()) {
    const declared = parameter.valueDeclaration;
    if (
      declared !== undefined &&
      ts.isParameter(declared) &&
      declared.dotDotDotToken !== undefined
    ) {
      return undefined;
    }
    const type = widened(checker, checker.getTypeOfSymbol(parameter));
    if (type === undefined) continue;
    if (isSignal(checker, type)) return { index, property: undefined };
    // An options object you fill in; a `Request`, which carries its own readonly signal, is not one.
    const holds = withoutNullish(type).some((member) => {
      const signal = checker.getPropertyOfType(member, "signal");
      return (
        signal !== undefined &&
        !isReadonlyProperty(member, signal) &&
        isSignal(checker, checker.getTypeOfSymbol(signal))
      );
    });
    if (holds) return { index, property: "signal" };
  }
  return undefined;
}

function withoutNullish(type: ts.Type): readonly ts.Type[] {
  const nothing = ts.TypeFlags.Null | ts.TypeFlags.Undefined;
  return (type.isUnion() ? type.types : [type]).filter((member) => !(member.flags & nothing));
}

function accessedName(node: ts.Expression): { owner: ts.Expression; name: string } | undefined {
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
    return accessedName(node.expression);
  }
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)
    ? { owner: node.expression, name: node.name.text }
    : undefined;
}

/** Every segment of the property access chain is a `readonly` property of every member. */
function isReadonlyChain(checker: ts.TypeChecker, node: ts.Expression): boolean {
  let current: ts.Expression = node;
  let segments = 0;
  for (;;) {
    const access = accessedName(current);
    if (access === undefined) break;
    const type = widened(checker, checker.getTypeAtLocation(access.owner));
    const members = type === undefined ? [] : withoutNullish(type);
    if (members.length === 0) return false;
    for (const member of members) {
      const property = checker.getPropertyOfType(member, access.name);
      if (property === undefined || !isReadonlyProperty(member, property)) return false;
    }
    segments += 1;
    current = access.owner;
  }
  return segments > 0;
}

/** An object type, or a part of one, that a callee could write to or call a method of. */
function isWritableObject(checker: ts.TypeChecker, type: ts.Type): boolean {
  const resolved = widened(checker, type);
  if (resolved === undefined) return false;
  if (resolved.isUnion() || resolved.isIntersection()) {
    return resolved.types.some((part) => isWritableObject(checker, part));
  }
  if (!(resolved.flags & ts.TypeFlags.Object)) return false;
  if (checker.getSignaturesOfType(resolved, ts.SignatureKind.Call).length > 0) return false;
  if (checker.getIndexInfosOfType(resolved).some((info) => !info.isReadonly)) return true;
  return checker
    .getPropertiesOfType(resolved)
    .some(
      (property) =>
        property.flags & ts.SymbolFlags.Method || !isReadonlyProperty(resolved, property),
    );
}

/** The properties that tell the members of a union apart; see `TypeQueries.discriminantsOf`. */
function discriminantNames(checker: ts.TypeChecker, found: ts.Type): readonly string[] {
  const type = widened(checker, found);
  if (!type?.isUnion()) return [];
  const members = withoutNullish(type);
  const [first] = members;
  if (first === undefined || members.length < 2) return [];
  if (!members.every((member) => member.flags & ts.TypeFlags.Object)) return [];
  const names: string[] = [];
  for (const property of checker.getPropertiesOfType(first)) {
    const values = new Set<string>();
    const all = members.every((member) => {
      const own = checker.getPropertyOfType(member, property.getName());
      const propertyType = own === undefined ? undefined : checker.getTypeOfSymbol(own);
      if (propertyType === undefined || !isUnitLiteral(propertyType)) return false;
      values.add(checker.typeToString(propertyType));
      return true;
    });
    if (all && values.size > 1) names.push(property.getName());
  }
  return names.sort();
}

/** The literals a property takes over the members of a type; see `TypeQueries.tagsOf`. */
function tagLiterals(
  checker: ts.TypeChecker,
  found: ts.Type,
  property: string,
): readonly Literal[] | "not-finite" {
  const type = widened(checker, found);
  if (type === undefined) return "not-finite";
  // A value that cannot exist (`assertNever(x)`) has no tag, and says nothing.
  if (type.flags & ts.TypeFlags.Never) return [];
  const members = withoutNullish(type);
  if (members.length === 0) return "not-finite";
  const seen = new Map<string, Literal>();
  for (const member of members) {
    if (!(member.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) return "not-finite";
    const own = checker.getPropertyOfType(member, property);
    if (own === undefined) return "not-finite";
    const propertyType = checker.getTypeOfSymbol(own);
    for (const part of propertyType.isUnion() ? propertyType.types : [propertyType]) {
      if (!isUnitLiteral(part)) return "not-finite";
      const literal = literalOf(checker, part);
      if (literal === undefined) return "not-finite";
      seen.set(literal.label, literal);
    }
  }
  return [...seen.values()].sort(compareLabels);
}

/** See `TypeQueries.awaitedTagsOf`. */
function awaitedTags(
  checker: ts.TypeChecker,
  found: ts.Type,
  property: string,
): { readonly members: number; readonly tags: readonly Literal[] | "not-finite" } | "missing" {
  const type = widened(checker, checker.getAwaitedType(found) ?? found);
  if (type === undefined || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    return "missing";
  }
  const members = withoutNullish(type);
  const has = (member: ts.Type): boolean =>
    (member.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0 &&
    checker.getPropertyOfType(member, property) !== undefined;
  if (members.length === 0 || !members.every(has)) return "missing";
  return { members: members.length, tags: tagLiterals(checker, type, property) };
}

const NO_REF: { readonly ref: SymbolRef | undefined } = { ref: undefined };

/** A file's name in qualified ids: relative to the project, with forward slashes. */
export function idFileNames(root: string): (fileName: string) => string {
  // symbolAt is the most frequent question; path.relative on every call was a tenth of a check.
  const names = new Map<string, string>();
  return (fileName) => {
    let name = names.get(fileName);
    if (name === undefined) {
      name = toTypeScriptPath(path.relative(root, fileName));
      names.set(fileName, name);
    }
    return name;
  };
}

export function createTypeQueries(
  program: ts.Program,
  own: ReadonlySet<string>,
  /** The project folder qualified ids are relative to. */
  root: string,
  packageOf: PackageOf,
  isEntry: IsPackageEntry,
  dependenciesOf: DependenciesOf,
): TypeQueries {
  // The only place in the codebase that reaches the type checker. Created on the first question:
  // a run whose results all come from the cache never builds one.
  let created: ts.TypeChecker | undefined;
  const typeChecker = (): ts.TypeChecker => (created ??= program.getTypeChecker());
  const declarations = new Map<string, ts.Node>();
  const idFileName = idFileNames(root);
  // symbolAt is asked about the same node by several rules (on excalidraw 570,000 questions about
  // 170,000 nodes, 52,000 symbols): the program does not change under these queries, so each
  // node's answer and each symbol's ref are computed once.
  const refsByNode = new WeakMap<ts.Node, { readonly ref: SymbolRef | undefined }>();
  const refsBySymbol = new WeakMap<ts.Symbol, { readonly ref: SymbolRef | undefined }>();
  const refOfSymbol = (symbol: ts.Symbol): SymbolRef | undefined => {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (declaration === undefined) return undefined;
    const id = `${idFileName(declaration.getSourceFile().fileName)}#${declarationPath(declaration)}`;
    declarations.set(id, declaration);
    return { id, name: symbol.getName() };
  };
  const refAnswer = (node: ts.Node): { readonly ref: SymbolRef | undefined } => {
    const found = typeChecker().getSymbolAtLocation(node);
    if (found === undefined) return NO_REF;
    const symbol =
      found.flags & ts.SymbolFlags.Alias ? typeChecker().getAliasedSymbol(found) : found;
    let entry = refsBySymbol.get(symbol);
    if (entry === undefined) {
      entry = { ref: refOfSymbol(symbol) };
      refsBySymbol.set(symbol, entry);
    }
    return entry;
  };

  return {
    symbolAt(node) {
      let answer = refsByNode.get(node);
      if (answer === undefined) {
        answer = refAnswer(node);
        refsByNode.set(node, answer);
      }
      return answer.ref;
    },
    declarationOf(symbol) {
      const node = declarations.get(symbol.id);
      return node === undefined ? undefined : { file: node.getSourceFile().fileName, node };
    },
    isOwnFile: (file) => own.has(toTypeScriptPath(file)),
    packageOf: (file) => packageOf(toTypeScriptPath(file)),
    literalsOf(node) {
      const found = typeChecker().getTypeAtLocation(node);
      const type = found.isTypeParameter() ? typeChecker().getBaseConstraintOfType(found) : found;
      if (type === undefined) return "not-finite";
      const literals: Literal[] = [];
      for (const member of type.isUnion() ? type.types : [type]) {
        const literal = literalOf(typeChecker(), member);
        if (literal === undefined) return "not-finite";
        literals.push(literal);
      }
      // The order TypeScript keeps a union in depends on what it checked first.
      return literals.sort(compareLabels);
    },
    propertyKeysOf(node) {
      const found = typeChecker().getTypeAtLocation(node);
      const type = widened(typeChecker(), found);
      if (type === undefined || !(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) {
        return "not-object";
      }
      if (isArrayLike(typeChecker(), type)) return "not-object";
      if (hasGenericKeys(typeChecker(), type)) return "generic";
      const required: string[] = [];
      const optional: string[] = [];
      for (const property of typeChecker().getPropertiesOfType(type)) {
        (property.flags & ts.SymbolFlags.Optional ? optional : required).push(property.getName());
      }
      return {
        required: required.sort(),
        optional: optional.sort(),
        indexSignature: typeChecker().getIndexInfosOfType(type).length > 0,
      };
    },
    isDiscriminant(object, propertyName) {
      const type = widened(typeChecker(), typeChecker().getTypeAtLocation(object));
      if (!type?.isUnion()) return false;
      // `s?.kind` narrows `s` when the rest is a discriminated union, so `undefined` and `null`
      // members do not count against it.
      const members = type.types.filter((member) => !(member.flags & NULLISH));
      const tags: ts.Type[] = [];
      for (const member of members) {
        // `Base & { type: "a" }` is a member TypeScript narrows like any object type.
        if (!(member.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) return false;
        const property = typeChecker().getPropertyOfType(member, propertyName);
        const tag = property === undefined ? undefined : typeChecker().getTypeOfSymbol(property);
        if (tag === undefined || !isLiteralTag(tag)) return false;
        tags.push(tag);
      }
      const [first, ...rest] = tags;
      if (first === undefined) return false;
      // `o?.kind` with `o: { kind: "a" } | null`: the tag tells the object from `null`.
      if (rest.length === 0) return members.length < type.types.length && isUnitLiteral(first);
      // When every member has the same tag type, narrowing on it removes no member.
      return rest.some((tag) => tag !== first);
    },
    typeTextOf(node) {
      return typeChecker()
        .typeToString(typeChecker().getTypeAtLocation(node))
        .replace(/\s+/g, " ")
        .trim();
    },
    contextualTypeTextOf(node) {
      const type = typeChecker().getContextualType(node);
      return type === undefined
        ? undefined
        : typeChecker().typeToString(type).replace(/\s+/g, " ").trim();
    },
    expectsPromiseReturn(node) {
      const checker = typeChecker();
      const type = checker.getContextualType(node);
      if (type === undefined) return false;
      const members = (type.isUnion() ? type.types : [type]).filter(
        (member) => (member.flags & NULLISH) === 0,
      );
      return (
        members.length > 0 &&
        members.every((member) => {
          const signatures = member.getCallSignatures();
          return (
            signatures.length > 0 &&
            signatures.every((signature) => {
              // `void | Promise<void>` may return nothing to await: only a promise counts.
              const returned = checker.getReturnTypeOfSignature(signature);
              const parts = returned.isUnion() ? returned.types : [returned];
              return parts.every((part) => isPromiseType(checker, part));
            })
          );
        })
      );
    },
    canBeUndefined(node) {
      const type = widened(typeChecker(), typeChecker().getTypeAtLocation(node));
      // An unconstrained type parameter can be anything, undefined included.
      return type === undefined || includesUndefined(type);
    },
    canBeNull(node) {
      const type = widened(typeChecker(), typeChecker().getTypeAtLocation(node));
      if (type === undefined) return true;
      const open = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Null;
      return (type.isUnion() ? type.types : [type]).some((member) => (member.flags & open) !== 0);
    },
    parameterIsNever(call, argumentIndex) {
      const declaration = typeChecker().getResolvedSignature(call)?.declaration;
      if (declaration === undefined || !("parameters" in declaration)) return false;
      // A `this` parameter is not an argument.
      const parameters = declaration.parameters
        .filter(ts.isParameter)
        .filter(
          (parameter) => !(ts.isIdentifier(parameter.name) && parameter.name.text === "this"),
        );
      const parameter = parameters[argumentIndex];
      return (
        parameter !== undefined &&
        parameter.dotDotDotToken === undefined &&
        parameter.type?.kind === ts.SyntaxKind.NeverKeyword
      );
    },
    uniqueSymbolKeyFiles(node) {
      const files = new Set<string>();
      for (const property of typeChecker().getPropertiesOfType(
        typeChecker().getTypeAtLocation(node),
      )) {
        for (const declaration of property.declarations ?? []) {
          const name = ts.getNameOfDeclaration(declaration);
          if (name === undefined || !ts.isComputedPropertyName(name)) continue;
          const key = name.expression;
          if (!(typeChecker().getTypeAtLocation(key).flags & ts.TypeFlags.UniqueESSymbol)) continue;
          const found = typeChecker().getSymbolAtLocation(key);
          if (found === undefined) continue;
          const symbol =
            found.flags & ts.SymbolFlags.Alias ? typeChecker().getAliasedSymbol(found) : found;
          const origin = symbol.valueDeclaration ?? symbol.declarations?.[0];
          // TypeScript's own `Symbol.iterator` and friends key the built-in types.
          if (origin === undefined || program.isSourceFileDefaultLibrary(origin.getSourceFile())) {
            continue;
          }
          files.add(origin.getSourceFile().fileName);
        }
      }
      return [...files].sort();
    },
    guaranteesOf(target) {
      const checker = typeChecker();
      if ("kind" in target) return guaranteesOfType(checker, checker.getTypeAtLocation(target));
      const declaration = declarations.get(target.id);
      const type = declaration === undefined ? undefined : declaredTypeOf(checker, declaration);
      return type === undefined ? [] : guaranteesOfType(checker, type);
    },
    awaitedAliasOf(node) {
      return aliasOfType(typeChecker(), typeChecker().getTypeAtLocation(node));
    },
    returnAliasOf(fn) {
      const signature = typeChecker().getSignatureFromDeclaration(fn);
      return signature === undefined
        ? undefined
        : aliasOfType(typeChecker(), typeChecker().getReturnTypeOfSignature(signature));
    },
    typeAliasOf(node) {
      const type = widened(typeChecker(), typeChecker().getTypeAtLocation(node));
      const alias = type?.aliasSymbol;
      const declaration = alias?.declarations?.find(ts.isTypeAliasDeclaration);
      if (alias === undefined || declaration === undefined) return undefined;
      if ((type?.aliasTypeArguments?.length ?? 0) > 0) return undefined;
      return { name: alias.getName(), file: declaration.getSourceFile().fileName };
    },
    importSpecifierFor(alias, fromFile) {
      const from = toTypeScriptPath(fromFile);
      const file = toTypeScriptPath(alias.file);
      if (from === file) return undefined;
      const declared = program.getSourceFile(file);
      const importer = program.getSourceFile(from);
      if (declared === undefined || importer === undefined) return undefined;
      const target = exportedAlias(typeChecker(), declared, alias.name);
      if (target === undefined) return undefined;
      if (own.has(file)) return relativeSpecifier(program, importer, file);
      // A package's type is imported by the package's name, when its entry exports it.
      const name = packageOf(file);
      if (name === undefined) return undefined;
      const resolved = ts.resolveModuleName(name, from, program.getCompilerOptions(), ts.sys)
        .resolvedModule?.resolvedFileName;
      const entry = resolved === undefined ? undefined : program.getSourceFile(resolved);
      if (entry === undefined) return undefined;
      return exportedAlias(typeChecker(), entry, alias.name) === target ? name : undefined;
    },
    isAssignableWithoutNullish(from, to) {
      const source = typeChecker().getTypeAtLocation(from);
      if (source.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
      const rest = typeChecker().getNonNullableType(source);
      // A bare `undefined` leaves nothing behind: casting it to a brand removes no wrapper.
      if (rest.flags & ts.TypeFlags.Never) return false;
      return typeChecker().isTypeAssignableTo(
        rest,
        typeChecker().getNonNullableType(typeChecker().getTypeAtLocation(to)),
      );
    },
    parameterIsReadonly(call, argumentIndex) {
      // After a spread argument the indexes no longer line up with the parameters.
      if (call.arguments.slice(0, argumentIndex + 1).some(ts.isSpreadElement)) return false;
      const signature = typeChecker().getResolvedSignature(call);
      const declaration = signature?.declaration;
      const parameter = signature?.parameters[argumentIndex];
      if (declaration === undefined || parameter === undefined) return false;
      if (!("parameters" in declaration)) return false;
      const declared = parameter.valueDeclaration;
      if (declared === undefined || !ts.isParameter(declared)) return false;
      if (declared.dotDotDotToken !== undefined) return false;
      // The declared type, not the instantiated one: a `T` that this call happens to make
      // readonly lets the callee do anything with it.
      return isReadonlyView(program, typeChecker(), typeChecker().getTypeAtLocation(declared.name));
    },
    discriminantsOf(node) {
      return discriminantNames(typeChecker(), typeChecker().getTypeAtLocation(node));
    },
    tagsOf(node, property) {
      return tagLiterals(typeChecker(), typeChecker().getTypeAtLocation(node), property);
    },
    awaitedTagsOf(node, property) {
      return awaitedTags(typeChecker(), typeChecker().getTypeAtLocation(node), property);
    },
    isReadonlyPath(node) {
      return isReadonlyChain(typeChecker(), node);
    },
    callMayChange(call, argument) {
      const checker = typeChecker();
      const signature = checker.getResolvedSignature(call);
      const declaration = signature?.declaration;
      if (signature === undefined || declaration === undefined) return false;
      if (!own.has(declaration.getSourceFile().fileName)) return false;
      if (argument === "receiver") return true;
      if (call.arguments?.slice(0, argument + 1).some(ts.isSpreadElement) === true) return false;
      const declared = signature.parameters[argument]?.valueDeclaration;
      if (declared === undefined || !ts.isParameter(declared)) return false;
      if (declared.dotDotDotToken !== undefined) return false;
      // The declared type, not the instantiated one, as in `parameterIsReadonly`.
      return isWritableObject(checker, checker.getTypeAtLocation(declared.name));
    },
    isPackageEntry: (file) => isEntry(toTypeScriptPath(file)),
    dependenciesOf: (file) => dependenciesOf(toTypeScriptPath(file)),
    isPrimitive(node) {
      const type = widened(typeChecker(), typeChecker().getTypeAtLocation(node));
      if (type === undefined) return false;
      const members = type.isUnion() ? type.types : [type];
      return members.every((member) => (member.flags & PRIMITIVE_FLAGS) !== 0);
    },
    isLibraryType(node) {
      const inLibrary = (declaration: ts.Declaration): boolean => {
        const file = declaration.getSourceFile();
        return (
          program.isSourceFileFromExternalLibrary(file) || program.isSourceFileDefaultLibrary(file)
        );
      };
      const type = widened(typeChecker(), typeChecker().getTypeAtLocation(node));
      if (type === undefined) return false;
      // A property read names its type where the property is declared (`event.type` in a library).
      const property = ts.isPropertyAccessExpression(node)
        ? typeChecker().getSymbolAtLocation(node.name)
        : undefined;
      const declarations =
        type.aliasSymbol?.declarations ??
        enumMemberDeclarations(type) ??
        property?.declarations ??
        [];
      return declarations.length > 0 && declarations.every(inLibrary);
    },
    indexSignatureOf(node) {
      const type = widened(typeChecker(), typeChecker().getTypeAtLocation(node));
      if (type === undefined) return undefined;
      const stringInfo = typeChecker().getIndexInfoOfType(type, ts.IndexKind.String);
      const info = stringInfo ?? typeChecker().getIndexInfoOfType(type, ts.IndexKind.Number);
      if (info === undefined) return undefined;
      return {
        keyKind: stringInfo === undefined ? "number" : "string",
        valueText: typeChecker().typeToString(
          info.type,
          undefined,
          ts.TypeFormatFlags.NoTruncation,
        ),
        valueCanBeUndefined: includesUndefined(info.type),
      };
    },
    settlesWithError(node) {
      const checker = typeChecker();
      const type = checker.getTypeAtLocation(node);
      if (!isPromiseType(checker, type)) return false;
      const unwrap = checker.getPropertyOfType(type, "unwrap");
      if (unwrap === undefined) return false;
      if (checker.getTypeOfSymbolAtLocation(unwrap, node).getCallSignatures().length === 0) {
        return false;
      }
      const awaited = checker.getAwaitedType(type);
      if (awaited?.isUnion() !== true) return false;
      return awaited.types.some(
        (member) => checker.getPropertyOfType(member, "error") !== undefined,
      );
    },
    calleeTags(call) {
      return calleeTags(typeChecker(), call);
    },
    signalParameterOf(call) {
      return signalParameter(typeChecker(), call);
    },
    narrowedBy(reference, test) {
      return narrowedMembers(program, typeChecker(), reference, test);
    },
    guardedArgument(call) {
      if (call.arguments.some(ts.isSpreadElement)) return undefined;
      const predicate = guardPredicate(typeChecker(), call);
      return predicate === undefined ? undefined : call.arguments[predicate.parameterIndex];
    },
    isErrorType(node) {
      // TypeScript's error type is an `any` whose intrinsic name is "error"; it has no public flag.
      const type = typeChecker().getTypeAtLocation(node);
      return !!(type.flags & ts.TypeFlags.Any) && Reflect.get(type, "intrinsicName") === "error";
    },
    isPromiseLike(node) {
      return isPromiseType(typeChecker(), typeChecker().getTypeAtLocation(node));
    },
    returnsPromiseLike(fn) {
      const signature = typeChecker().getSignatureFromDeclaration(fn);
      return (
        signature !== undefined &&
        isPromiseType(typeChecker(), typeChecker().getReturnTypeOfSignature(signature))
      );
    },
    hasDefinedProperty(node, name) {
      const type = widened(typeChecker(), typeChecker().getTypeAtLocation(node));
      if (type === undefined) return false;
      const members = type.isUnion() ? type.types : [type];
      const open =
        ts.TypeFlags.Any |
        ts.TypeFlags.Unknown |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Void |
        ts.TypeFlags.Null;
      return members.every((member) => {
        const property = typeChecker().getPropertyOfType(member, name);
        if (property === undefined || property.flags & ts.SymbolFlags.Optional) return false;
        const value = typeChecker().getTypeOfSymbol(property);
        return (value.isUnion() ? value.types : [value]).every((part) => !(part.flags & open));
      });
    },
    neverFieldsOf(node) {
      const checker = typeChecker();
      const type = checker.getContextualType(node) ?? checker.getTypeAtLocation(node);
      const names = new Set<string>();
      for (const member of type.isUnion() ? type.types : [type]) {
        if (!(member.flags & ts.TypeFlags.Object)) continue;
        for (const property of member.getProperties()) {
          if (checker.getTypeOfSymbol(property).flags & ts.TypeFlags.Never) {
            names.add(property.getName());
          }
        }
      }
      return [...names].sort();
    },
    isCallable(node) {
      const found = widened(typeChecker(), typeChecker().getTypeAtLocation(node));
      if (found === undefined) return false;
      const type = typeChecker().getNonNullableType(found);
      if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false;
      return (type.isUnion() ? type.types : [type]).every(
        (member) => member.getCallSignatures().length > 0,
      );
    },
  };
}

/**
 * The configured tsconfigs, in order, each followed through its `references`, depth first, each
 * file once. A directory reference means `<dir>/tsconfig.json`.
 */
function collectConfigs(
  roots: readonly string[],
): { path: string; parsed: ts.ParsedCommandLine }[] {
  const visited = new Set<string>();
  const found: { path: string; parsed: ts.ParsedCommandLine }[] = [];
  const visit = (tsconfigPath: string): void => {
    const key = toTypeScriptPath(tsconfigPath);
    if (visited.has(key)) return;
    visited.add(key);
    const parsed = readTsconfig(tsconfigPath);
    found.push({ path: key, parsed });
    for (const reference of parsed.projectReferences ?? []) {
      visit(toTypeScriptPath(path.resolve(ts.resolveProjectReferencePath(reference))));
    }
  };
  for (const root of roots) visit(root);
  return found;
}

/** The files that more than one of the projects lists (before stateward's include and exclude). */
function listedTwice(projects: readonly { parsed: ts.ParsedCommandLine }[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const { parsed } of projects) {
    for (const file of new Set(parsed.fileNames)) {
      if (seen.has(file)) twice.add(file);
      else seen.add(file);
    }
  }
  return twice;
}

/** What a program is built from besides file texts: its root files, options and the own files. */
function programInputs(parsed: ts.ParsedCommandLine, claimed: ReadonlySet<string>): string {
  return JSON.stringify([parsed.fileNames, parsed.options, [...claimed].sort()]);
}

/** The same parsed files in the same order: a program built from them is the same program. */
function sameSourceFiles(before: ts.Program, after: ts.Program): boolean {
  const old = before.getSourceFiles();
  const now = after.getSourceFiles();
  return old.length === now.length && old.every((file, i) => file === now[i]);
}

/**
 * Builds one TypeScript program per project of the config's tsconfig (see `collectConfigs`) and
 * serves the unsaved overlays. Later `open` calls reuse the previous programs.
 */
export function createBackend({
  config,
  cwd,
  cache,
  jsDoc = false,
}: {
  config: Config;
  cwd: string;
  /** Where programs are recorded and read back (`program-record.ts`); none without a cache. */
  cache?: ResultCache | undefined;
  /** Parse the JSDoc of TypeScript files (`hostWithOverlays`). */
  jsDoc?: boolean;
}): Backend {
  /** The last program of each project, what it was built from, and its unit. */
  const previous = new Map<string, { program: ts.Program; inputs: string; unit: ProjectUnit }>();
  const caches = new Map<string, Map<string, CachedSource>>();
  /** What the last `open` found: the projects, their own files, and every own file of all of them. */
  let last: { projects: readonly Project[]; claimed: ReadonlySet<string> } | undefined;

  type Project = {
    tsconfigPath: string;
    parsed: ts.ParsedCommandLine;
    own: readonly string[];
    shared: ReadonlySet<string>;
  };

  /** The program of one project, built now, as a unit; recorded for the next run when it can be. */
  const buildUnit = (
    { tsconfigPath, parsed, own, shared }: Project,
    claimed: ReadonlySet<string>,
    overlays: ReadonlyMap<string, string>,
    trustCache: boolean,
  ): ProjectUnit => {
    const sources = caches.get(tsconfigPath) ?? new Map<string, CachedSource>();
    caches.set(tsconfigPath, sources);
    const oldProgram = previous.get(tsconfigPath);
    const missingLib = missingDefaultLib(parsed.options, (file) => ts.sys.fileExists(file));
    if (missingLib !== undefined) throw new TypeScriptLibMissingError(missingLib);
    // Only a program built from nothing asks the host every question; one built on an old
    // program is not recorded. One built on unsaved text is: its answers are the overlays', and a
    // replay serves the overlays of its own run the same way (`replayHost`), so the record holds
    // exactly while the open documents have that text (an editor's next start).
    const queries =
      cache !== undefined && oldProgram === undefined && !trustCache
        ? new Map<string, HostQuery>()
        : undefined;
    const plainHost = hostWithOverlays(parsed.options, overlays, sources, trustCache, jsDoc);
    const host = queries === undefined ? plainHost : recordingHost(plainHost, queries);
    const packageOf = packageNames(host);
    const isEntry = packageEntries(host);
    const dependenciesOf = packageDependencies(host);
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
      host,
      ...(oldProgram === undefined ? {} : { oldProgram: oldProgram.program }),
    });
    const inputs = programInputs(parsed, claimed);
    // Nothing changed (the full pass right after a fast pass on the same text): keep the old
    // program, its type checker and what that checker already computed, instead of a second
    // checker that starts empty.
    if (oldProgram?.inputs === inputs && sameSourceFiles(oldProgram.program, program)) {
      return oldProgram.unit;
    }
    const files = own.filter((file) => program.getSourceFile(file) !== undefined);
    let fingerprints: ReadonlyMap<string, string> | undefined;
    /** The text hashes of read files asked for, kept in the record so a replayed program answers them. */
    const readPrints: Record<string, string> = {};
    const fingerprintsOf = (): ReadonlyMap<string, string> => {
      if (fingerprints !== undefined) return fingerprints;
      fingerprints = computeFingerprints(
        program,
        claimed,
        packageOf,
        isEntry,
        dependenciesOf,
        packageManifests(host),
      );
      if (queries !== undefined && cache !== undefined) {
        const known = fingerprints;
        cache.programs.set(tsconfigPath, {
          inputs: recordInputs(inputs, parsed.options),
          queries: [...queries.values()],
          files,
          fingerprints: Object.fromEntries(files.map((file) => [file, known.get(file) ?? ""])),
          reads: readPrints,
        });
        cache.changed = true;
      }
      return fingerprints;
    };
    /** What each file's rules were handed, by file: read ids, with the file each one is in. */
    const reads = new Map<string, Map<string, string>>();
    const types = createTypeQueries(program, claimed, cwd, packageOf, isEntry, dependenciesOf);
    const idFileName = idFileNames(cwd);
    const fileId = (fileName: string): string => `${idFileName(fileName)}#`;
    /** The read id of a declaration handed out: its own id when that finds it again, else its file's. */
    const readId = (symbol: SymbolRef, found: { file: string; node: ts.Node }): string => {
      if (!types.isOwnFile(found.file) || ts.isSourceFile(found.node)) return fileId(found.file);
      const sourceFile = program.getSourceFile(found.file);
      const at = symbol.id.indexOf("#");
      return sourceFile !== undefined &&
        at >= 0 &&
        symbol.id.slice(0, at + 1) === fileId(found.file) &&
        declarationAtPath(sourceFile, symbol.id.slice(at + 1)) === found.node
        ? symbol.id
        : fileId(found.file);
    };
    /** Read prints computed in this program, by read id. */
    const prints = new Map<string, string | undefined>();
    const unit: ProjectUnit = {
      tsconfig: tsconfigPath,
      files,
      listedElsewhere: (file) => shared.has(file),
      sourceFile: (file) => program.getSourceFile(file),
      types,
      fingerprint: (file) => fingerprintsOf().get(file),
      typesFor: (file) => {
        const read = reads.get(file) ?? new Map<string, string>();
        reads.set(file, read);
        return {
          ...types,
          declarationOf(symbol) {
            const found = types.declarationOf(symbol);
            if (found !== undefined && found.file !== file) {
              read.set(readId(symbol, found), found.file);
            }
            return found;
          },
        };
      },
      readsOf: (file, mentioned) => {
        const ids = new Set<string>();
        for (const [id, readFile] of reads.get(file) ?? []) {
          ids.add(mentioned(readFile) ? fileId(readFile) : id);
        }
        return [...ids].sort();
      },
      readFingerprint: (read) => {
        if (prints.has(read)) return prints.get(read);
        const at = read.indexOf("#");
        const sourceFile =
          at < 0
            ? undefined
            : program.getSourceFile(toTypeScriptPath(path.resolve(cwd, read.slice(0, at))));
        const node =
          sourceFile === undefined ? undefined : declarationAtPath(sourceFile, read.slice(at + 1));
        const print =
          sourceFile === undefined || node === undefined
            ? undefined
            : declarationTextHash(sourceFile, node);
        prints.set(read, print);
        if (print !== undefined) readPrints[read] = print;
        return print;
      },
      syntaxError: (file) => firstSyntaxError(program, file),
      unresolvedImports: (file) => unresolvedImportsOf(program, file),
      strictNullChecks: checksNulls(parsed.options),
      typesResolve: typesResolver(tsconfigPath, parsed.options),
      bind: () => {
        program.getTypeChecker();
      },
      ignoreComments: (file) => {
        const sourceFile = program.getSourceFile(file);
        return sourceFile === undefined
          ? undefined
          : { text: sourceFile.text, comments: markedComments(sourceFile, "stateward-ignore") };
      },
      tryEdits: (candidates) => tryEditsOn(program, plainHost, candidates),
    };
    previous.set(tsconfigPath, { program, inputs, unit });
    return unit;
  };

  /**
   * The unit of a project whose program the last run recorded and that would be built the same
   * now: its files and fingerprints come from the record, and the program is built only if
   * something asks for a node or a type.
   */
  const recordedUnit = (
    project: Project,
    claimed: ReadonlySet<string>,
    record: ProgramRecord,
    overlays: ReadonlyMap<string, string>,
  ): ProjectUnit => {
    let built: ProjectUnit | undefined;
    const real = (): ProjectUnit => (built ??= buildUnit(project, claimed, overlays, false));
    return {
      tsconfig: project.tsconfigPath,
      files: record.files,
      listedElsewhere: (file) => project.shared.has(file),
      sourceFile: (file) => real().sourceFile(file),
      get types() {
        return real().types;
      },
      fingerprint: (file) => record.fingerprints[file],
      typesFor: (file) => real().typesFor(file),
      readsOf: (file, mentioned) => (built === undefined ? [] : built.readsOf(file, mentioned)),
      // The program is the recorded one: a text hash it recorded is the answer.
      readFingerprint: (file) => record.reads[file] ?? real().readFingerprint(file),
      syntaxError: (file) => real().syntaxError(file),
      unresolvedImports: (file) => real().unresolvedImports(file),
      strictNullChecks: checksNulls(project.parsed.options),
      typesResolve: typesResolver(project.tsconfigPath, project.parsed.options),
      bind: () => {
        real().bind();
      },
      ignoreComments: (file) => real().ignoreComments(file),
      tryEdits: (candidates) => real().tryEdits(candidates),
    };
  };

  const build = (
    projects: readonly Project[],
    claimed: ReadonlySet<string>,
    overlays: ReadonlyMap<string, string>,
    trustCache: boolean,
  ): readonly ProjectUnit[] => {
    const normalized = new Map(
      [...overlays].map(([file, text]) => [toTypeScriptPath(file), text] as const),
    );
    return projects
      .filter((project) => project.own.length > 0)
      .map((project): ProjectUnit => {
        const record = cache?.programs.get(project.tsconfigPath);
        const replayable =
          record !== undefined &&
          !previous.has(project.tsconfigPath) &&
          !trustCache &&
          record.inputs ===
            recordInputs(programInputs(project.parsed, claimed), project.parsed.options) &&
          replays(record.queries, replayHost(project.parsed.options, normalized));
        return replayable
          ? recordedUnit(project, claimed, record, normalized)
          : buildUnit(project, claimed, normalized, trustCache);
      });
  };

  const open = (overlays: ReadonlyMap<string, string>): readonly ProjectUnit[] => {
    const entries = config.tsconfig.map((entry) => path.resolve(cwd, entry));
    const named = entries.map((entry) => displayPath(cwd, entry)).join("`, `");
    const { files: roots, unmatched } = expandTsconfigs(entries);
    const [firstUnmatched] = unmatched;
    if (firstUnmatched !== undefined) {
      // Shown as the config writes it (not as a resolved, platform-separated path).
      const written =
        config.tsconfigAsWritten?.[entries.indexOf(firstUnmatched)] ??
        displayPath(cwd, firstUnmatched);
      throw new TsconfigError(`no tsconfig matches \`${written}\``, UNMATCHED_TSCONFIG_HINT);
    }
    const claimed = new Set<string>();
    const collected = collectConfigs(roots);
    const shared = collected.length > 1 ? listedTwice(collected) : new Set<string>();
    const projects = collected.map(({ path: tsconfigPath, parsed }) => {
      const own = ownFileNames(parsed, config, cwd, claimed);
      for (const file of own) claimed.add(file);
      return { tsconfigPath, parsed, own, shared };
    });
    if (claimed.size === 0) throw new NothingToCheckError(named);
    last = { projects, claimed };
    return build(projects, claimed, overlays, false);
  };

  return {
    open,
    release: () => {
      previous.clear();
      caches.clear();
    },
    reopen: (overlays) =>
      last === undefined ? open(overlays) : build(last.projects, last.claimed, overlays, true),
  };
}

// ---- package sources ----------------------------------------

function isSymbol(value: unknown): value is ts.Symbol {
  return typeof value === "object" && value !== null && "flags" in value && "escapedName" in value;
}

/**
 * The module symbol of a file: the checker answers for an ES module; a CommonJS file (`exports.x
 * = …`) has one only on the file itself, which TypeScript keeps without a public type, so it is
 * read through reflection and checked at run time.
 */
/** The type alias a module exports under `name`, aliases resolved; undefined when it exports none. */
function exportedAlias(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  name: string,
): ts.Symbol | undefined {
  const module = moduleSymbolOf(checker, sourceFile);
  const found = module && checker.getExportsOfModule(module).find((s) => s.getName() === name);
  if (found === undefined) return undefined;
  const symbol = found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
  return symbol.flags & ts.SymbolFlags.TypeAlias ? symbol : undefined;
}

/**
 * The relative specifier `importer` would write for `file`, ending as its relative imports do
 * (`.js`, `.ts`, or nothing), else as the module resolution needs: `.js` for Node16 and NodeNext.
 */
function relativeSpecifier(program: ts.Program, importer: ts.SourceFile, file: string): string {
  const relative = path.posix.relative(path.posix.dirname(importer.fileName), file);
  const bare = relative.replace(/(?:\.d)?\.[mc]?tsx?$/, "");
  const withDot = (text: string): string => (text.startsWith(".") ? text : `./${text}`);
  const written = importer.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text.startsWith(".")
      ? [statement.moduleSpecifier.text]
      : [],
  );
  const ending = written.some((text) => /\.[mc]?js$/.test(text))
    ? "js"
    : written.some((text) => /\.[mc]?tsx?$/.test(text))
      ? "ts"
      : written.length > 0
        ? "none"
        : undefined;
  const resolution = program.getCompilerOptions().moduleResolution;
  const nodeNext =
    resolution === ts.ModuleResolutionKind.Node16 ||
    resolution === ts.ModuleResolutionKind.NodeNext;
  const chosen = ending ?? (nodeNext ? "js" : "none");
  switch (chosen) {
    case "js":
      return withDot(
        `${bare}${/\.[mc]?tsx?$/.exec(relative)?.[0].replace(/tsx?$/, "js") ?? ".js"}`,
      );
    case "ts":
      return withDot(relative);
    case "none":
      return withDot(bare.replace(/\/index$/, ""));
    default: {
      const unreachable: never = chosen;
      return unreachable;
    }
  }
}

function moduleSymbolOf(checker: ts.TypeChecker, sourceFile: ts.SourceFile): ts.Symbol | undefined {
  const found = checker.getSymbolAtLocation(sourceFile);
  if (found !== undefined) return found;
  const own: unknown = Reflect.get(sourceFile, "symbol");
  return isSymbol(own) ? own : undefined;
}

/**
 * A package's own JavaScript, read as the project's own code is (the fourth source of library facts): a small program over the files one entry reaches by relative imports and requires, never
 * into other packages, with TypeScript's ES2022 library for the platform's globals. Plugins
 * summarize its files with the same code as the project's, through these `TypeQueries`.
 */
export type PackageSource = {
  /** The package's files the program loaded, absolute, sorted: the entry and what it reaches. */
  readonly files: readonly string[];
  sourceFile(file: string): ts.SourceFile | undefined;
  /** Own files are the package's loaded files; qualified ids are relative to the package root. */
  readonly types: TypeQueries;
  /**
   * The declaration a module exports under `path` (`["remote"]`, `["Client", "get"]`): an ES
   * export, a CommonJS `exports.x = …` or `module.exports = { x }`, or `module.exports = fn` for
   * `["default"]` or its own name. Undefined when the module does not export it.
   */
  exported(file: string, path: readonly string[]): SymbolRef | undefined;
};

const PACKAGE_JAVASCRIPT = /\.(?:js|mjs|cjs)$/;

const PACKAGE_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts"],
  types: [],
  skipLibCheck: true,
};

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * Opens the package at `root` from `entry` (a JavaScript file in it). Its files are parsed with
 * the library files' cache, so a later package or project shares TypeScript's lib files.
 */
export function openPackageSource(root: string, entry: string): PackageSource {
  const packageRoot = toTypeScriptPath(root);
  const inPackage = (file: string): boolean =>
    file.startsWith(`${packageRoot}/`) &&
    !file.slice(packageRoot.length).includes("/node_modules/");
  const base = hostWithOverlays(
    PACKAGE_OPTIONS,
    new Map(),
    new Map(),
    false,
    false,
    isTypeScriptLib,
  );
  const host: ts.CompilerHost = {
    ...base,
    // Relative specifiers inside the package only: another package is not followed (its calls
    // stay unknown), and nothing here is an "external library" TypeScript would skip.
    resolveModuleNameLiterals: (literals, containingFile) =>
      literals.map((literal): ts.ResolvedModuleWithFailedLookupLocations => {
        if (!isRelativeSpecifier(literal.text)) return { resolvedModule: undefined };
        const found = ts.resolveModuleName(literal.text, containingFile, PACKAGE_OPTIONS, base);
        const resolved = found.resolvedModule;
        if (
          resolved === undefined ||
          !PACKAGE_JAVASCRIPT.test(resolved.resolvedFileName) ||
          !inPackage(toTypeScriptPath(resolved.resolvedFileName))
        ) {
          return { resolvedModule: undefined };
        }
        return { resolvedModule: { ...resolved, isExternalLibraryImport: false } };
      }),
  };
  const program = ts.createProgram({
    rootNames: [toTypeScriptPath(entry)],
    options: PACKAGE_OPTIONS,
    host,
  });
  const files = program
    .getSourceFiles()
    .map((file) => file.fileName)
    .filter((file) => inPackage(file) && PACKAGE_JAVASCRIPT.test(file))
    .sort();
  const own = new Set(files);
  const types = createTypeQueries(
    program,
    own,
    packageRoot,
    packageNames(host),
    packageEntries(host),
    packageDependencies(host),
  );
  // Plugins walk the nodes with parents: the binder sets them.
  const checker = program.getTypeChecker();
  const idFileName = idFileNames(packageRoot);

  const refOf = (symbol: ts.Symbol): SymbolRef | undefined => {
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const declaration = resolved.valueDeclaration ?? resolved.declarations?.[0];
    if (declaration === undefined) return undefined;
    const file = declaration.getSourceFile().fileName;
    return { id: `${idFileName(file)}#${declarationPath(declaration)}`, name: resolved.getName() };
  };

  const member = (symbol: ts.Symbol, name: string): ts.Symbol | undefined => {
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const escaped = ts.escapeLeadingUnderscores(name);
    return (
      resolved.members?.get(escaped) ??
      resolved.exports?.get(escaped) ??
      checker.getTypeOfSymbol(resolved).getProperty(name)
    );
  };

  return {
    files,
    sourceFile: (file) => program.getSourceFile(toTypeScriptPath(file)),
    types,
    exported(file, names) {
      const sourceFile = program.getSourceFile(toTypeScriptPath(file));
      const moduleSymbol =
        sourceFile === undefined ? undefined : moduleSymbolOf(checker, sourceFile);
      const [first, ...rest] = names;
      if (moduleSymbol === undefined || first === undefined) return undefined;
      let symbol = checker.getExportsOfModule(moduleSymbol).find((one) => one.getName() === first);
      if (symbol === undefined) {
        // `module.exports = fn`: the module is the function.
        const assigned = moduleSymbol.exports?.get(ts.InternalSymbolName.ExportEquals);
        const whole =
          assigned === undefined || !(assigned.flags & ts.SymbolFlags.Alias)
            ? assigned
            : checker.getAliasedSymbol(assigned);
        if (whole !== undefined && (first === "default" || whole.getName() === first)) {
          symbol = whole;
        }
      }
      for (const name of rest) {
        if (symbol === undefined) return undefined;
        symbol = member(symbol, name);
      }
      return symbol === undefined ? undefined : refOf(symbol);
    },
  };
}

/**
 * The node whose JSDoc describes a declaration: for a function type, the property or type alias
 * it is written in (`onSave?: () => Promise<void>` with the tag above `onSave`); otherwise the
 * declaration itself.
 */
function documented(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isFunctionTypeNode(current) ||
    ts.isParenthesizedTypeNode(current) ||
    ts.isUnionTypeNode(current)
  ) {
    const parent = current.parent;
    if (ts.isPropertySignature(parent) || ts.isTypeAliasDeclaration(parent)) return parent;
    if (!ts.isParenthesizedTypeNode(parent) && !ts.isUnionTypeNode(parent)) return current;
    current = parent;
  }
  return current;
}

function tagNamesOf(node: ts.Node, into: Set<string>): void {
  for (const tag of ts.getJSDocTags(documented(node))) into.add(tag.tagName.text);
}

function calleeTags(checker: ts.TypeChecker, call: ts.CallExpression): string[] {
  const tags = new Set<string>();
  let callee: ts.Expression = call.expression;
  while (ts.isParenthesizedExpression(callee) || ts.isNonNullExpression(callee)) {
    callee = callee.expression;
  }
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  const declaration = checker.getResolvedSignature(call)?.declaration;
  if (declaration !== undefined) tagNamesOf(declaration, tags);
  let symbol = checker.getSymbolAtLocation(name);
  if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  for (const found of symbol?.declarations ?? []) {
    tagNamesOf(found, tags);
    // `({ onSave }: Props)`: the tag is on `onSave` in `Props`.
    if (ts.isBindingElement(found) && ts.isObjectBindingPattern(found.parent)) {
      const key = found.propertyName ?? found.name;
      const property =
        ts.isIdentifier(key) || ts.isStringLiteral(key)
          ? checker.getTypeAtLocation(found.parent).getProperty(key.text)
          : undefined;
      for (const each of property?.declarations ?? []) tagNamesOf(each, tags);
    }
  }
  const alias = checker.getTypeAtLocation(callee).aliasSymbol;
  for (const found of alias?.declarations ?? []) tagNamesOf(found, tags);
  return [...tags].sort();
}
