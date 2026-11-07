import path from "node:path";
import ts from "typescript";

/**
 * What `tsc -p` prints for a project, computed in this process. A test that asks "does this code
 * compile?" many times would otherwise spawn tsc for each question (seconds each, and a timeout
 * when the machine is busy). Library files and the previous program of each option set are kept
 * for the life of the module, so a later question costs only the files that changed. The text is
 * the same as tsc's: same diagnostics, same order, same format, "" when the code compiles.
 */

const sourceFiles = new Map<string, { text: string; file: ts.SourceFile }>();
const lastPrograms = new Map<string, ts.Program>();

function formatHostIn(directory: string): ts.FormatDiagnosticsHost {
  return {
    getCurrentDirectory: () => directory,
    getCanonicalFileName: (name) => name,
    getNewLine: () => ts.sys.newLine,
  };
}

/** A compiler host over the disk plus `overlay` (virtual files), reusing unchanged source files. */
function hostFor(
  options: ts.CompilerOptions,
  overlay: ReadonlyMap<string, string>,
  currentDirectory: string,
): ts.CompilerHost {
  const base = ts.createCompilerHost(options, true);
  const read = (fileName: string): string | undefined =>
    overlay.get(path.resolve(fileName)) ?? base.readFile(fileName);
  return {
    ...base,
    getCurrentDirectory: () => currentDirectory,
    fileExists: (fileName) => overlay.has(path.resolve(fileName)) || base.fileExists(fileName),
    readFile: read,
    getSourceFile: (fileName, languageVersionOrOptions) => {
      const text = read(fileName);
      if (text === undefined) return undefined;
      const key = `${path.resolve(fileName)}\0${JSON.stringify(languageVersionOrOptions)}`;
      const cached = sourceFiles.get(key);
      if (cached?.text === text) return cached.file;
      const file = ts.createSourceFile(fileName, text, languageVersionOrOptions, true);
      sourceFiles.set(key, { text, file });
      return file;
    },
  };
}

type Compiled = { program: ts.Program; configErrors: readonly ts.Diagnostic[] };

function compile(
  rootNames: readonly string[],
  options: ts.CompilerOptions,
  overlay: ReadonlyMap<string, string>,
  configErrors: readonly ts.Diagnostic[],
  currentDirectory: string,
  cacheKey: string,
): Compiled {
  const program = ts.createProgram(
    rootNames,
    options,
    hostFor(options, overlay, currentDirectory),
    lastPrograms.get(cacheKey),
    configErrors,
  );
  lastPrograms.set(cacheKey, program);
  return { program, configErrors };
}

/** The diagnostics `tsc` reports, in its order: syntax first, the rest only when syntax is clean. */
function diagnosticsOf({ program, configErrors }: Compiled, only?: ts.SourceFile): ts.Diagnostic[] {
  const syntactic = [...configErrors, ...program.getSyntacticDiagnostics(only)];
  const all =
    syntactic.length > 0
      ? syntactic
      : [
          ...program.getOptionsDiagnostics(),
          ...program.getGlobalDiagnostics(),
          ...program.getSemanticDiagnostics(only),
        ];
  return [...ts.sortAndDeduplicateDiagnostics(all)];
}

/** The compiler's complaints about the project at `dir` (its tsconfig.json), as `tsc -p dir` prints them. */
export function typeErrors(dir: string): string {
  const configPath = path.resolve(dir, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    },
  );
  if (parsed === undefined) throw new Error(`cannot read ${configPath}`);
  const compiled = compile(
    parsed.fileNames,
    parsed.options,
    new Map(),
    parsed.errors,
    ts.sys.getCurrentDirectory(),
    `project\0${JSON.stringify(parsed.options)}`,
  );
  const diagnostics = diagnosticsOf(compiled);
  return diagnostics.length === 0
    ? ""
    : ts.formatDiagnostics(diagnostics, formatHostIn(ts.sys.getCurrentDirectory()));
}

const TEXT_OPTIONS: ts.CompilerOptions = {
  strict: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  types: [],
};

/** Not a real folder: its files exist only as overlay text. */
const VIRTUAL_DIR = path.join(path.sep, "stateward-virtual-texts");

/**
 * The type errors of each text, as `tsc` prints them with each text a file of its own
 * ("a3.ts(1,2): error ..."); a text maps to "" when it compiles. The strict, NodeNext options of
 * the old spawned check. Texts must be modules, or their top-level names would meet in one scope.
 */
export function typeErrorsOfTexts(texts: readonly string[]): ReadonlyMap<string, string> {
  return typeErrorsOfNamed(texts, (index) => `a${String(index)}.ts`);
}

function typeErrorsOfNamed(
  texts: readonly string[],
  nameOf: (index: number) => string,
): ReadonlyMap<string, string> {
  const unique = [...new Set(texts)];
  const notModules = unique.filter((text) => !/^(?:import|export)\b/m.test(text));
  if (notModules.length > 0) {
    throw new Error("a text with no top-level import or export cannot be compiled with the others");
  }
  const names = unique.map((_, index) => nameOf(index));
  const overlay = new Map(
    unique.map((text, index) => [path.join(VIRTUAL_DIR, names[index] ?? ""), text]),
  );
  const compiled = compile([...overlay.keys()], TEXT_OPTIONS, overlay, [], VIRTUAL_DIR, "texts");
  const diagnostics = diagnosticsOf(compiled);
  const perFile = new Map<string, ts.Diagnostic[]>();
  const unplaced: ts.Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const name =
      diagnostic.file === undefined ? undefined : path.basename(diagnostic.file.fileName);
    if (name === undefined) unplaced.push(diagnostic);
    else perFile.set(name, [...(perFile.get(name) ?? []), diagnostic]);
  }
  const show = (list: readonly ts.Diagnostic[]): string =>
    ts.formatDiagnostics(list, formatHostIn(VIRTUAL_DIR)).replace(/\r?\n$/, "");
  const unplacedText = show(unplaced);
  return new Map(
    unique.map((text, index) => [
      text,
      [show(perFile.get(names[index] ?? "") ?? []), unplacedText]
        .filter((s) => s !== "")
        .join("\n"),
    ]),
  );
}

/** The type errors of one text (see `typeErrorsOfTexts`), "" when it compiles. */
export function typeErrorsOfText(text: string): string {
  return typeErrorsOfNamed([text], () => "a.ts").get(text) ?? "";
}
