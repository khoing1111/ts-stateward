/** A component the project says is rendered by something stateward cannot see. */
export type EntryOption = {
  /** Relative to the project, with forward slashes. */
  file: string;
  /** The exported name, or `default`. */
  export: string;
  /** Names of required contexts already provided above the entry. */
  provides?: readonly string[];
};

export type ReactContextOptions = { entries?: readonly EntryOption[] };

/** The checked form of `ReactContextOptions`. */
export type EntryPoint = { file: string; export: string; provides: readonly string[] };

/** `reactContext(options)` was given something that is not a valid option. */
export class ReactContextOptionsError extends Error {
  constructor(problems: readonly string[]) {
    super(
      `invalid react-context options:\n${problems.map((problem) => `  ${problem}`).join("\n")}`,
    );
    this.name = "ReactContextOptionsError";
  }
}

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unexpectedKeys(fields: Fields, allowed: readonly string[], where: string): string[] {
  return Object.keys(fields)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${where}.${key} is not an option; the options are ${allowed.join(", ")}`);
}

function normalizeFile(file: string): string {
  return file.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
}

function isRelative(file: string): boolean {
  return !/^(?:[A-Za-z]:|\/)/.test(file) && !file.split("/").includes("..");
}

function parseEntry(value: unknown, index: number): EntryPoint | string[] {
  const where = `entries[${String(index)}]`;
  if (!isFields(value)) {
    return [`${where} must be an object like { file: "src/App.tsx", export: "App" }`];
  }
  const problems = unexpectedKeys(value, ["file", "export", "provides"], where);
  const { file, export: exportName, provides = [] } = value;
  if (typeof file !== "string" || file.trim() === "") {
    problems.push(`${where}.file must be a path relative to the project, like "src/App.tsx"`);
  } else if (!isRelative(normalizeFile(file))) {
    problems.push(
      `${where}.file must be relative to the project and stay inside it, not "${file}"`,
    );
  }
  if (typeof exportName !== "string" || exportName.trim() === "") {
    problems.push(`${where}.export must be the exported name, or "default"`);
  }
  const names = Array.isArray(provides) ? provides : undefined;
  if (!names?.every((name) => typeof name === "string" && name !== "")) {
    problems.push(`${where}.provides must be a list of context names, like ["ThemeCtx"]`);
  }
  if (problems.length > 0) return problems;
  return {
    file: normalizeFile(String(file)),
    export: String(exportName),
    provides: names?.map(String) ?? [],
  };
}

/** Parses the options of `reactContext(…)`; throws a `ReactContextOptionsError` naming every problem. */
export function parseOptions(options: unknown): readonly EntryPoint[] {
  if (options === undefined) return [];
  if (!isFields(options)) {
    throw new ReactContextOptionsError(["the options must be an object like { entries: [...] }"]);
  }
  const problems = unexpectedKeys(options, ["entries"], "options");
  const { entries = [] } = options;
  if (!Array.isArray(entries)) {
    problems.push("options.entries must be a list of { file, export, provides? }");
    throw new ReactContextOptionsError(problems);
  }
  const parsed: EntryPoint[] = [];
  entries.forEach((entry: unknown, index) => {
    const result = parseEntry(entry, index);
    if (Array.isArray(result)) problems.push(...result);
    else parsed.push(result);
  });
  if (problems.length > 0) throw new ReactContextOptionsError(problems);
  return parsed;
}
