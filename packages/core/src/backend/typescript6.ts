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
  FlowKind,
  FlowVia,
  ReferenceForm,
  RuleProves,
  StatedDeclaration,
  StatedReference,
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

function literalOf(checker: ts.TypeChecker, found: ts.Type): Literal | undefined {
  const member = withoutMarkers(checker, found);
  const label = checker.typeToString(member);
  if (member.isStringLiteral() || member.isNumberLiteral()) return { value: member.value, label };
  if (member.flags & ts.TypeFlags.BooleanLiteral) return { value: label === "true", label };
  if (member.flags & ts.TypeFlags.Null) return { value: null, label };
  if (member.flags & ts.TypeFlags.Undefined) return { value: undefined, label };
  return undefined;
}

/** The literal of `"paid" & { "__guarantee:open-union"?: true }`; any other type as it is. */
function withoutMarkers(checker: ts.TypeChecker, type: ts.Type): ts.Type {
  if (!type.isIntersection()) return type;
  const rest = type.types.filter((part) => !isMarkerOnly(checker, part));
  const [only] = rest;
  return rest.length === 1 && only !== undefined && rest.length < type.types.length ? only : type;
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

/** An instantiated generic type: `Array<T>`, `Map<K, V>`, a tuple. */
function isTypeReference(type: ts.Type): type is ts.TypeReference {
  return (
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    "objectFlags" in type &&
    typeof type.objectFlags === "number" &&
    (type.objectFlags & ts.ObjectFlags.Reference) !== 0
  );
}

/** An object type written in place (`{ id: Id }`), not a class or an interface. */
function isAnonymousObject(type: ts.Type): boolean {
  return (
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    "objectFlags" in type &&
    typeof type.objectFlags === "number" &&
    (type.objectFlags & ts.ObjectFlags.Anonymous) !== 0
  );
}

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

/** The property a stated guarantee is written in by 1.1.0 (`__guarantee?: "owned"`). */
const GUARANTEE_PROPERTY = "__guarantee";
/** The prefix of the property each trait is written in from 1.2 (`"__guarantee:owned"?: true`). */
const GUARANTEE_PREFIX = "__guarantee:";

/** Whether `file` declares a property named `marker` (`"__guarantee:opaque"?: …`) in a type or class. */
function declaresMarkerProperty(file: ts.SourceFile, marker: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
      (ts.isStringLiteral(node.name) || ts.isIdentifier(node.name)) &&
      node.name.text === marker
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Whether a property name is a marker's: `"__guarantee:<name>"`, or the 1.1.0 `__guarantee`. */
function isMarkerName(name: ts.PropertyName): boolean {
  if (!(ts.isStringLiteral(name) || ts.isIdentifier(name))) return false;
  return name.text === GUARANTEE_PROPERTY || name.text.startsWith(GUARANTEE_PREFIX);
}

/** Whether `file` writes any marker property in a type or class (a quick text filter first). */
function declaresAnyMarker(file: ts.SourceFile): boolean {
  if (!file.text.includes(GUARANTEE_PROPERTY)) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
      isMarkerName(node.name)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Whether a written type defines a marker itself (`T & { "__guarantee:owned"?: true }`). */
function definesMarker(type: ts.TypeNode): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isPropertySignature(node) && isMarkerName(node.name)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(type);
  return found;
}

/**
 * The declarations of a file whose written type states a guarantee, in source order
 * (`TypeQueries.statedDeclarationsIn`). A function's return type is not one: what it states
 * (`Release<…>`) reaches the code through each call, which a rule reads there.
 */
function statedDeclarationsOf(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): readonly StatedDeclaration[] {
  const found: StatedDeclaration[] = [];
  const guaranteesOfNode = (type: ts.TypeNode): readonly string[] =>
    definesMarker(type) ? [] : guaranteesOfType(checker, checker.getTypeFromTypeNode(type));
  /** The first reference in the annotation that states a guarantee: where the marker is written. */
  const markerReference = (type: ts.TypeNode): ts.TypeReferenceNode | undefined => {
    let found: ts.TypeReferenceNode | undefined;
    const visit = (node: ts.Node): void => {
      if (found !== undefined) return;
      if (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        guaranteesOfNode(node).length > 0
      ) {
        found = node;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(type);
    return found;
  };
  /**
   * Whether a reference is to a type alias that states the guarantee itself (`type OrderStatus =
   * OpenUnion<…>`): the alias is the declaration that states it, and each use of it is a use.
   */
  const refersToStatedAlias = (reference: ts.TypeReferenceNode): boolean => {
    const found = checker.getSymbolAtLocation(reference.typeName);
    const symbol =
      found !== undefined && found.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(found)
        : found;
    return (
      symbol?.declarations?.some(
        (declaration) =>
          ts.isTypeAliasDeclaration(declaration) &&
          declaration.typeParameters === undefined &&
          guaranteesOfNode(declaration.type).length > 0,
      ) === true
    );
  };
  const add = (node: ts.Node, type: ts.TypeNode | undefined, name: ts.Node | undefined): void => {
    // `o: typeof settings` names the type of a stated value; it states nothing of its own.
    if (type === undefined || name === undefined || ts.isTypeQueryNode(type)) return;
    const names = guaranteesOfNode(type);
    if (names.length === 0) return;
    const reference = markerReference(type);
    if (reference !== undefined && refersToStatedAlias(reference)) return;
    found.push({
      file: sourceFile.fileName,
      start: node.getStart(sourceFile),
      headEnd: type.end,
      end: node.end,
      name: name.getText(sourceFile),
      marker: reference === undefined ? (names[0] ?? "") : reference.typeName.getText(sourceFile),
      guarantees: names,
    });
  };
  const hasBody = (node: ts.Node): boolean =>
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isConstructorDeclaration(node)) &&
    node.body !== undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      add(node, node.type, ts.isIdentifier(node.name) ? node.name : undefined);
    } else if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
      add(node, node.type, node.name);
    } else if (ts.isParameter(node)) {
      if (ts.isIdentifier(node.name) && hasBody(node.parent)) add(node, node.type, node.name);
    } else if (ts.isTypeAliasDeclaration(node) && node.typeParameters === undefined) {
      add(node, node.type, node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Adds the `as` names a file's import and export specifiers give: `onSnapshot` → `listen`. */
function addRenamed(file: ts.SourceFile, renamed: Map<string, Set<string>>): void {
  const add = (specifier: ts.ImportSpecifier | ts.ExportSpecifier): void => {
    const from = specifier.propertyName;
    if (from === undefined || !ts.isIdentifier(from)) return;
    const names = renamed.get(from.text) ?? new Set<string>();
    names.add(specifier.name.text);
    renamed.set(from.text, names);
  };
  const addName = (from: string, to: string): void => {
    if (from === to) return;
    const names = renamed.get(from) ?? new Set<string>();
    names.add(to);
    renamed.set(from, names);
  };
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) bindings.elements.forEach(add);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      statement.exportClause.elements.forEach(add);
    }
  }
  // `const listen = onSnapshot`, `const listen = db.onSnapshot` and
  // `const { onSnapshot: listen } = db`, anywhere in the file.
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      let value: ts.Expression = node.initializer;
      while (
        ts.isParenthesizedExpression(value) ||
        ts.isAsExpression(value) ||
        ts.isSatisfiesExpression(value) ||
        ts.isNonNullExpression(value)
      ) {
        value = value.expression;
      }
      if (ts.isIdentifier(value)) addName(value.text, node.name.text);
      else if (ts.isPropertyAccessExpression(value)) addName(value.name.text, node.name.text);
    } else if (
      ts.isBindingElement(node) &&
      node.propertyName !== undefined &&
      ts.isIdentifier(node.propertyName) &&
      ts.isIdentifier(node.name)
    ) {
      addName(node.propertyName.text, node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

/** Whether a file declares a member named `[Symbol.dispose]` or `[Symbol.asyncDispose]`. */
function declaresDisposeMember(file: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isComputedPropertyName(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Symbol" &&
      (node.expression.name.text === "dispose" || node.expression.name.text === "asyncDispose")
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * The guarantee names of one type that is not a union: one per optional `"__guarantee:<name>"`
 * property, and the string literals of an optional `__guarantee` property (the 1.1.0 form).
 */
function memberGuarantees(checker: ts.TypeChecker, type: ts.Type): readonly string[] {
  const names: string[] = [];
  for (const property of checker.getPropertiesOfType(type)) {
    const name = property.getName();
    if (!name.startsWith(GUARANTEE_PREFIX) || !(property.flags & ts.SymbolFlags.Optional)) continue;
    const trait = name.slice(GUARANTEE_PREFIX.length);
    if (trait !== "") names.push(trait);
  }
  return [...names, ...legacyGuarantees(checker, type)];
}

/** The names of the 1.1.0 form, `__guarantee?: "owned"`; none when it is required or not literals (a brand). */
function legacyGuarantees(checker: ts.TypeChecker, type: ts.Type): readonly string[] {
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
 * Whether an object type only states guarantees: every property is a guarantee marker. A literal
 * intersected with one (`"paid" & { "__guarantee:open-union"?: true }`, what `OpenUnion<T>` gives
 * each member) is still that literal.
 */
function isMarkerOnly(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  const properties = checker.getPropertiesOfType(type);
  return (
    properties.length > 0 &&
    properties.every((property) => {
      const name = property.getName();
      return (
        (name === GUARANTEE_PROPERTY || name.startsWith(GUARANTEE_PREFIX)) &&
        (property.flags & ts.SymbolFlags.Optional) !== 0
      );
    })
  );
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

/**
 * The literals of the `"__guarantee:<name>"` property of `type` (its first member that states it),
 * without the `undefined` the optional property adds; undefined when no member states it.
 */
function guaranteeValuesOfType(
  checker: ts.TypeChecker,
  found: ts.Type,
  name: string,
): readonly Literal[] | "not-finite" | undefined {
  const type = widened(checker, found);
  if (type === undefined) return undefined;
  for (const member of type.isUnion() ? type.types : [type]) {
    if (member.flags & NULLISH) continue;
    const property = checker.getPropertyOfType(member, `${GUARANTEE_PREFIX}${name}`);
    if (property === undefined || !(property.flags & ts.SymbolFlags.Optional)) continue;
    const value = checker.getTypeOfSymbol(property);
    const literals: Literal[] = [];
    for (const part of value.isUnion() ? value.types : [value]) {
      if (part.flags & ts.TypeFlags.Undefined) continue;
      const literal = literalOf(checker, part);
      if (literal === undefined) return "not-finite";
      literals.push(literal);
    }
    return literals.sort(compareLabels);
  }
  return undefined;
}

/**
 * How a value of `type` is disposed, read from its well-known symbol methods: `[Symbol.dispose]`
 * (`"sync"`), `[Symbol.asyncDispose]` (`"async"`), with the file that declares the method. Every
 * member but `null` and `undefined` must have the same. `any` and `unknown` have neither.
 */
function disposeOfType(
  checker: ts.TypeChecker,
  found: ts.Type,
): { kind: "sync" | "async"; file: string } | undefined {
  const type = widened(checker, found);
  if (type === undefined || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    return undefined;
  }
  const members = (type.isUnion() ? type.types : [type]).filter(
    (member) => (member.flags & NULLISH) === 0,
  );
  const kindOf = (member: ts.Type): { kind: "sync" | "async"; file: string } | undefined => {
    const properties = checker.getPropertiesOfType(member);
    for (const [prefix, kind] of [
      ["__@dispose@", "sync"],
      ["__@asyncDispose@", "async"],
    ] as const) {
      const property = properties.find((one) => String(one.escapedName).startsWith(prefix));
      const file = property?.declarations?.[0]?.getSourceFile().fileName;
      if (file !== undefined) return { kind, file };
    }
    return undefined;
  };
  const found2 = members.map(kindOf);
  const [first] = found2;
  if (first === undefined) return undefined;
  return found2.every((one) => one?.kind === first.kind && one.file === first.file)
    ? first
    : undefined;
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

/**
 * Whether a mapped part of `type` takes its keys from a type that does not resolve:
 * `{ [k in keyof typeof NAMES]: … }` where `NAMES` comes from a package that is not installed.
 * TypeScript then gives it index signatures for every key, which says nothing about its keys.
 */
function hasUnresolvedKeys(checker: ts.TypeChecker, type: ts.Type): boolean {
  const parts = type.isIntersection() ? type.types : [type];
  return parts.some((part) =>
    (part.getSymbol()?.declarations ?? []).some((declaration) => {
      if (!ts.isMappedTypeNode(declaration)) return false;
      const constraint = declaration.typeParameter.constraint;
      if (constraint === undefined) return false;
      let unresolved = false;
      const visit = (node: ts.Node): void => {
        if (unresolved) return;
        if (ts.isTypeNode(node) && isErrorTypeOf(checker.getTypeFromTypeNode(node))) {
          unresolved = true;
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(constraint);
      return unresolved;
    }),
  );
}

/** TypeScript's error type: an `any` whose intrinsic name is "error"; it has no public flag. */
function isErrorTypeOf(type: ts.Type): boolean {
  return !!(type.flags & ts.TypeFlags.Any) && Reflect.get(type, "intrinsicName") === "error";
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

/** See `TypeQueries.propIsDeeplyReadonly`: no part of a value of this type can be changed. */
function isDeeplyReadonly(checker: ts.TypeChecker, type: ts.Type, depth: number): boolean {
  if (depth > 6) return false;
  const resolved = widened(checker, type);
  if (resolved === undefined) return false;
  if (resolved.flags & (PRIMITIVE_FLAGS | ts.TypeFlags.Never | ts.TypeFlags.ESSymbolLike)) {
    return true;
  }
  if (resolved.isUnion() || resolved.isIntersection()) {
    return resolved.types.every((part) => isDeeplyReadonly(checker, part, depth + 1));
  }
  if (!(resolved.flags & ts.TypeFlags.Object)) return false;
  if (checker.getSignaturesOfType(resolved, ts.SignatureKind.Call).length > 0) return false;
  if (checker.getSignaturesOfType(resolved, ts.SignatureKind.Construct).length > 0) return false;
  const indexes = checker.getIndexInfosOfType(resolved);
  if (resolved.getSymbol()?.getName() === "ReadonlyArray") {
    return (
      indexes.length > 0 &&
      indexes.every((info) => info.isReadonly && isDeeplyReadonly(checker, info.type, depth + 1))
    );
  }
  return (
    indexes.every((info) => info.isReadonly && isDeeplyReadonly(checker, info.type, depth + 1)) &&
    checker
      .getPropertiesOfType(resolved)
      .every(
        (property) =>
          !(property.flags & ts.SymbolFlags.Method) &&
          isReadonlyProperty(resolved, property) &&
          isDeeplyReadonly(checker, checker.getTypeOfSymbol(property), depth + 1),
      )
  );
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

// ---- the reference ledger (`TypeQueries.statedReferencesIn`) ------------------------------------

/** A declaration that states traits the ledger lists, as `statedOf` finds it. */
type StatedOne = {
  /** The declaration's name: the one identifier that is not a reference to it. */
  readonly nameNode: ts.Node;
  readonly id: string;
  readonly name: string;
  /** The text a reference to it reads (`setSaving` for a holder whose declaration is `saving`). */
  readonly word: string;
  readonly marker: string;
  readonly traits: readonly string[];
};

/** A stated declaration the flow scan follows: a type alias, or a member a holder holds. */
type FlowTarget = {
  readonly stated: StatedOne;
  readonly symbol: ts.Symbol;
  readonly ref: SymbolRef;
  /** The file that declares it: a file whose imports do not reach it has no flow of it. */
  readonly file: string;
  /** Its traits, by the kind of flow listed for them. */
  readonly produced: readonly string[];
  readonly decided: readonly string[];
  readonly escaped: readonly string[];
};

/**
 * What the flow scan of one `proves` follows: the stated type aliases by their symbol and by the
 * types of their members (a value narrowed to `"paid" | "shipped"` is still `OrderStatus`'s), the
 * stated members by name, and the own files whose imports reach a declaring file.
 */
type FlowTargets = {
  readonly aliases: readonly FlowTarget[];
  readonly bySymbol: ReadonlyMap<ts.Symbol, FlowTarget>;
  readonly byMember: ReadonlyMap<ts.Type, readonly FlowTarget[]>;
  readonly members: ReadonlyMap<string, readonly FlowTarget[]>;
  readonly reaching: ReadonlySet<string> | "all";
};

/** The type questions the flow scan asks in one file before it stops (`TypeQueries.typedFlowsIn`). */
export const FLOW_BUDGET = 200_000;

/** How deep a type is searched for a stated alias: `Promise<Order>` → `Order` → `id: OrderId`. */
const FLOW_DEPTH = 3;

/** The words of a reference's text: one line, at most this long. */
const REFERENCE_TEXT_MAX = 60;

/** A JSDoc tag as one line, without the end of the comment: `@throws {AErr}`. */
function tagText(tag: ts.JSDocTag, sourceFile: ts.SourceFile): string {
  const [first = ""] = sourceFile.text.slice(tag.getStart(sourceFile), tag.end).split("\n");
  const text = first
    .replace(/\*\/.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= REFERENCE_TEXT_MAX ? text : `${text.slice(0, REFERENCE_TEXT_MAX - 1)}…`;
}

function shortText(node: ts.Node, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile).replace(/\s+/g, " ").trim();
  return text.length <= REFERENCE_TEXT_MAX ? text : `${text.slice(0, REFERENCE_TEXT_MAX - 1)}…`;
}

function isWrapperExpression(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  );
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** Whether `node` sits in a type (`typeof x` in an annotation, `x` in `implements x`). */
function inTypePosition(node: ts.Node): boolean {
  for (let at: ts.Node = node; !ts.isSourceFile(at.parent); at = at.parent) {
    const parent = at.parent;
    if (ts.isExpressionWithTypeArguments(parent)) {
      const clause = parent.parent;
      return ts.isHeritageClause(clause) && clause.token === ts.SyntaxKind.ImplementsKeyword;
    }
    if (ts.isTypeNode(parent)) return true;
    if (ts.isStatement(parent) || ts.isExpression(parent)) return false;
  }
  return false;
}

/**
 * The form of a reference at `node`, and the node whose text shows it. A reference that names a
 * member (`a.watch`) or an element key (`a["watch"]`) is the access around it.
 */
function referenceForm(node: ts.Node): { form: ReferenceForm; shown: ts.Node } {
  const parent = node.parent;
  if (inTypePosition(node)) return { form: "type", shown: node };
  if (
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent)
  ) {
    return { form: "import", shown: parent };
  }
  if (ts.isExportSpecifier(parent)) return { form: "export", shown: parent };
  if (ts.isJsxAttribute(parent) && parent.name === node) {
    return { form: "jsx-attribute", shown: parent };
  }
  if (ts.isBindingElement(parent)) return { form: "alias", shown: parent };
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) {
    return { form: "write", shown: parent };
  }
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
    return { form: "stored", shown: parent.parent };
  }
  let outer: ts.Node = node;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isElementAccessExpression(parent) && parent.argumentExpression === node)
  ) {
    outer = parent;
  }
  while (isWrapperExpression(outer.parent)) outer = outer.parent;
  const at = outer.parent;
  if (ts.isJsxOpeningElement(at) || ts.isJsxSelfClosingElement(at) || ts.isJsxClosingElement(at)) {
    return { form: "jsx-tag", shown: at };
  }
  if (ts.isExportAssignment(at)) return { form: "export", shown: at };
  if (
    ((ts.isCallExpression(at) || ts.isNewExpression(at) || ts.isDecorator(at)) &&
      at.expression === outer) ||
    (ts.isTaggedTemplateExpression(at) && at.tag === outer)
  ) {
    return { form: "call", shown: at };
  }
  if ((ts.isCallExpression(at) || ts.isNewExpression(at)) && at.expression !== outer) {
    return { form: "argument", shown: at };
  }
  if (ts.isSpreadElement(at) && (ts.isCallExpression(at.parent) || ts.isNewExpression(at.parent))) {
    return { form: "argument", shown: at.parent };
  }
  if (ts.isJsxExpression(at) || ts.isJsxSpreadAttribute(at)) {
    return { form: "argument", shown: at.parent };
  }
  if (
    (ts.isBinaryExpression(at) &&
      isAssignmentOperator(at.operatorToken.kind) &&
      at.left === outer) ||
    ((ts.isPrefixUnaryExpression(at) || ts.isPostfixUnaryExpression(at)) &&
      (at.operator === ts.SyntaxKind.PlusPlusToken ||
        at.operator === ts.SyntaxKind.MinusMinusToken)) ||
    ts.isDeleteExpression(at) ||
    ((ts.isForOfStatement(at) || ts.isForInStatement(at)) && at.initializer === outer)
  ) {
    return { form: "write", shown: at };
  }
  if (
    (ts.isVariableDeclaration(at) ||
      ts.isPropertyDeclaration(at) ||
      ts.isParameter(at) ||
      ts.isBindingElement(at)) &&
    at.initializer === outer
  ) {
    return { form: "alias", shown: at };
  }
  if (
    ts.isBinaryExpression(at) &&
    at.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    at.right === outer
  ) {
    return { form: "alias", shown: at };
  }
  if (ts.isArrayLiteralExpression(at) || ts.isSpreadAssignment(at)) {
    return { form: "stored", shown: ts.isSpreadAssignment(at) ? at.parent : at };
  }
  if (ts.isSpreadElement(at) && ts.isArrayLiteralExpression(at.parent)) {
    return { form: "stored", shown: at.parent };
  }
  if (ts.isPropertyAssignment(at) && at.initializer === outer) {
    return { form: "stored", shown: at.parent };
  }
  if (
    ts.isReturnStatement(at) ||
    ts.isYieldExpression(at) ||
    (ts.isArrowFunction(at) && at.body === outer)
  ) {
    return { form: "returned", shown: at };
  }
  if (
    ts.isComputedPropertyName(at) ||
    (ts.isElementAccessExpression(at) && at.argumentExpression === outer)
  ) {
    return { form: "computed", shown: at.parent };
  }
  if (
    ts.isConditionalExpression(at) && at.condition !== outer
      ? true
      : (ts.isBinaryExpression(at) &&
          (at.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
            at.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
            at.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
            at.operatorToken.kind === ts.SyntaxKind.CommaToken)) ||
        (ts.isForOfStatement(at) && at.expression === outer)
  ) {
    return { form: "other", shown: at };
  }
  if (
    ts.isPropertyAccessExpression(at) ||
    ts.isElementAccessExpression(at) ||
    ts.isConditionalExpression(at) ||
    ts.isBinaryExpression(at) ||
    ts.isPrefixUnaryExpression(at) ||
    ts.isPostfixUnaryExpression(at) ||
    ts.isTypeOfExpression(at) ||
    ts.isVoidExpression(at) ||
    ts.isAwaitExpression(at) ||
    ts.isTemplateSpan(at) ||
    ts.isExpressionStatement(at) ||
    ts.isIfStatement(at) ||
    ts.isWhileStatement(at) ||
    ts.isDoStatement(at) ||
    ts.isSwitchStatement(at) ||
    ts.isCaseClause(at) ||
    ts.isForInStatement(at) ||
    ts.isForStatement(at)
  ) {
    return { form: "read", shown: at };
  }
  return { form: "other", shown: at };
}

/**
 * The reference ledger's scan of one program: which declarations state a trait (`statedOf`, by
 * symbol, memoised), and every reference to them in a file (`referencesIn`).
 */
function createLedgerScan(
  program: ts.Program,
  typeChecker: () => ts.TypeChecker,
  isOwn: (file: string) => boolean,
  refOfSymbol: (symbol: ts.Symbol) => SymbolRef | undefined,
) {
  type Scan = {
    readonly traits: ReadonlySet<string>;
    readonly returns: ReadonlySet<string>;
    readonly made: ReadonlySet<string>;
    readonly holders: ReadonlySet<string>;
    /** The traits of `RuleProves.flows`, by kind. */
    readonly produced: ReadonlySet<string>;
    readonly decided: ReadonlySet<string>;
    readonly escaped: ReadonlySet<string>;
    /** The JSDoc tags of `RuleProves.tags`, without `@`. */
    readonly tags: ReadonlySet<string>;
    /** Whether a file's text holds one of `tags` (`@neverRejects`): only then is its JSDoc read. */
    readonly tagged: Map<ts.SourceFile, boolean>;
    readonly bySymbol: Map<ts.Symbol, StatedOne | null>;
    /** The names of the project's stated declarations: what an identifier must read to be one. */
    names: ReadonlySet<string> | undefined;
    /** The stated type aliases and members the flow scan follows (`flowTargets`). */
    targets: FlowTargets | undefined;
  };
  const scans = new Map<string, Scan>();

  const scanFor = (proves: RuleProves): Scan => {
    const sorted = (list: readonly string[] | undefined): string[] =>
      [...new Set(list ?? [])].sort();
    const traits = sorted(proves.traits);
    const returns = sorted(proves.returns);
    const made = sorted(proves.made);
    const holders = sorted(proves.holders);
    const produced = sorted(proves.flows?.produced);
    const decided = sorted(proves.flows?.decided);
    const escaped = sorted(proves.flows?.escaped);
    const tags = sorted(proves.tags);
    const key = JSON.stringify([traits, returns, made, holders, produced, decided, escaped, tags]);
    let scan = scans.get(key);
    if (scan === undefined) {
      scan = {
        traits: new Set(traits),
        returns: new Set(returns),
        made: new Set(made),
        holders: new Set(holders),
        produced: new Set(produced),
        decided: new Set(decided),
        escaped: new Set(escaped),
        tags: new Set(tags),
        tagged: new Map(),
        bySymbol: new Map(),
        names: undefined,
        targets: undefined,
      };
      scans.set(key, scan);
    }
    return scan;
  };

  /** The traits a type alias states for the flow scan: those of `produced` and `decided`. */
  const aliasTraits = (scan: Scan): ReadonlySet<string> =>
    new Set([...scan.produced, ...scan.decided]);

  const writtenTraits = (type: ts.TypeNode, wanted: ReadonlySet<string>): string[] => {
    if (definesMarker(type)) return [];
    const checker = typeChecker();
    return guaranteesOfType(checker, checker.getTypeFromTypeNode(type)).filter((one) =>
      wanted.has(one),
    );
  };

  /** A rest parameter states a trait by its elements: `...stops: Release<…>[]`. */
  const restTraits = (type: ts.TypeNode, wanted: ReadonlySet<string>): string[] => {
    const checker = typeChecker();
    const element = checker.getIndexTypeOfType(
      checker.getTypeFromTypeNode(type),
      ts.IndexKind.Number,
    );
    return element === undefined
      ? []
      : guaranteesOfType(checker, element).filter((one) => wanted.has(one));
  };

  /** What a function states by its written return type, or the promise it returns. */
  const returnTraits = (fn: ts.SignatureDeclaration, wanted: ReadonlySet<string>): string[] => {
    if (fn.type === undefined || wanted.size === 0 || definesMarker(fn.type)) return [];
    const checker = typeChecker();
    const type = checker.getTypeFromTypeNode(fn.type);
    const direct = guaranteesOfType(checker, type);
    const awaited = checker.getAwaitedType(type);
    const all =
      awaited === undefined || awaited === type
        ? direct
        : [...direct, ...guaranteesOfType(checker, awaited)];
    return [...new Set(all)].filter((one) => wanted.has(one)).sort();
  };

  /** The marker as the annotation writes it: the first reference in it that states a trait. */
  const markerOf = (type: ts.TypeNode | undefined, fallback: string): string => {
    if (type === undefined) return fallback;
    const checker = typeChecker();
    let found: string | undefined;
    const visit = (node: ts.Node): void => {
      if (found !== undefined) return;
      if (
        ts.isTypeReferenceNode(node) &&
        guaranteesOfType(checker, checker.getTypeFromTypeNode(node)).length > 0
      ) {
        found = node.typeName.getText();
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(type);
    return found ?? fallback;
  };

  const heldFunction = (node: ts.Node): ts.SignatureDeclaration | undefined => {
    if (
      !(ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) ||
      node.initializer === undefined
    ) {
      return undefined;
    }
    let value: ts.Expression = node.initializer;
    while (
      ts.isParenthesizedExpression(value) ||
      ts.isAsExpression(value) ||
      ts.isSatisfiesExpression(value) ||
      ts.isNonNullExpression(value) ||
      ts.isTypeAssertionExpression(value)
    ) {
      value = value.expression;
    }
    return ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value : undefined;
  };

  /** Whether `file`'s text writes one of the tags `scan` lists. */
  const writesTags = (file: ts.SourceFile, scan: Scan): boolean => {
    if (scan.tags.size === 0) return false;
    let known = scan.tagged.get(file);
    if (known === undefined) {
      known = [...scan.tags].some((tag) => file.text.includes(`@${tag}`));
      scan.tagged.set(file, known);
    }
    return known;
  };

  /**
   * The JSDoc tags of `scan` written on a declaration a tag can state a trait of (a function, a
   * method, a variable, a property or method of a type, a type alias), with the tag nodes; a
   * variable's tags may sit on the function it holds too.
   */
  const tagsOn = (node: ts.Node, scan: Scan): ReadonlyMap<string, ts.JSDocTag> => {
    const found = new Map<string, ts.JSDocTag>();
    if (
      !(
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isMethodSignature(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isPropertySignature(node) ||
        ts.isTypeAliasDeclaration(node)
      ) ||
      !writesTags(node.getSourceFile(), scan)
    ) {
      return found;
    }
    const held = heldFunction(node);
    for (const at of held === undefined ? [node] : [node, held]) {
      for (const tag of ts.getJSDocTags(at)) {
        const name = tag.tagName.text;
        if (scan.tags.has(name) && !found.has(`@${name}`)) found.set(`@${name}`, tag);
      }
    }
    return found;
  };

  /** The value a declaration is made by, through `(…)`, `as`, `satisfies` and `!`. */
  const madeBy = (node: ts.VariableDeclaration): ts.Expression | undefined => {
    let value = node.initializer;
    while (
      value !== undefined &&
      (ts.isParenthesizedExpression(value) ||
        ts.isAsExpression(value) ||
        ts.isSatisfiesExpression(value) ||
        ts.isNonNullExpression(value) ||
        ts.isTypeAssertionExpression(value))
    ) {
      value = value.expression;
    }
    return value;
  };

  /**
   * What a module variable with no written type states by the call that makes it (`const
   * ThemeContext = requiredContext<Theme>()`), of the traits `wanted` lists.
   */
  const madeTraits = (node: ts.VariableDeclaration, wanted: ReadonlySet<string>): string[] => {
    if (wanted.size === 0 || node.type !== undefined || !ts.isIdentifier(node.name)) return [];
    // Only a module's own variables: a variable inside a function is asked no type question.
    const statement = node.parent.parent;
    if (!ts.isVariableStatement(statement) || !ts.isSourceFile(statement.parent)) return [];
    const value = madeBy(node);
    if (value === undefined || !ts.isCallExpression(value)) return [];
    const checker = typeChecker();
    return guaranteesOfType(checker, checker.getTypeAtLocation(node.name)).filter((one) =>
      wanted.has(one),
    );
  };

  /** The types written on a variable: its annotation, and the type arguments of the call that makes it. */
  const writtenOn = (node: ts.VariableDeclaration): readonly ts.TypeNode[] => {
    if (node.type !== undefined) return [node.type];
    const value = madeBy(node);
    return value !== undefined && ts.isCallExpression(value)
      ? [...(value.typeArguments ?? [])]
      : [];
  };

  /** The traits of `wanted` a type holds: itself, a union member, a parameter or a return, three levels down. */
  const heldTraits = (type: ts.Type, wanted: ReadonlySet<string>, depth: number): string[] => {
    const checker = typeChecker();
    const found = new Set(guaranteesOfType(checker, type).filter((one) => wanted.has(one)));
    if (depth < 3) {
      const parts = type.isUnion() ? type.types : [];
      for (const part of parts) {
        for (const one of heldTraits(part, wanted, depth + 1)) found.add(one);
      }
      for (const signature of type.getCallSignatures()) {
        const types = [
          ...signature.parameters.map((parameter) => checker.getTypeOfSymbol(parameter)),
          signature.getReturnType(),
        ];
        for (const one of types) {
          for (const trait of heldTraits(one, wanted, depth + 1)) found.add(trait);
        }
      }
    }
    return [...found].sort();
  };

  /**
   * An element of an array destructuring (`setSaving` of `const [saving, setSaving] =
   * useState<Pending<boolean>>(false)`) whose declaration writes a trait `scan.holders` lists, and
   * whose own type holds it: the variable declaration is the stated declaration, named by the
   * first element.
   */
  const heldDeclaration = (node: ts.BindingElement, scan: Scan): StatedOne | undefined => {
    const pattern = node.parent;
    const holder = pattern.parent;
    if (
      scan.holders.size === 0 ||
      !ts.isArrayBindingPattern(pattern) ||
      !ts.isVariableDeclaration(holder) ||
      !ts.isIdentifier(node.name) ||
      node.dotDotDotToken !== undefined
    ) {
      return undefined;
    }
    const written = writtenOn(holder).flatMap((type) => writtenTraits(type, scan.holders));
    if (written.length === 0) return undefined;
    const checker = typeChecker();
    const traits = heldTraits(checker.getTypeAtLocation(node.name), new Set(written), 0);
    const [first] = pattern.elements;
    if (traits.length === 0 || first === undefined) return undefined;
    const file = node.getSourceFile();
    return {
      nameNode: node.name,
      id: `${file.fileName}#${String(holder.getStart(file))}`,
      // `const [, setSaving] = …`: the setter alone names the state.
      name: ts.isBindingElement(first) ? first.name.getText(file) : node.name.text,
      word: node.name.text,
      marker: markerOf(writtenOn(holder)[0], traits[0] ?? ""),
      traits,
    };
  };

  /**
   * Whether a written type names, as its marker, another type alias that states a trait itself
   * (`type Id = OrderId`): that alias is the stated declaration, as core's scan reads it.
   */
  const aliasOfStatedAlias = (type: ts.TypeNode): boolean => {
    const checker = typeChecker();
    let found: ts.TypeReferenceNode | undefined;
    const visit = (node: ts.Node): void => {
      if (found !== undefined) return;
      if (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        guaranteesOfType(checker, checker.getTypeFromTypeNode(node)).length > 0
      ) {
        found = node;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(type);
    if (found === undefined) return false;
    const symbol = checker.getSymbolAtLocation(found.typeName);
    const target = symbol === undefined ? undefined : resolved(symbol);
    return (
      target?.declarations?.some(
        (declaration) =>
          ts.isTypeAliasDeclaration(declaration) &&
          declaration.typeParameters === undefined &&
          !definesMarker(declaration.type) &&
          guaranteesOfType(checker, checker.getTypeFromTypeNode(declaration.type)).length > 0,
      ) === true
    );
  };

  /** The traits a declaration states (of those `scan` lists), with its name and marker. */
  const statedDeclaration = (node: ts.Node, scan: Scan): StatedOne | undefined => {
    const file = node.getSourceFile();
    if (!isOwn(file.fileName)) return undefined;
    if (ts.isBindingElement(node)) return heldDeclaration(node, scan);
    let traits: string[] = [];
    let type: ts.TypeNode | undefined;
    let name: ts.Node | undefined;
    if (
      ts.isVariableDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node)
    ) {
      if (!(
        ts.isIdentifier(node.name) ||
        ts.isPrivateIdentifier(node.name) ||
        ts.isStringLiteral(node.name)
      )) {
        return undefined;
      }
      name = node.name;
      if (node.type !== undefined) {
        type = node.type;
        traits = writtenTraits(node.type, scan.traits);
      }
      const fn = heldFunction(node);
      if (fn !== undefined) {
        const returned = returnTraits(fn, scan.returns);
        if (returned.length > 0 && type === undefined) type = fn.type;
        traits = [...traits, ...returned];
      }
      if (ts.isVariableDeclaration(node)) traits = [...traits, ...madeTraits(node, scan.made)];
      // `const st = useState<Pending<boolean>>(false)`: the pair kept whole holds the state; its
      // reads (`st[1](true)`) are references the proof reads or lists as not checked.
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.type === undefined) {
        traits = [
          ...traits,
          ...writtenOn(node).flatMap((written) => writtenTraits(written, scan.holders)),
        ];
      }
      traits = [...traits, ...tagsOn(node, scan).keys()];
    } else if (ts.isParameter(node)) {
      const fn = node.parent;
      if (!ts.isIdentifier(node.name) || node.type === undefined) return undefined;
      if (!("body" in fn) || fn.body === undefined) return undefined;
      name = node.name;
      type = node.type;
      // `o: typeof settings` names the type of a stated value; it states nothing of its own.
      traits = ts.isTypeQueryNode(node.type)
        ? []
        : node.dotDotDotToken === undefined
          ? writtenTraits(node.type, scan.traits)
          : restTraits(node.type, scan.traits);
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name !== undefined
    ) {
      name = node.name;
      type = node.type;
      traits = [...returnTraits(node, scan.returns), ...tagsOn(node, scan).keys()];
    } else if (ts.isMethodSignature(node) && ts.isIdentifier(node.name)) {
      name = node.name;
      traits = [...tagsOn(node, scan).keys()];
    } else if (ts.isTypeAliasDeclaration(node)) {
      // `type OrderId = Opaque<string, "OrderId">`: a type a flow trait is stated on. An alias of
      // such an alias (`type Id = OrderId`) states nothing of its own. A tag may sit on any alias.
      const wanted = aliasTraits(scan);
      name = node.name;
      if (node.typeParameters === undefined && wanted.size > 0 && !aliasOfStatedAlias(node.type)) {
        type = node.type;
        traits = writtenTraits(node.type, wanted);
      }
      traits = [...traits, ...tagsOn(node, scan).keys()];
    }
    if (name === undefined || traits.length === 0) return undefined;
    // A property is listed at its name (after `static`, `readonly`), anything else where it starts.
    const start =
      ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)
        ? name.getStart(file)
        : node.getStart(file);
    const sorted = [...new Set(traits)].sort();
    return {
      nameNode: name,
      id: `${file.fileName}#${String(start)}`,
      name: name.getText(file),
      word:
        ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)
          ? name.text
          : name.getText(file),
      marker: markerOf(type, sorted[0] ?? ""),
      traits: sorted,
    };
  };

  const statedOf = (symbol: ts.Symbol, scan: Scan): StatedOne | undefined => {
    const known = scan.bySymbol.get(symbol);
    if (known !== undefined) return known ?? undefined;
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    const found = declaration === undefined ? undefined : statedDeclaration(declaration, scan);
    scan.bySymbol.set(symbol, found ?? null);
    return found;
  };

  /** The names of every stated declaration of the project's files: the prefilter's words. */
  const namesOf = (scan: Scan): ReadonlySet<string> => {
    if (scan.names !== undefined) return scan.names;
    const names = new Set<string>();
    const declared = (trait: string): boolean =>
      program
        .getSourceFiles()
        .some(
          (file) =>
            file.text.includes(`${GUARANTEE_PREFIX}${trait}`) &&
            declaresMarkerProperty(file, `${GUARANTEE_PREFIX}${trait}`),
        );
    // Values are asked about only when a trait a value states is declared, type aliases only when
    // a flow trait is: a project that declares only `Opaque` asks nothing of its variables.
    const values = [...scan.traits, ...scan.returns, ...scan.made, ...scan.holders].some(declared);
    const aliases = [...aliasTraits(scan)].some(declared);
    const ownFiles = program.getSourceFiles().filter((file) => isOwn(file.fileName));
    const tags = ownFiles.some((file) => writesTags(file, scan));
    if (values || aliases || tags) {
      for (const file of ownFiles) {
        const tagged = writesTags(file, scan);
        if (!values && !aliases && !tagged) continue;
        const visit = (node: ts.Node): void => {
          if (
            (tagged && tagsOn(node, scan).size > 0) ||
            (values &&
              (ts.isVariableDeclaration(node) ||
                ts.isPropertyDeclaration(node) ||
                ts.isPropertySignature(node) ||
                ts.isParameter(node) ||
                ts.isFunctionDeclaration(node) ||
                ts.isMethodDeclaration(node)) &&
              (node.type !== undefined ||
                heldFunction(node)?.type !== undefined ||
                (scan.made.size > 0 &&
                  ts.isVariableDeclaration(node) &&
                  node.initializer !== undefined))) ||
            (values &&
              scan.holders.size > 0 &&
              ts.isBindingElement(node) &&
              ts.isArrayBindingPattern(node.parent)) ||
            (aliases && ts.isTypeAliasDeclaration(node))
          ) {
            const stated = statedDeclaration(node, scan);
            if (stated !== undefined) names.add(stated.word);
          }
          ts.forEachChild(node, visit);
        };
        visit(file);
      }
    }
    scan.names = names;
    return names;
  };

  const resolved = (symbol: ts.Symbol): ts.Symbol =>
    symbol.flags & ts.SymbolFlags.Alias ? typeChecker().getAliasedSymbol(symbol) : symbol;

  /** The symbol a name refers to, as find-references reads it. */
  const symbolOfReference = (node: ts.Node): ts.Symbol | undefined => {
    const checker = typeChecker();
    const parent = node.parent;
    if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
      return checker.getShorthandAssignmentValueSymbol(parent);
    }
    if (ts.isExportSpecifier(parent)) {
      return parent.parent.parent.moduleSpecifier === undefined
        ? checker.getExportSpecifierLocalTargetSymbol(parent)
        : checker.getSymbolAtLocation(node);
    }
    if (
      ts.isBindingElement(parent) &&
      ts.isObjectBindingPattern(parent.parent) &&
      (parent.propertyName === node || (parent.propertyName === undefined && parent.name === node))
    ) {
      const key = parent.propertyName ?? parent.name;
      if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) return undefined;
      return checker.getTypeAtLocation(parent.parent).getProperty(key.text);
    }
    if (ts.isJsxAttribute(parent) && parent.name === node && ts.isIdentifier(node)) {
      // `<Search onSearch={post} />`: the prop of the component's props type, as find-references reads it.
      const contextual = checker.getContextualType(parent.parent);
      const whole = contextual?.getProperty(node.text);
      if (whole !== undefined || !contextual?.isUnion()) {
        return whole ?? checker.getSymbolAtLocation(node);
      }
      const found = contextual.types.flatMap((member) => member.getProperty(node.text) ?? []);
      return found.length === 1 ? found[0] : checker.getSymbolAtLocation(node);
    }
    if (
      (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) &&
      parent.name === node &&
      ts.isObjectLiteralExpression(parent.parent)
    ) {
      const contextual = checker.getContextualType(parent.parent);
      if (contextual === undefined || !ts.isIdentifier(node)) return undefined;
      // `setForm({ ...form, saving: true })`: the setter takes `Form | ((prev: Form) => Form)`, and
      // the property is `Form`'s, as find-references reads it.
      const whole = contextual.getProperty(node.text);
      if (whole !== undefined || !contextual.isUnion()) return whole;
      const found = contextual.types.flatMap((member) => member.getProperty(node.text) ?? []);
      return found.length === 1 ? found[0] : undefined;
    }
    return checker.getSymbolAtLocation(node);
  };

  /**
   * The local names `file` gives stated declarations by an import (`import { a as b }`, a default
   * import, `import x = …`) or a re-export (`export { default as b } from …`): a reference by such
   * a name does not read the declaration's name.
   */
  const importedNames = (file: ts.SourceFile, scan: Scan): Set<string> => {
    const found = new Set<string>();
    const consider = (name: ts.Identifier): void => {
      const symbol = typeChecker().getSymbolAtLocation(name);
      if (symbol === undefined) return;
      const target = resolved(symbol);
      for (const root of typeChecker().getRootSymbols(target)) {
        if (statedOf(root, scan) !== undefined) found.add(name.text);
      }
    };
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.name !== undefined) consider(clause.name);
        const bindings = clause?.namedBindings;
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) consider(element.name);
        }
      } else if (ts.isImportEqualsDeclaration(statement)) {
        consider(statement.name);
      } else if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause)
      ) {
        // `export { default as dflt } from "./owner.js"`: both names are references.
        for (const element of statement.exportClause.elements) {
          if (ts.isIdentifier(element.name)) consider(element.name);
          if (element.propertyName !== undefined && ts.isIdentifier(element.propertyName)) {
            consider(element.propertyName);
          }
        }
      }
    }
    return found;
  };

  /** Whether `node` is the name of the declaration it resolves to (not a reference to it). */
  const isOwnName = (node: ts.Node, stated: StatedOne): boolean => stated.nameNode === node;

  const referencesIn = (sourceFile: ts.SourceFile, proves: RuleProves): StatedReference[] => {
    const scan = scanFor(proves);
    if (
      scan.traits.size === 0 &&
      scan.returns.size === 0 &&
      scan.made.size === 0 &&
      scan.holders.size === 0 &&
      scan.tags.size === 0 &&
      aliasTraits(scan).size === 0
    ) {
      return [];
    }
    const names = namesOf(scan);
    if (names.size === 0) return [];
    const words = new Set(names);
    const { text } = sourceFile;
    const mentions = [...names].some((name) => text.includes(name.replace(/^#/, "")));
    for (const name of importedNames(sourceFile, scan)) words.add(name);
    if (!mentions && words.size === names.size) return [];
    const found: StatedReference[] = [];
    const add = (node: ts.Node): void => {
      const symbol = symbolOfReference(node);
      if (symbol === undefined) return;
      const seen = new Set<string>();
      for (const root of typeChecker().getRootSymbols(resolved(symbol))) {
        const stated = statedOf(root, scan);
        if (stated === undefined || seen.has(stated.id) || isOwnName(node, stated)) continue;
        seen.add(stated.id);
        const ref = refOfSymbol(root);
        if (ref === undefined) continue;
        const { form, shown } = referenceForm(node);
        for (const trait of stated.traits) {
          found.push({
            declaration: stated.id,
            symbol: ref,
            name: stated.name,
            marker: stated.marker,
            trait,
            node,
            form,
            text: shortText(shown, sourceFile),
          });
        }
      }
    };
    const tagged = writesTags(sourceFile, scan);
    /** The tags on a declaration of this file: each is a reference that stands for its body. */
    const addTags = (node: ts.Node): void => {
      const tags = tagsOn(node, scan);
      if (tags.size === 0) return;
      const stated = statedDeclaration(node, scan);
      const symbol = stated === undefined ? undefined : symbolOfReference(stated.nameNode);
      const ref = symbol === undefined ? undefined : refOfSymbol(symbol);
      if (stated === undefined || ref === undefined) return;
      for (const [trait, tag] of tags) {
        found.push({
          declaration: stated.id,
          symbol: ref,
          name: stated.name,
          marker: stated.marker,
          trait,
          node: tag,
          form: "tag",
          text: tagText(tag, sourceFile),
        });
      }
    };
    const visit = (node: ts.Node): void => {
      if (tagged) addTags(node);
      if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && words.has(node.text)) {
        add(node);
      } else if (
        ts.isStringLiteral(node) &&
        ts.isElementAccessExpression(node.parent) &&
        node.parent.argumentExpression === node &&
        names.has(node.text)
      ) {
        add(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found.sort(
      (a, b) =>
        a.node.getStart(sourceFile) - b.node.getStart(sourceFile) ||
        (a.declaration < b.declaration ? -1 : a.declaration > b.declaration ? 1 : 0) ||
        (a.trait < b.trait ? -1 : a.trait > b.trait ? 1 : 0),
    );
  };

  /** The own files each own file imports (and re-exports from, and `import()`s). */
  const importsOf = (file: ts.SourceFile): string[] => {
    const checker = typeChecker();
    const found: string[] = [];
    const add = (specifier: ts.Node | undefined): void => {
      if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return;
      const symbol = checker.getSymbolAtLocation(specifier);
      const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      if (declaration !== undefined && ts.isSourceFile(declaration)) {
        found.push(declaration.fileName);
      }
    };
    const dynamic = file.text.includes("import(") || file.text.includes("require(");
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
      else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        add(node.moduleReference.expression);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        add(node.argument.literal);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        add(node.arguments[0]);
      }
      if (
        dynamic ||
        ts.isSourceFile(node) ||
        ts.isModuleDeclaration(node) ||
        ts.isModuleBlock(node)
      ) {
        ts.forEachChild(node, visit);
      }
    };
    visit(file);
    return found;
  };

  /**
   * The own files whose imports reach one of `declaring`: the declaring files, and every file that
   * imports one of the set, until none is added. A declaring file that is not a module (its
   * types are global) is reached by every file.
   */
  const reachingFiles = (declaring: ReadonlySet<string>): ReadonlySet<string> | "all" => {
    const files = program.getSourceFiles().filter((file) => isOwn(file.fileName));
    if (files.some((file) => declaring.has(file.fileName) && !ts.isExternalModule(file))) {
      return "all";
    }
    const importers = new Map<string, string[]>();
    for (const file of files) {
      for (const imported of importsOf(file)) {
        const list = importers.get(imported) ?? [];
        list.push(file.fileName);
        importers.set(imported, list);
      }
    }
    const reached = new Set(declaring);
    const queue = [...declaring];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      for (const importer of importers.get(next) ?? []) {
        if (reached.has(importer)) continue;
        reached.add(importer);
        queue.push(importer);
      }
    }
    return reached;
  };

  /** The stated type aliases and members of `scan`'s flow traits, found once per scan. */
  const flowTargets = (scan: Scan): FlowTargets => {
    if (scan.targets !== undefined) return scan.targets;
    const checker = typeChecker();
    const aliases: FlowTarget[] = [];
    const bySymbol = new Map<ts.Symbol, FlowTarget>();
    const byMember = new Map<ts.Type, FlowTarget[]>();
    const members = new Map<string, FlowTarget[]>();
    const alias = aliasTraits(scan);
    const wanted = [...alias, ...scan.escaped];
    const declared = wanted.filter((trait) =>
      program
        .getSourceFiles()
        .some(
          (file) =>
            file.text.includes(`${GUARANTEE_PREFIX}${trait}`) &&
            declaresMarkerProperty(file, `${GUARANTEE_PREFIX}${trait}`),
        ),
    );
    const target = (stated: StatedOne, symbol: ts.Symbol, file: string): FlowTarget | undefined => {
      const ref = refOfSymbol(symbol);
      if (ref === undefined) return undefined;
      return {
        stated,
        symbol,
        ref,
        file,
        produced: stated.traits.filter((trait) => scan.produced.has(trait)),
        decided: stated.traits.filter((trait) => scan.decided.has(trait)),
        escaped: stated.traits.filter((trait) => scan.escaped.has(trait)),
      };
    };
    if (declared.length > 0) {
      for (const file of program.getSourceFiles()) {
        if (!isOwn(file.fileName)) continue;
        const visit = (node: ts.Node): void => {
          if (ts.isTypeAliasDeclaration(node) && alias.size > 0) {
            const stated = statedDeclaration(node, scan);
            const symbol = checker.getSymbolAtLocation(node.name);
            const found =
              stated === undefined || symbol === undefined
                ? undefined
                : target(stated, symbol, file.fileName);
            if (found !== undefined && (found.produced.length > 0 || found.decided.length > 0)) {
              aliases.push(found);
              bySymbol.set(found.symbol, found);
              const type = checker.getDeclaredTypeOfSymbol(found.symbol);
              for (const member of type.isUnion() ? type.types : [type]) {
                if (member.flags & NULLISH) continue;
                byMember.set(member, [...(byMember.get(member) ?? []), found]);
              }
            }
          } else if (
            scan.escaped.size > 0 &&
            (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) &&
            node.type !== undefined
          ) {
            const stated = statedDeclaration(node, scan);
            const symbol = checker.getSymbolAtLocation(node.name);
            const found =
              stated === undefined || symbol === undefined
                ? undefined
                : target(stated, symbol, file.fileName);
            if (found !== undefined && found.escaped.length > 0) {
              members.set(stated?.word ?? "", [...(members.get(stated?.word ?? "") ?? []), found]);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(file);
      }
    }
    const declaring = new Set([
      ...aliases.map((one) => one.file),
      ...[...members.values()].flat().map((one) => one.file),
    ]);
    scan.targets = {
      aliases,
      bySymbol,
      byMember,
      members,
      reaching: declaring.size === 0 ? new Set() : reachingFiles(declaring),
    };
    return scan.targets;
  };

  /** Through `(…)`, `!` and a branch of `?:`, `??`, `||`, `&&` or `,`: the values an expression gives. */
  const leavesOf = (expression: ts.Expression): ts.Expression[] => {
    if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression)) {
      return leavesOf(expression.expression);
    }
    if (ts.isConditionalExpression(expression)) {
      return [...leavesOf(expression.whenTrue), ...leavesOf(expression.whenFalse)];
    }
    if (ts.isBinaryExpression(expression)) {
      const kind = expression.operatorToken.kind;
      if (
        kind === ts.SyntaxKind.QuestionQuestionToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        return [...leavesOf(expression.left), ...leavesOf(expression.right)];
      }
      if (kind === ts.SyntaxKind.CommaToken) return leavesOf(expression.right);
    }
    return [expression];
  };

  /** Whether every value of `type` is `undefined`, `null`, `void` or `never`: it builds nothing. */
  const holdsNothing = (type: ts.Type): boolean =>
    (type.isUnion() ? type.types : [type]).every(
      (member) =>
        (member.flags &
          (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void | ts.TypeFlags.Never)) !==
        0,
    );

  /** `Object.assign`, `Reflect.set`: the callee's two words, or undefined. */
  const calleeWords = (call: ts.CallExpression | ts.NewExpression): string | undefined => {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      return `${callee.expression.text}.${callee.name.text}`;
    }
    return undefined;
  };

  /** Methods that decide by the value they are given: `list.includes(s)`, `map.get(s)`. */
  const DECIDING_METHODS: ReadonlySet<string> = new Set([
    "includes",
    "indexOf",
    "lastIndexOf",
    "has",
    "get",
  ]);

  /** Calls that read a value as a key of an object: a lookup by it. */
  const KEYED_CALLS: ReadonlySet<string> = new Set([
    "Reflect.get",
    "Reflect.has",
    "Reflect.getOwnPropertyDescriptor",
    "Object.hasOwn",
  ]);

  /** Calls that write a property of their first argument whatever its type says. */
  const REFLECT_WRITES: ReadonlySet<string> = new Set([
    "Object.assign",
    "Object.defineProperty",
    "Object.defineProperties",
    "Object.setPrototypeOf",
    "Reflect.set",
    "Reflect.defineProperty",
    "Reflect.setPrototypeOf",
  ]);

  const flowsIn = (
    sourceFile: ts.SourceFile,
    proves: RuleProves,
    budget: number,
  ): StatedReference[] => {
    const scan = scanFor(proves);
    if (aliasTraits(scan).size === 0 && scan.escaped.size === 0) return [];
    const targets = flowTargets(scan);
    if (targets.aliases.length === 0 && targets.members.size === 0) return [];
    if (targets.reaching !== "all" && !targets.reaching.has(sourceFile.fileName)) return [];
    const checker = typeChecker();
    const found: StatedReference[] = [];
    const seen = new Set<string>();
    let questions = 0;
    let stopped: ts.Node | undefined;

    const add = (
      node: ts.Node,
      shown: ts.Node,
      flow: FlowTarget,
      kind: FlowKind,
      via: FlowVia,
    ): void => {
      const traits = flow[kind];
      for (const trait of traits) {
        const key = `${String(node.getStart(sourceFile))}-${String(node.end)}-${flow.stated.id}-${trait}-${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          declaration: flow.stated.id,
          symbol: flow.ref,
          name: flow.stated.name,
          marker: flow.stated.marker,
          trait,
          node,
          form: kind,
          via,
          text: shortText(shown, sourceFile),
        });
      }
    };

    const typeAt = (node: ts.Node): ts.Type => {
      questions += 1;
      return checker.getTypeAtLocation(node);
    };
    const contextual = (node: ts.Expression): ts.Type | undefined => {
      questions += 1;
      return checker.getContextualType(node);
    };

    // ---- what a type holds -------------------------------------------------------------------
    const heldMemo = new Map<ts.Type, readonly FlowTarget[]>();
    /** The stated aliases a type holds: itself, a member, a constraint, three levels in. */
    const aliasesIn = (type: ts.Type): readonly FlowTarget[] => {
      const known = heldMemo.get(type);
      if (known !== undefined) return known;
      const into = new Set<FlowTarget>();
      const visiting = new Set<ts.Type>();
      const enter = (given: ts.Type, depth: number): void => {
        if (depth > FLOW_DEPTH || visiting.has(given)) return;
        questions += 1;
        const named =
          given.aliasSymbol === undefined ? undefined : targets.bySymbol.get(given.aliasSymbol);
        if (named !== undefined) into.add(named);
        for (const one of targets.byMember.get(given) ?? []) into.add(one);
        if (given.flags & PRIMITIVE_FLAGS) return;
        visiting.add(given);
        if (given.flags & ts.TypeFlags.TypeParameter) {
          const constraint = checker.getBaseConstraintOfType(given);
          if (constraint !== undefined && constraint !== given) enter(constraint, depth);
        } else if (given.isUnionOrIntersection()) {
          for (const member of given.types) enter(member, depth);
        } else if (depth < FLOW_DEPTH && given.flags & ts.TypeFlags.Object) {
          if (isTypeReference(given)) {
            for (const argument of checker.getTypeArguments(given)) enter(argument, depth + 1);
          }
          for (const signature of given.getCallSignatures()) {
            enter(signature.getReturnType(), depth + 1);
          }
          // `Record<string, OrderId>`: an alias's type arguments, and any index signature.
          for (const argument of given.aliasTypeArguments ?? []) enter(argument, depth + 1);
          for (const info of checker.getIndexInfosOfType(given)) enter(info.type, depth + 1);
          if (isOwnObject(given)) {
            for (const property of checker.getPropertiesOfType(given)) {
              enter(checker.getTypeOfSymbol(property), depth + 1);
            }
          }
        }
        visiting.delete(given);
      };
      enter(type, 0);
      const list = [...into].sort((a, b) => compareIds(a.stated.id, b.stated.id));
      heldMemo.set(type, list);
      return list;
    };

    /** An object type the scan looks into: written in place, or declared in the project. */
    const isOwnObject = (type: ts.Type): boolean => {
      if (isAnonymousObject(type)) return true;
      const declarations = type.getSymbol()?.declarations ?? [];
      return declarations.some((one) => isOwn(one.getSourceFile().fileName));
    };

    /** The stated aliases `type` is itself (a member of): not what it holds inside. */
    const aliasesOf = (type: ts.Type): FlowTarget[] => {
      const named =
        type.aliasSymbol === undefined ? undefined : targets.bySymbol.get(type.aliasSymbol);
      if (named !== undefined) return [named];
      const into = new Set<FlowTarget>();
      for (const member of type.isUnion() ? type.types : [type]) {
        if (member.flags & NULLISH) continue;
        const own =
          member.aliasSymbol === undefined ? undefined : targets.bySymbol.get(member.aliasSymbol);
        if (own !== undefined) into.add(own);
        for (const one of targets.byMember.get(member) ?? []) into.add(one);
      }
      return [...into];
    };

    /**
     * Whether every member of `source` fits a member of `target` that holds no stated alias: a
     * `number` given as `OrderId | number` builds no `OrderId`.
     */
    const fitsOther = (source: ts.Type, target: ts.Type): boolean => {
      const others = (target.isUnion() ? target.types : [target]).filter(
        (member) => aliasesIn(member).length === 0,
      );
      if (others.length === 0) return false;
      return (source.isUnion() ? source.types : [source]).every((member) =>
        others.some((other) => checker.isTypeAssignableTo(member, other)),
      );
    };

    // ---- produced ----------------------------------------------------------------------------
    /** A value given to a place of type `target`: each of its values whose own type lacks an alias it holds. */
    const given = (expression: ts.Expression, target: ts.Type | undefined, via?: FlowVia): void => {
      if (target === undefined) return;
      const wanted = aliasesIn(target).filter((one) => one.produced.length > 0);
      if (wanted.length === 0) return;
      for (const leaf of leavesOf(expression)) {
        // A literal's members are places of their own; a cast is read as one.
        if (ts.isObjectLiteralExpression(leaf) || ts.isArrayLiteralExpression(leaf)) continue;
        const source = typeAt(leaf);
        if (holdsNothing(source)) continue;
        const any = (source.flags & ts.TypeFlags.Any) !== 0;
        const own = any ? [] : aliasesIn(source);
        if (!any && fitsOther(source, target)) continue;
        const kind: FlowVia =
          via ?? (any ? "any" : source.getCallSignatures().length > 0 ? "function-type" : "value");
        for (const one of wanted) {
          if (!own.includes(one)) add(leaf, leaf, one, "produced", kind);
        }
      }
    };

    /** The return types of the other declarations of an overloaded function, for its implementation's returns. */
    const overloadTarget = (node: ts.Node): ts.Type[] | undefined => {
      let fn: ts.Node = node.parent;
      while (!ts.isFunctionLike(fn) && !ts.isSourceFile(fn)) fn = fn.parent;
      if (
        !(ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) ||
        fn.body === undefined ||
        fn.name === undefined
      ) {
        return undefined;
      }
      const symbol = checker.getSymbolAtLocation(fn.name);
      const others = (symbol?.declarations ?? []).filter(
        (one): one is ts.SignatureDeclaration =>
          one !== fn && ts.isFunctionLike(one) && !("body" in one && one.body !== undefined),
      );
      if (others.length === 0) return undefined;
      return others.flatMap((one) => {
        const signature = checker.getSignatureFromDeclaration(one);
        return signature === undefined ? [] : [checker.getReturnTypeOfSignature(signature)];
      });
    };

    /**
     * The types a class member takes from the classes and interfaces its class extends or
     * implements (`override id()` over `id(): OrderId`): a value it gives is given to them too.
     */
    const inheritedTypes = (member: ts.ClassElement): ts.Type[] => {
      const owner = member.parent;
      if (!ts.isClassLike(owner) || member.name === undefined) return [];
      const name =
        ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name)
          ? member.name.text
          : ts.isStringLiteral(member.name)
            ? member.name.text
            : undefined;
      if (name === undefined) return [];
      return (owner.heritageClauses ?? []).flatMap((clause) =>
        clause.types.flatMap((base) => {
          questions += 1;
          const property = checker.getPropertyOfType(checker.getTypeAtLocation(base), name);
          return property === undefined ? [] : [checker.getTypeOfSymbol(property)];
        }),
      );
    };

    /** The return types a method or getter takes from the members it overrides. */
    const inheritedReturns = (node: ts.Node): ts.Type[] => {
      let fn: ts.Node = node.parent;
      while (!ts.isFunctionLike(fn) && !ts.isSourceFile(fn)) fn = fn.parent;
      if (!(ts.isMethodDeclaration(fn) || ts.isGetAccessorDeclaration(fn))) return [];
      const types = inheritedTypes(fn);
      if (ts.isGetAccessorDeclaration(fn)) return types;
      return types.flatMap((type) =>
        type.getCallSignatures().map((signature) => signature.getReturnType()),
      );
    };

    const returned = (expression: ts.Expression): void => {
      const overloads = overloadTarget(expression);
      if (overloads !== undefined) {
        for (const type of overloads) given(expression, type, "overload");
        return;
      }
      given(expression, contextual(expression));
      for (const type of inheritedReturns(expression)) given(expression, type, "override");
    };

    /**
     * Each property of `source` that the target type (`target`) holds a stated alias in while the
     * source's own property does not: a spread attribute or property.
     */
    const spreadInto = (node: ts.Expression, target: ts.Type | undefined, shown: ts.Node): void => {
      if (target === undefined) return;
      const source = typeAt(node);
      if (holdsNothing(source)) return;
      const any = (source.flags & ts.TypeFlags.Any) !== 0;
      for (const property of checker.getPropertiesOfType(source)) {
        const into = target.isUnion()
          ? target.types.flatMap(
              (member) => checker.getPropertyOfType(member, property.getName()) ?? [],
            )
          : [checker.getPropertyOfType(target, property.getName())].flatMap((one) => one ?? []);
        for (const wanted of into) {
          const held = aliasesIn(checker.getTypeOfSymbol(wanted)).filter(
            (one) => one.produced.length > 0,
          );
          if (held.length === 0) continue;
          const own = any ? [] : aliasesIn(checker.getTypeOfSymbol(property));
          for (const one of held) {
            if (!own.includes(one)) add(node, shown, one, "produced", any ? "any" : "spread");
          }
        }
      }
      if (any) {
        for (const one of aliasesIn(target).filter((alias) => alias.produced.length > 0)) {
          add(node, shown, one, "produced", "any");
        }
      }
    };

    /** The element type an iterable or array gives, when the checker can say. */
    const elementOf = (type: ts.Type): ts.Type | undefined =>
      checker.getIndexTypeOfType(type, ts.IndexKind.Number);

    /** A spread argument: its elements given to the parameters from its index on. */
    const spreadArgument = (
      call: ts.CallExpression | ts.NewExpression,
      spread: ts.SpreadElement,
    ): void => {
      questions += 1;
      const signature = checker.getResolvedSignature(call);
      const index = call.arguments?.indexOf(spread) ?? -1;
      if (signature === undefined || index < 0) return;
      const wanted = signature.parameters
        .slice(index)
        .flatMap((parameter) => aliasesIn(checker.getTypeOfSymbol(parameter)))
        .filter((one) => one.produced.length > 0);
      if (wanted.length === 0) return;
      const source = typeAt(spread.expression);
      const any = (source.flags & ts.TypeFlags.Any) !== 0;
      const own = any ? [] : aliasesIn(source);
      for (const one of wanted) {
        if (!own.includes(one)) add(spread, call, one, "produced", any ? "any" : "spread");
      }
    };

    /** A call whose type arguments give it a stated alias its arguments do not hold: `getJson<Order>(url)`. */
    const genericCall = (call: ts.CallExpression | ts.NewExpression): void => {
      questions += 1;
      const signature = checker.getResolvedSignature(call);
      const declaration = signature?.getDeclaration();
      if (signature === undefined || declaration === undefined) return;
      const generic = checker.getSignatureFromDeclaration(declaration);
      if (generic?.typeParameters === undefined || generic.typeParameters.length === 0) return;
      const held = aliasesIn(checker.getReturnTypeOfSignature(signature)).filter(
        (one) => one.produced.length > 0,
      );
      if (held.length === 0) return;
      const declared = new Set(aliasesIn(checker.getReturnTypeOfSignature(generic)));
      // A type argument a parameter takes too (`useState<OrderId | null>(null)`, `new
      // Map<OrderId, number>()`): its values come in through the arguments, each read where it
      // is given, so the call makes none of its own. Only for a function of a package or the
      // standard library: a function of the project could still cast inside its body.
      if (!isOwn(declaration.getSourceFile().fileName)) {
        for (const parameter of signature.parameters) {
          for (const one of aliasesIn(checker.getTypeOfSymbol(parameter))) declared.add(one);
        }
      }
      const fromArguments = new Set<FlowTarget>();
      for (const argument of call.arguments ?? []) {
        const type = typeAt(ts.isSpreadElement(argument) ? argument.expression : argument);
        for (const one of aliasesIn(type)) fromArguments.add(one);
      }
      if (
        ts.isPropertyAccessExpression(call.expression) ||
        ts.isElementAccessExpression(call.expression)
      ) {
        for (const one of aliasesIn(typeAt(call.expression.expression))) fromArguments.add(one);
      }
      for (const one of held) {
        if (!declared.has(one) && !fromArguments.has(one)) {
          add(call, call, one, "produced", "generic-call");
        }
      }
    };

    /** `.call`, `.apply`, `.bind`, `Reflect.apply`, `Reflect.construct`: arguments no parameter types. */
    const indirectCall = (call: ts.CallExpression): void => {
      const callee = call.expression;
      const words = calleeWords(call);
      let fn: ts.Expression | undefined;
      let passed: readonly ts.Expression[] = [];
      if (words === "Reflect.apply" || words === "Reflect.construct") {
        fn = call.arguments[0];
        const list = call.arguments[words === "Reflect.apply" ? 2 : 1];
        passed = list === undefined ? [] : [list];
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        (callee.name.text === "call" || callee.name.text === "apply" || callee.name.text === "bind")
      ) {
        fn = callee.expression;
        passed = call.arguments.slice(1);
      }
      if (fn === undefined) return;
      const type = typeAt(fn);
      const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()];
      if (signatures.length === 0) return;
      const wanted = signatures
        .flatMap((signature) => signature.parameters)
        .flatMap((parameter) => aliasesIn(checker.getTypeOfSymbol(parameter)))
        .filter((one) => one.produced.length > 0);
      if (wanted.length === 0) return;
      const own = new Set<FlowTarget>();
      let any = false;
      for (const argument of passed) {
        const argumentType = typeAt(argument);
        if (argumentType.flags & ts.TypeFlags.Any) any = true;
        for (const one of aliasesIn(argumentType)) own.add(one);
      }
      for (const one of wanted) {
        if (any || !own.has(one)) add(call, call, one, "produced", "indirect-call");
      }
    };

    /** `Object.assign(o, …)`, `Reflect.set(o, "id", …)`, `new Proxy(o, …)`: a holder written past its type. */
    const reflectWrite = (call: ts.CallExpression | ts.NewExpression, words: string): void => {
      const first = call.arguments?.[0];
      if (first === undefined) return;
      const holder = typeAt(first);
      const produced = aliasesIn(holder).filter((one) => one.produced.length > 0);
      if (produced.length > 0) {
        let wanted: readonly FlowTarget[] = produced;
        const key = call.arguments?.[1];
        if (
          (words === "Reflect.set" ||
            words === "Object.defineProperty" ||
            words === "Reflect.defineProperty") &&
          key !== undefined &&
          ts.isStringLiteralLike(key)
        ) {
          const property = checker.getPropertyOfType(holder, key.text);
          wanted = property === undefined ? [] : aliasesIn(checker.getTypeOfSymbol(property));
        } else if (words === "Object.assign") {
          const fromSources = new Set<FlowTarget>();
          for (const source of (call.arguments ?? []).slice(1)) {
            for (const property of checker.getPropertiesOfType(typeAt(source))) {
              const into = checker.getPropertyOfType(holder, property.getName());
              if (into === undefined) continue;
              const held = aliasesIn(checker.getTypeOfSymbol(into));
              const own = aliasesIn(checker.getTypeOfSymbol(property));
              for (const one of held) if (!own.includes(one)) fromSources.add(one);
            }
          }
          wanted = produced.filter((one) => fromSources.has(one));
        }
        for (const one of wanted) {
          if (one.produced.length > 0) add(call, call, one, "produced", "reflect");
        }
      }
      if (words !== "Proxy") {
        for (const one of heldMembers(holder)) add(call, call, one, "escaped", "reflect");
      }
    };

    // ---- escaped -----------------------------------------------------------------------------
    /** The stated members `type` holds itself (or a member of its union): `this` of a class with `saving`. */
    const heldMembers = (type: ts.Type): FlowTarget[] => {
      if (targets.members.size === 0) return [];
      const into = new Set<FlowTarget>();
      const base = widened(checker, type) ?? type;
      for (const member of base.isUnionOrIntersection() ? base.types : [base]) {
        if (!(member.flags & ts.TypeFlags.Object)) continue;
        for (const [name, list] of targets.members) {
          questions += 1;
          const property = checker.getPropertyOfType(member, name);
          if (property === undefined) continue;
          const roots = checker.getRootSymbols(property);
          for (const one of list) if (roots.includes(one.symbol)) into.add(one);
        }
      }
      return [...into];
    };

    /**
     * An object literal for a holder whose stated member it writes where no reference names it
     * (the literal is typed by a union with a function, as a state setter takes), or into which it
     * spreads a holder.
     */
    const literalHolder = (literal: ts.ObjectLiteralExpression): void => {
      const type = contextual(literal);
      if (type === undefined) return;
      const held = heldMembers(type);
      for (const one of held) {
        const written = literal.properties.some((property) => {
          if (ts.isSpreadAssignment(property))
            return heldMembers(typeAt(property.expression)).includes(one);
          const name = property.name;
          if (!(ts.isIdentifier(name) || ts.isStringLiteral(name))) return false;
          if (name.text !== one.stated.word) return false;
          const symbol = symbolOfReference(name);
          return (
            symbol === undefined || !checker.getRootSymbols(resolved(symbol)).includes(one.symbol)
          );
        });
        if (written) add(literal, literal, one, "escaped", "literal");
      }
    };

    // ---- decided -----------------------------------------------------------------------------
    /** A value of a stated alias the code decides by: its declared type, else the object whose tag it is. */
    const decidedBy = (expression: ts.Expression, shown: ts.Node): void => {
      let inner = expression;
      while (ts.isParenthesizedExpression(inner) || ts.isNonNullExpression(inner))
        inner = inner.expression;
      if (
        ts.isLiteralExpression(inner) ||
        inner.kind === ts.SyntaxKind.TrueKeyword ||
        inner.kind === ts.SyntaxKind.FalseKeyword
      ) {
        return;
      }
      const name = ts.isPropertyAccessExpression(inner) ? inner.name : inner;
      questions += 1;
      const symbol = ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined;
      const declared =
        symbol !== undefined && symbol.flags & (ts.SymbolFlags.Variable | ts.SymbolFlags.Property)
          ? checker.getTypeOfSymbol(symbol)
          : undefined;
      let found = [
        ...(declared === undefined ? [] : aliasesOf(declared)),
        ...aliasesOf(typeAt(inner)),
      ];
      if (
        found.length === 0 &&
        (ts.isPropertyAccessExpression(inner) || ts.isElementAccessExpression(inner))
      ) {
        found = aliasesOf(typeAt(inner.expression));
      }
      for (const one of new Set(found)) {
        if (one.decided.length > 0) add(inner, shown, one, "decided", "value");
      }
      // A value made from one (`s.toLowerCase()`, `s as string`, `String(s)`, `` `${s}` ``): the
      // code decides by what is made, not by the value itself.
      if (found.length === 0) {
        for (const source of derivedSources(inner)) {
          for (const one of new Set(aliasesOf(typeAt(source)))) {
            if (one.decided.length > 0) add(inner, shown, one, "decided", "derived");
          }
        }
      }
    };

    /**
     * The expressions a value is made from, when it is made from another value: the operand of a
     * cast, the receiver of a method call, the arguments of a call, the parts of a template.
     */
    const derivedSources = (expression: ts.Expression): ts.Expression[] => {
      let inner = expression;
      while (ts.isParenthesizedExpression(inner) || ts.isNonNullExpression(inner)) {
        inner = inner.expression;
      }
      if (
        ts.isAsExpression(inner) ||
        ts.isSatisfiesExpression(inner) ||
        ts.isTypeAssertionExpression(inner)
      ) {
        return [inner.expression, ...derivedSources(inner.expression)];
      }
      if (ts.isTemplateExpression(inner)) {
        return inner.templateSpans.flatMap((span) => [
          span.expression,
          ...derivedSources(span.expression),
        ]);
      }
      if (ts.isCallExpression(inner)) {
        const receiver = ts.isPropertyAccessExpression(inner.expression)
          ? [inner.expression.expression]
          : [];
        return [...receiver, ...inner.arguments.filter((one) => !ts.isSpreadElement(one))];
      }
      return [];
    };

    /**
     * A method called on a value of an alias the code decides by (`s.startsWith("p")`): what it
     * gives is made from the value.
     */
    const derivedCall = (call: ts.CallExpression): void => {
      if (!ts.isPropertyAccessExpression(call.expression)) return;
      for (const one of new Set(aliasesOf(typeAt(call.expression.expression)))) {
        if (one.decided.length > 0) add(call, call, one, "decided", "derived");
      }
    };

    /**
     * A value of a stated alias given to a call that decides by it, to a parameter whose type does
     * not hold the alias: `list.includes(s)`, `map.get(s)`, `Object.is(s, …)`.
     */
    const decidingCall = (call: ts.CallExpression): void => {
      const callee = call.expression;
      const words = calleeWords(call);
      const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
      // Besides the methods known to decide, a call that answers yes or no (`pattern.test(s)`,
      // `Object.hasOwn(labels, s)`) or takes the value as a key (`Reflect.get(labels, s)`).
      // A generic key (`Reflect.get<T, P extends PropertyKey>`) is inferred as the value's own
      // type, so these read the value as a key whatever the parameter is inferred as.
      const keyed = words !== undefined && KEYED_CALLS.has(words);
      const known =
        keyed || words === "Object.is" || (method !== undefined && DECIDING_METHODS.has(method));
      const answers = known || (typeAt(call).flags & ts.TypeFlags.BooleanLike) !== 0;
      for (const argument of call.arguments) {
        if (ts.isSpreadElement(argument)) continue;
        const target = contextual(argument);
        if (!answers && (target === undefined || !isPropertyKey(target))) continue;
        const wanted = target === undefined ? [] : aliasesIn(target);
        for (const one of new Set(aliasesOf(typeAt(argument)))) {
          if (one.decided.length > 0 && (keyed || !wanted.includes(one))) {
            add(argument, call, one, "decided", "call");
          }
        }
      }
    };

    /** `PropertyKey`: `string | number | symbol`, the type of a key (`Reflect.get`'s second parameter). */
    const isPropertyKey = (given: ts.Type): boolean => {
      // `Reflect.get<T, P extends PropertyKey>(…)`: the parameter's constraint says it.
      const type =
        given.flags & ts.TypeFlags.TypeParameter
          ? (checker.getBaseConstraintOfType(given) ?? given)
          : given;
      return (
        type.isUnion() &&
        type.types.some((one) => (one.flags & ts.TypeFlags.ESSymbolLike) !== 0) &&
        type.types.some((one) => (one.flags & ts.TypeFlags.StringLike) !== 0)
      );
    };

    /** A union of literals only (`"pending" | "paid"`): a closed set of values. */
    const isClosedLiterals = (type: ts.Type): boolean =>
      type.isUnion() &&
      type.types.every(
        (member) =>
          (member.flags &
            (ts.TypeFlags.Literal |
              ts.TypeFlags.EnumLiteral |
              ts.TypeFlags.Undefined |
              ts.TypeFlags.Null)) !==
          0,
      );

    /**
     * A value of a stated alias handed to a closed union that does not hold the alias (a parameter
     * or variable typed `"pending" | "paid"`): the code there decides by the value as if it could
     * hold nothing else.
     */
    const handedToClosed = (
      value: ts.Expression,
      target: ts.Type | undefined,
      shown: ts.Node,
      via: "call" | "value",
    ): void => {
      if (target === undefined || !isClosedLiterals(target)) return;
      const wanted = aliasesIn(target);
      for (const one of new Set(aliasesOf(typeAt(value)))) {
        if (one.decided.length > 0 && !wanted.includes(one)) add(value, shown, one, "decided", via);
      }
    };

    const isRelation = (kind: ts.SyntaxKind): boolean =>
      kind === ts.SyntaxKind.LessThanToken ||
      kind === ts.SyntaxKind.LessThanEqualsToken ||
      kind === ts.SyntaxKind.GreaterThanToken ||
      kind === ts.SyntaxKind.GreaterThanEqualsToken;

    const isEquality = (kind: ts.SyntaxKind): boolean =>
      kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      kind === ts.SyntaxKind.EqualsEqualsToken ||
      kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      kind === ts.SyntaxKind.ExclamationEqualsToken;

    const producing = targets.aliases.some((one) => one.produced.length > 0);
    const deciding = targets.aliases.some((one) => one.decided.length > 0);
    const escaping = targets.members.size > 0;

    const visit = (node: ts.Node): void => {
      if (stopped !== undefined) return;
      if (questions >= budget) {
        stopped = node;
        return;
      }
      if (producing) {
        if (ts.isReturnStatement(node) && node.expression !== undefined) returned(node.expression);
        else if (ts.isArrowFunction(node) && !ts.isBlock(node.body))
          given(node.body, contextual(node.body));
        else if (ts.isYieldExpression(node) && node.expression !== undefined) {
          given(node.expression, contextual(node.expression));
        } else if (
          (ts.isVariableDeclaration(node) ||
            ts.isPropertyDeclaration(node) ||
            ts.isParameter(node) ||
            ts.isBindingElement(node)) &&
          node.initializer !== undefined
        ) {
          given(node.initializer, contextual(node.initializer));
          if (ts.isPropertyDeclaration(node)) {
            for (const type of inheritedTypes(node)) given(node.initializer, type, "override");
          }
        } else if (
          ts.isBinaryExpression(node) &&
          isAssignmentOperator(node.operatorToken.kind) &&
          !ts.isObjectLiteralExpression(node.left) &&
          !ts.isArrayLiteralExpression(node.left)
        ) {
          given(node.right, contextual(node.right) ?? typeAt(node.left));
        } else if (ts.isPropertyAssignment(node))
          given(node.initializer, contextual(node.initializer));
        else if (ts.isShorthandPropertyAssignment(node)) given(node.name, contextual(node.name));
        else if (ts.isSpreadAssignment(node) && ts.isObjectLiteralExpression(node.parent)) {
          spreadInto(node.expression, contextual(node.parent), node.parent);
        } else if (ts.isArrayLiteralExpression(node)) {
          for (const element of node.elements) {
            if (ts.isSpreadElement(element)) {
              const target = contextual(node);
              const item = target === undefined ? undefined : elementOf(target);
              const wanted = item === undefined ? [] : aliasesIn(item);
              const source = typeAt(element.expression);
              const any = (source.flags & ts.TypeFlags.Any) !== 0;
              const own = any ? [] : aliasesIn(elementOf(source) ?? source);
              for (const one of wanted) {
                if (one.produced.length > 0 && !own.includes(one)) {
                  add(element, node, one, "produced", any ? "any" : "spread");
                }
              }
            } else if (!ts.isOmittedExpression(element)) {
              given(element, contextual(element));
            }
          }
        } else if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
          const value = ts.isJsxExpression(node.initializer)
            ? node.initializer.expression
            : node.initializer;
          if (value !== undefined && ts.isExpression(value)) given(value, contextual(value));
        } else if (ts.isJsxSpreadAttribute(node)) {
          // The element shows what the spread is given to: `<Show {...props} />`.
          spreadInto(node.expression, contextual(node.parent), node.parent.parent);
        } else if (
          ts.isAsExpression(node) ||
          ts.isTypeAssertionExpression(node) ||
          ts.isSatisfiesExpression(node)
        ) {
          const constant =
            ts.isTypeReferenceNode(node.type) &&
            ts.isIdentifier(node.type.typeName) &&
            node.type.typeName.text === "const";
          if (!constant) {
            questions += 1;
            given(node.expression, checker.getTypeFromTypeNode(node.type), "cast");
          }
        } else if (ts.isForOfStatement(node) && !ts.isVariableDeclarationList(node.initializer)) {
          const target = typeAt(node.initializer);
          const item = elementOf(typeAt(node.expression));
          const wanted = aliasesIn(target).filter((one) => one.produced.length > 0);
          const own = item === undefined ? [] : aliasesIn(item);
          for (const one of wanted) {
            if (!own.includes(one)) add(node.initializer, node, one, "produced", "for-of");
          }
        }
        // `p--`, `p += 1`, `id += s`: the place typed by the brand gets a value computed from it,
        // which no builder made.
        const computed =
          ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
            (node.operator === ts.SyntaxKind.PlusPlusToken ||
              node.operator === ts.SyntaxKind.MinusMinusToken)) ||
          (ts.isBinaryExpression(node) &&
            node.operatorToken.kind >= ts.SyntaxKind.FirstCompoundAssignment &&
            node.operatorToken.kind <= ts.SyntaxKind.LastCompoundAssignment &&
            // `??=`, `||=`, `&&=` give the right side as it is, read as an assignment.
            node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionEqualsToken &&
            node.operatorToken.kind !== ts.SyntaxKind.BarBarEqualsToken &&
            node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandEqualsToken);
        if (computed) {
          const target = ts.isBinaryExpression(node) ? node.left : node.operand;
          for (const one of aliasesIn(typeAt(target))) {
            if (one.produced.length > 0) add(node, node, one, "produced", "derived");
          }
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          for (const argument of node.arguments ?? []) {
            if (ts.isSpreadElement(argument)) spreadArgument(node, argument);
            else given(argument, contextual(argument));
          }
          genericCall(node);
          if (ts.isCallExpression(node)) indirectCall(node);
        }
      }
      if ((producing || escaping) && (ts.isCallExpression(node) || ts.isNewExpression(node))) {
        const words = calleeWords(node);
        if (
          words !== undefined &&
          (REFLECT_WRITES.has(words) || (words === "Proxy" && ts.isNewExpression(node)))
        ) {
          reflectWrite(node, words);
        }
      }
      if (escaping) {
        if (ts.isObjectLiteralExpression(node)) literalHolder(node);
        else if (
          ts.isBinaryExpression(node) &&
          isAssignmentOperator(node.operatorToken.kind) &&
          ts.isElementAccessExpression(node.left) &&
          !ts.isStringLiteralLike(node.left.argumentExpression)
        ) {
          for (const one of heldMembers(typeAt(node.left.expression))) {
            add(node.left, node, one, "escaped", "reflect");
          }
        }
      }
      if (deciding) {
        if (ts.isSwitchStatement(node)) decidedBy(node.expression, node.expression);
        else if (
          ts.isBinaryExpression(node) &&
          (isEquality(node.operatorToken.kind) || isRelation(node.operatorToken.kind))
        ) {
          decidedBy(node.left, node);
          decidedBy(node.right, node);
        } else if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.InKeyword
        ) {
          decidedBy(node.left, node);
        } else if (
          ts.isElementAccessExpression(node) &&
          !ts.isStringLiteralLike(node.argumentExpression) &&
          !ts.isNumericLiteral(node.argumentExpression)
        ) {
          decidedBy(node.argumentExpression, node);
        } else if (ts.isCallExpression(node)) {
          decidingCall(node);
          derivedCall(node);
          for (const argument of node.arguments) {
            if (!ts.isSpreadElement(argument)) {
              handedToClosed(argument, contextual(argument), node, "call");
            }
          }
        } else if (
          ts.isVariableDeclaration(node) &&
          node.type !== undefined &&
          node.initializer !== undefined
        ) {
          handedToClosed(node.initializer, typeAt(node.name), node, "value");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (stopped !== undefined) {
      const at = stopped;
      for (const one of targets.aliases) {
        add(at, at, one, "produced", "stopped");
        add(at, at, one, "decided", "stopped");
      }
      for (const one of [...targets.members.values()].flat())
        add(at, at, one, "escaped", "stopped");
    }
    return found.sort(
      (a, b) =>
        a.node.getStart(sourceFile) - b.node.getStart(sourceFile) ||
        a.node.end - b.node.end ||
        compareIds(a.declaration, b.declaration) ||
        compareIds(a.trait, b.trait) ||
        compareIds(a.form, b.form),
    );
  };

  return { referencesIn, flowsIn };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whether every value of `type` is a primitive, or an array or tuple of them, `depth` levels down. */
function onlyPrimitives(checker: ts.TypeChecker, found: ts.Type, depth: number): boolean {
  const type = widened(checker, found);
  if (type === undefined || depth > 3) return false;
  const members = type.isUnion() ? type.types : [type];
  return members.every((member) => {
    if (member.flags & PRIMITIVE_FLAGS) return true;
    if (!isTypeReference(member) || !checker.isArrayLikeType(member)) return false;
    return checker
      .getTypeArguments(member)
      .every((argument) => onlyPrimitives(checker, argument, depth + 1));
  });
}

/**
 * TypeScript's errors for a function whose end can be reached although it must return a value:
 * TS2366, TS2355, TS2534 and TS7030 (`TypeQueries.reportsReachableEnd`).
 */
const REACHABLE_END_CODES: ReadonlySet<number> = new Set([2366, 2355, 2534, 7030]);

/** A file of the platform: TypeScript's own lib, or Node's types. */
function isPlatformSourceFile(program: ts.Program, file: ts.SourceFile): boolean {
  return (
    program.isSourceFileDefaultLibrary(file) ||
    /[\\/]node_modules[\\/]@types[\\/]node[\\/]/.test(file.fileName)
  );
}

/** Properties of the platform's types that are plain data on the closed list, as `<type>.<name>`. */
const PLATFORM_PROPERTIES: ReadonlySet<string> = new Set([
  "Array.length",
  "ReadonlyArray.length",
  "String.length",
  "Map.size",
  "ReadonlyMap.size",
  "Set.size",
  "ReadonlySet.size",
  "AbortController.signal",
  "AbortSignal.aborted",
  "Error.message",
  "Error.name",
]);

/** Platform values whose every property is a constant (`Math.PI`, `Number.MAX_SAFE_INTEGER`). */
const PLATFORM_CONSTANTS: ReadonlySet<string> = new Set(["Math", "NumberConstructor"]);

/** The members of a type, a type parameter widened to its constraint, without `null` and `undefined`. */
function definedMembers(checker: ts.TypeChecker, type: ts.Type): readonly ts.Type[] | undefined {
  const wide = widened(checker, type);
  if (wide === undefined) return undefined;
  const defined = checker.getNonNullableType(wide);
  if (defined.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) {
    return undefined;
  }
  return defined.isUnion() ? defined.types : [defined];
}

/** Whether `type` is a number type: `number`, a literal, a numeric enum, or an intersection with one. */
function isNumberType(type: ts.Type): boolean {
  if (type.isIntersection()) return type.types.some(isNumberType);
  return (type.flags & ts.TypeFlags.NumberLike) !== 0;
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
  const declaredTraits = new Map<string, boolean>();
  let anyMarker: boolean | undefined;
  let ledgerScan: ReturnType<typeof createLedgerScan> | undefined;
  // The starts of TypeScript's "end of the function can be reached" errors, per file asked about.
  const reachableEndErrors = new WeakMap<ts.SourceFile, readonly number[]>();
  let declaredDispose: boolean | undefined;
  let renamedNames: ReadonlyMap<string, ReadonlySet<string>> | undefined;
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

  // The platform's types that a class or interface of the project extends or implements: a value
  // typed by one of them may be the project's own code.
  let extendedPlatform: ReadonlySet<ts.Symbol> | undefined;
  const platformExtended = (): ReadonlySet<ts.Symbol> => {
    if (extendedPlatform !== undefined) return extendedPlatform;
    const checker = typeChecker();
    const found = new Set<ts.Symbol>();
    const visit = (node: ts.Node): void => {
      if (ts.isHeritageClause(node)) {
        for (const written of node.types) {
          const symbol = checker.getTypeAtLocation(written).getSymbol();
          const declarations = symbol?.declarations ?? [];
          if (
            symbol !== undefined &&
            declarations.length > 0 &&
            declarations.every((one) => isPlatformSourceFile(program, one.getSourceFile()))
          ) {
            found.add(symbol);
          }
        }
        return;
      }
      ts.forEachChild(node, visit);
    };
    for (const file of program.getSourceFiles()) {
      if (!own.has(toTypeScriptPath(file.fileName))) continue;
      if (!file.text.includes("extends") && !file.text.includes("implements")) continue;
      visit(file);
    }
    extendedPlatform = found;
    return found;
  };
  /** The platform's name of one type, as `platformTypeOf` says it. */
  const platformNameOfType = (type: ts.Type): string | undefined => {
    if (type.flags & ts.TypeFlags.StringLike) return "String";
    // A branded string (`string & { … }`): its string part.
    if (type.isIntersection() && type.types.some((part) => part.flags & ts.TypeFlags.StringLike)) {
      return "String";
    }
    if (type.flags & ts.TypeFlags.NumberLike) return "Number";
    if (type.flags & ts.TypeFlags.BigIntLike) return "BigInt";
    if (type.flags & ts.TypeFlags.BooleanLike) return "Boolean";
    if ((type.flags & ts.TypeFlags.Object) === 0) return undefined;
    if (typeChecker().isTupleType(type)) return "Array";
    const symbol = type.getSymbol();
    const declarations = symbol?.declarations ?? [];
    if (
      symbol === undefined ||
      declarations.length === 0 ||
      !declarations.every((one) => isPlatformSourceFile(program, one.getSourceFile())) ||
      platformExtended().has(symbol)
    ) {
      return undefined;
    }
    return symbol.getName();
  };
  const platformNameOf = (type: ts.Type): string | undefined => {
    const members = definedMembers(typeChecker(), type);
    if (members === undefined) return undefined;
    const names = new Set(members.map(platformNameOfType));
    const [only] = names;
    return names.size === 1 ? only : undefined;
  };
  /** Whether reading `property` from a value of type `receiver` runs no code and cannot throw. */
  const plainProperty = (property: ts.Symbol, receiver: ts.Type): boolean => {
    const declarations = property.declarations ?? [];
    if (declarations.length === 0) {
      // A key of a mapped type with no declaration of its own (`Record<"a" | "b", number>`).
      const members = definedMembers(typeChecker(), receiver);
      return (
        members?.every(
          (member) =>
            "objectFlags" in member &&
            typeof member.objectFlags === "number" &&
            (member.objectFlags & ts.ObjectFlags.Mapped) !== 0,
        ) === true
      );
    }
    if (declarations.some((one) => ts.isGetAccessor(one) || ts.isSetAccessor(one))) return false;
    if (declarations.every((one) => isPlatformSourceFile(program, one.getSourceFile()))) {
      const owner = platformNameOf(receiver);
      return (
        owner !== undefined &&
        (PLATFORM_CONSTANTS.has(owner) || PLATFORM_PROPERTIES.has(`${owner}.${property.getName()}`))
      );
    }
    const members = definedMembers(typeChecker(), receiver);
    if (members === undefined) return false;
    const inModule = members.every(
      (member) =>
        ((member.getSymbol()?.flags ?? 0) & (ts.SymbolFlags.ValueModule | ts.SymbolFlags.Enum)) !==
        0,
    );
    if (inModule) {
      return declarations.every(
        (one) =>
          ts.isEnumMember(one) ||
          ts.isVariableDeclaration(one) ||
          ts.isFunctionDeclaration(one) ||
          ts.isClassDeclaration(one),
      );
    }
    // A member declared as a property is read as one, as far as the declared types say: a class
    // that implements an interface may give it as a getter, which this does not see.
    return declarations.every(
      (one) =>
        ts.isPropertyDeclaration(one) ||
        (ts.isParameter(one) && ts.isConstructorDeclaration(one.parent)) ||
        ts.isPropertyAssignment(one) ||
        ts.isShorthandPropertyAssignment(one) ||
        ts.isPropertySignature(one),
    );
  };
  const arrayElements = (type: ts.Type): "primitives" | "values" | undefined => {
    const checker = typeChecker();
    const members = definedMembers(checker, type);
    if (members === undefined) return undefined;
    let primitives = true;
    for (const member of members) {
      const tuple = checker.isTupleType(member);
      const name = tuple ? "Array" : platformNameOfType(member);
      if (name !== "Array" && name !== "ReadonlyArray") return undefined;
      if (!isTypeReference(member)) return undefined;
      for (const element of checker.getTypeArguments(member)) {
        const wide = widened(checker, element);
        const parts = wide === undefined ? [] : wide.isUnion() ? wide.types : [wide];
        if (wide === undefined || !parts.every((part) => (part.flags & PRIMITIVE_FLAGS) !== 0)) {
          primitives = false;
        }
      }
    }
    return primitives ? "primitives" : "values";
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
      if (hasGenericKeys(typeChecker(), type) || hasUnresolvedKeys(typeChecker(), type)) {
        return "generic";
      }
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
    declaredEntryCanBeMissing(access) {
      const checker = typeChecker();
      const object = widened(checker, checker.getTypeAtLocation(access.expression));
      const key = widened(checker, checker.getTypeAtLocation(access.argumentExpression));
      if (object === undefined || key === undefined) return false;
      const keys = key.isUnion() ? key.types : [key];
      return keys.some((one) => {
        const number = (one.flags & ts.TypeFlags.NumberLike) !== 0;
        if (!number && (one.flags & ts.TypeFlags.StringLike) === 0) return false;
        let declared: ts.Type | undefined;
        if (one.isStringLiteral() || one.isNumberLiteral()) {
          const property = checker.getPropertyOfType(object, String(one.value));
          if (property !== undefined) declared = checker.getTypeOfSymbol(property);
        }
        declared ??= (
          (number ? checker.getIndexInfoOfType(object, ts.IndexKind.Number) : undefined) ??
          checker.getIndexInfoOfType(object, ts.IndexKind.String)
        )?.type;
        return declared !== undefined && includesUndefined(declared);
      });
    },
    sameType(a, b) {
      const checker = typeChecker();
      const left = checker.getTypeAtLocation(a);
      const right = checker.getTypeAtLocation(b);
      // `any` (written, or a type that does not resolve) is assignable both ways: it says nothing.
      if ((left.flags | right.flags) & ts.TypeFlags.Any) return false;
      return (
        left === right ||
        (checker.isTypeAssignableTo(left, right) && checker.isTypeAssignableTo(right, left))
      );
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
    contextualGuaranteesOf(node) {
      const checker = typeChecker();
      const type = checker.getContextualType(node);
      return type === undefined ? [] : guaranteesOfType(checker, type);
    },
    guaranteeValuesOf(target, name, contextual = false) {
      const checker = typeChecker();
      if ("kind" in target) {
        const type =
          contextual && ts.isExpression(target)
            ? checker.getContextualType(target)
            : checker.getTypeAtLocation(target);
        return type === undefined ? undefined : guaranteeValuesOfType(checker, type, name);
      }
      const declaration = declarations.get(target.id);
      const type = declaration === undefined ? undefined : declaredTypeOf(checker, declaration);
      return type === undefined ? undefined : guaranteeValuesOfType(checker, type, name);
    },
    heldAliasesOf(node, contextual = false) {
      const checker = typeChecker();
      const type = contextual ? checker.getContextualType(node) : checker.getTypeAtLocation(node);
      if (type === undefined) return [];
      const found = new Map<string, ts.Symbol>();
      const seen = new Set<ts.Type>();
      const enter = (given: ts.Type, depth: number, top: boolean): void => {
        const base = widened(checker, given);
        if (base === undefined || depth > 3 || seen.has(base)) return;
        seen.add(base);
        const alias = base.aliasSymbol;
        if (
          !top &&
          alias?.declarations?.some(ts.isTypeAliasDeclaration) === true &&
          (base.aliasTypeArguments?.length ?? 0) === 0
        ) {
          found.set(`${alias.getName()}#${String(alias.declarations[0]?.pos ?? 0)}`, alias);
          return;
        }
        if (base.isUnion()) {
          for (const member of base.types) enter(member, depth, top);
        } else if (base.flags & ts.TypeFlags.Object) {
          if (isTypeReference(base)) {
            for (const argument of checker.getTypeArguments(base)) {
              enter(argument, depth + 1, false);
            }
          } else if (isAnonymousObject(base)) {
            for (const property of checker.getPropertiesOfType(base)) {
              const declaration = property.valueDeclaration ?? property.declarations?.[0];
              if (declaration !== undefined) {
                enter(checker.getTypeOfSymbolAtLocation(property, declaration), depth + 1, false);
              }
            }
          }
        }
      };
      enter(type, 0, true);
      return [...found.values()]
        .sort((a, b) => (a.getName() < b.getName() ? -1 : a.getName() > b.getName() ? 1 : 0))
        .flatMap((symbol) => {
          const ref = refOfSymbol(symbol);
          return ref === undefined ? [] : [ref];
        });
    },
    contextualAliasOf(node) {
      const checker = typeChecker();
      const found = checker.getContextualType(node);
      const type = found === undefined ? undefined : widened(checker, found);
      if (type === undefined) return undefined;
      const aliasOf = (member: ts.Type): ts.Symbol | undefined =>
        member.aliasSymbol?.declarations?.some(ts.isTypeAliasDeclaration) === true &&
        (member.aliasTypeArguments?.length ?? 0) === 0
          ? member.aliasSymbol
          : undefined;
      const whole = aliasOf(type);
      if (whole !== undefined) return refOfSymbol(whole);
      // `return "x"` in an async function expects `OrderId | PromiseLike<OrderId>`.
      const members = (type.isUnion() ? type.types : [type]).filter(
        (member) =>
          (member.flags & NULLISH) === 0 &&
          !(
            member.getSymbol()?.getName() === "PromiseLike" &&
            member.symbol.declarations?.some((declaration) =>
              program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
            ) === true
          ),
      );
      // `show("bad")` with a parameter `OrderId | number`: a member without an alias that the value
      // does not fit (`number`) is not what it becomes.
      const own = checker.getTypeAtLocation(node);
      const aliases = new Set(
        members
          .filter(
            (member) => aliasOf(member) !== undefined || checker.isTypeAssignableTo(own, member),
          )
          .map(aliasOf),
      );
      const [only] = aliases;
      return aliases.size === 1 && only !== undefined ? refOfSymbol(only) : undefined;
    },
    bindingPropertyOf(element) {
      const pattern = element.parent;
      if (!ts.isObjectBindingPattern(pattern) || element.dotDotDotToken !== undefined) {
        return undefined;
      }
      const key = element.propertyName ?? element.name;
      if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) return undefined;
      const checker = typeChecker();
      const property = checker.getTypeAtLocation(pattern).getProperty(key.text);
      return property === undefined ? undefined : refOfSymbol(property);
    },
    declaresDispose() {
      // The text is only a quick filter, as for markers: the member must be declared.
      declaredDispose ??= program
        .getSourceFiles()
        .some(
          (file) =>
            own.has(toTypeScriptPath(file.fileName)) &&
            (file.text.includes("Symbol.dispose") || file.text.includes("Symbol.asyncDispose")) &&
            declaresDisposeMember(file),
        );
      return declaredDispose;
    },
    renamedBindings() {
      if (renamedNames === undefined) {
        const found = new Map<string, Set<string>>();
        for (const file of program.getSourceFiles()) {
          if (own.has(toTypeScriptPath(file.fileName))) addRenamed(file, found);
        }
        renamedNames = found;
      }
      return renamedNames;
    },
    statedDeclarationsIn(sourceFile) {
      anyMarker ??= program.getSourceFiles().some(declaresAnyMarker);
      return anyMarker ? statedDeclarationsOf(typeChecker(), sourceFile) : [];
    },
    statedReferencesIn(sourceFile, proves) {
      anyMarker ??= program.getSourceFiles().some(declaresAnyMarker);
      // A tag needs no marker: its scan reads only the files whose text writes it.
      if (!anyMarker && (proves.tags ?? []).length === 0) return [];
      ledgerScan ??= createLedgerScan(
        program,
        typeChecker,
        (file) => own.has(toTypeScriptPath(file)),
        refOfSymbol,
      );
      return ledgerScan.referencesIn(sourceFile, proves);
    },
    typedFlowsIn(sourceFile, proves, budget = FLOW_BUDGET) {
      anyMarker ??= program.getSourceFiles().some(declaresAnyMarker);
      if (!anyMarker) return [];
      ledgerScan ??= createLedgerScan(
        program,
        typeChecker,
        (file) => own.has(toTypeScriptPath(file)),
        refOfSymbol,
      );
      return ledgerScan.flowsIn(sourceFile, proves, budget);
    },
    holdsOnlyPrimitives(node) {
      return onlyPrimitives(typeChecker(), typeChecker().getTypeAtLocation(node), 0);
    },
    valueOriginOf(node) {
      const symbol = typeChecker().getTypeAtLocation(node).getSymbol();
      return symbol === undefined ? undefined : refOfSymbol(symbol);
    },
    declaresTrait(name) {
      const known = declaredTraits.get(name);
      if (known !== undefined) return known;
      const text = `${GUARANTEE_PREFIX}${name}`;
      // The text is only a quick filter: the marker counts as a property of a type, never inside a
      // string or a comment (stateward's own packages quote it, and a project's program can
      // include them through its config file).
      const found = program
        .getSourceFiles()
        .some((file) => file.text.includes(text) && declaresMarkerProperty(file, text));
      declaredTraits.set(name, found);
      return found;
    },
    disposeOf(node) {
      return disposeOfType(typeChecker(), typeChecker().getTypeAtLocation(node));
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
      return { name: alias.getName(), file: declaration.getSourceFile().fileName, declaration };
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
    propIsDeeplyReadonly(attribute) {
      const checker = typeChecker();
      // The component's props type, as the attributes are checked against it.
      const props = checker.getContextualType(attribute.parent);
      const symbol =
        props === undefined
          ? undefined
          : checker.getPropertyOfType(props, attribute.name.getText());
      const declarations = symbol?.declarations ?? [];
      if (
        symbol === undefined ||
        declarations.length === 0 ||
        !declarations.every((one) => own.has(one.getSourceFile().fileName))
      ) {
        return false;
      }
      return isDeeplyReadonly(checker, checker.getTypeOfSymbol(symbol), 0);
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
    isNumber(node) {
      const type = widened(typeChecker(), typeChecker().getTypeAtLocation(node));
      if (type === undefined) return false;
      return (type.isUnion() ? type.types : [type]).every(isNumberType);
    },
    platformTypeOf(node) {
      return platformNameOf(typeChecker().getTypeAtLocation(node));
    },
    arrayElementsOf(node) {
      return arrayElements(typeChecker().getTypeAtLocation(node));
    },
    readIsPlain(node) {
      const checker = typeChecker();
      if (ts.isBindingElement(node)) {
        const pattern = node.parent;
        const source = checker.getTypeAtLocation(pattern);
        if (ts.isArrayBindingPattern(pattern)) return arrayElements(source) !== undefined;
        if (node.dotDotDotToken !== undefined) return false;
        const key = node.propertyName ?? node.name;
        if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) return false;
        const members = definedMembers(checker, source);
        const [only] = members ?? [];
        const property =
          members?.length === 1 && only !== undefined
            ? checker.getPropertyOfType(only, key.text)
            : undefined;
        return property !== undefined && plainProperty(property, source);
      }
      if (ts.isPropertyAccessExpression(node)) {
        const property = checker.getSymbolAtLocation(node.name);
        return (
          property !== undefined &&
          plainProperty(property, checker.getTypeAtLocation(node.expression))
        );
      }
      const receiver = checker.getTypeAtLocation(node.expression);
      const members = definedMembers(checker, receiver);
      const [only] = members ?? [];
      if (members?.length !== 1 || only === undefined) return false;
      const argument = node.argumentExpression;
      if (ts.isNumericLiteral(argument) && checker.isTupleType(only) && isTypeReference(only)) {
        const target = only.target;
        const fixed =
          "minLength" in target && typeof target.minLength === "number" ? target.minLength : 0;
        return Number(argument.text) < fixed;
      }
      if (ts.isStringLiteralLike(argument)) {
        const property = checker.getPropertyOfType(only, argument.text);
        if (property !== undefined) return plainProperty(property, receiver);
      }
      // A key of an index signature: the read itself runs nothing, but it may find nothing, so the
      // value must be a primitive that is not read further.
      if (checker.getIndexInfosOfType(only).length === 0) return false;
      const value = checker.getTypeAtLocation(node);
      const parts = value.isUnion() ? value.types : [value];
      if (!parts.every((part) => (part.flags & PRIMITIVE_FLAGS) !== 0)) return false;
      let outer: ts.Node = node;
      while (
        ts.isParenthesizedExpression(outer.parent) ||
        ts.isNonNullExpression(outer.parent) ||
        ts.isAsExpression(outer.parent) ||
        ts.isSatisfiesExpression(outer.parent)
      ) {
        outer = outer.parent;
      }
      const parent = outer.parent;
      return !(
        (ts.isPropertyAccessExpression(parent) ||
          ts.isElementAccessExpression(parent) ||
          ts.isCallExpression(parent) ||
          ts.isTaggedTemplateExpression(parent)) &&
        (ts.isTaggedTemplateExpression(parent) ? parent.tag : parent.expression) === outer
      );
    },
    readMayRunAccessor(node) {
      const property = typeChecker().getSymbolAtLocation(node.name);
      return (property?.declarations ?? []).some(
        (one) =>
          own.has(toTypeScriptPath(one.getSourceFile().fileName)) &&
          (ts.isGetAccessorDeclaration(one) || ts.isSetAccessorDeclaration(one)) &&
          one.body !== undefined,
      );
    },
    isPlatformName(node) {
      const found = typeChecker().getSymbolAtLocation(node);
      if (found === undefined) return false;
      const symbol =
        found.flags & ts.SymbolFlags.Alias ? typeChecker().getAliasedSymbol(found) : found;
      const declarations = symbol.declarations ?? [];
      return (
        declarations.length > 0 &&
        declarations.every((one) => isPlatformSourceFile(program, one.getSourceFile()))
      );
    },
    isPlainClass(node) {
      const checker = typeChecker();
      const type = checker.getTypeAtLocation(node);
      if (platformNameOf(type)?.endsWith("Constructor") === true) return true;
      const found = checker.getSymbolAtLocation(node);
      if (found === undefined) return false;
      const symbol = found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
      const declarations = symbol.declarations ?? [];
      const ownFile = (one: ts.Node): boolean =>
        own.has(toTypeScriptPath(one.getSourceFile().fileName));
      // A static `Symbol.hasInstance` of the class or a class it extends runs code.
      const runsCode = checker
        .getPropertiesOfType(type)
        .some(
          (property) =>
            property.getName().includes("hasInstance") &&
            (property.declarations ?? []).some(ownFile),
        );
      return (
        !runsCode &&
        declarations.length > 0 &&
        declarations.every((one) => ts.isClassDeclaration(one) && ownFile(one))
      );
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
    reportsReachableEnd(fn) {
      const body = fn.body;
      if (body === undefined) return false;
      const sourceFile = fn.getSourceFile();
      let starts = reachableEndErrors.get(sourceFile);
      if (starts === undefined) {
        starts = program
          .getSemanticDiagnostics(sourceFile)
          .filter((diagnostic) => REACHABLE_END_CODES.has(diagnostic.code))
          .flatMap((diagnostic) => (diagnostic.start === undefined ? [] : [diagnostic.start]));
        reachableEndErrors.set(sourceFile, starts);
      }
      const from = fn.getStart(sourceFile);
      const to = body.getStart(sourceFile);
      return starts.some((start) => start >= from && start < to);
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
      return isErrorTypeOf(typeChecker().getTypeAtLocation(node));
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
