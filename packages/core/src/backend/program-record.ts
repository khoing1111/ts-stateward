import { createHash } from "node:crypto";
import ts from "typescript";
import { textHash } from "./fingerprints.js";

/**
 * What a program was built from, recorded so that a later run can prove it would build the same
 * program without building it. `createProgram` is a deterministic
 * function of its root names, its options and the answers of its compiler host: which files and
 * folders exist, what files and folders hold, where links point. Each answer the host gave is
 * recorded (texts as hashes). A later run asks the same questions again; when every answer is
 * the same, the program, and so every file's dependency fingerprint, is the same, and results
 * cached under those fingerprints are the results. Any difference, or any doubt, builds the
 * program.
 */

/**
 * One question to the host and its answer: `exists` a file, `folder` exists, `read` a file (the
 * hash of its text), `real` path of a link, `dirs` in a folder, `source` file (the hash of its
 * text). A missing answer is "".
 */
export type HostQuery = readonly [kind: QueryKind, path: string, answer: string];
type QueryKind = "exists" | "folder" | "read" | "real" | "dirs" | "source";

export type ProgramRecord = {
  /** Hash of what the program is built from besides the host's answers (`recordInputs`). */
  readonly inputs: string;
  readonly queries: readonly HostQuery[];
  /** The own files the program has, in order. */
  readonly files: readonly string[];
  /** Their dependency fingerprints. */
  readonly fingerprints: Readonly<Record<string, string>>;
  /**
   * The full fingerprints (`Fingerprints.full`) of the files rules read the syntax of, by file:
   * filled while the run that built the program asks for them.
   */
  readonly reads: Record<string, string>;
};

export function isQueryKind(value: unknown): value is QueryKind {
  return (
    value === "exists" ||
    value === "folder" ||
    value === "read" ||
    value === "real" ||
    value === "dirs" ||
    value === "source"
  );
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/** Everything else a program depends on: its inputs, TypeScript's version and lib folder, the process folder. */
export function recordInputs(programInputs: string, options: ts.CompilerOptions): string {
  return sha1(
    JSON.stringify([programInputs, ts.version, ts.getDefaultLibFilePath(options), process.cwd()]),
  );
}

/** `host`, recording each answer it gives into `queries`. */
export function recordingHost(
  host: ts.CompilerHost,
  queries: Map<string, HostQuery>,
): ts.CompilerHost {
  const note = (kind: QueryKind, path: string, answer: string): void => {
    queries.set(`${kind}\u0000${path}`, [kind, path, answer]);
  };
  return {
    ...host,
    fileExists: (fileName) => {
      const exists = host.fileExists(fileName);
      note("exists", fileName, exists ? "1" : "");
      return exists;
    },
    readFile: (fileName) => {
      const text = host.readFile(fileName);
      note("read", fileName, text === undefined ? "" : sha1(text));
      return text;
    },
    getSourceFile: (fileName, languageVersionOrOptions, onError, shouldCreate) => {
      const sourceFile = host.getSourceFile(
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreate,
      );
      note("source", fileName, sourceFile === undefined ? "" : textHash(sourceFile));
      return sourceFile;
    },
    ...(host.directoryExists === undefined
      ? {}
      : {
          directoryExists: (name: string) => {
            const exists = host.directoryExists?.(name) ?? false;
            note("folder", name, exists ? "1" : "");
            return exists;
          },
        }),
    ...(host.realpath === undefined
      ? {}
      : {
          realpath: (name: string) => {
            const real = host.realpath?.(name) ?? name;
            note("real", name, real);
            return real;
          },
        }),
    ...(host.getDirectories === undefined
      ? {}
      : {
          getDirectories: (name: string) => {
            const found = host.getDirectories?.(name) ?? [];
            note("dirs", name, JSON.stringify(found));
            return found;
          },
        }),
  };
}

/** Whether `host` gives every recorded answer again. */
export function replays(queries: readonly HostQuery[], host: ts.CompilerHost): boolean {
  return queries.every(([kind, path, answer]) => {
    switch (kind) {
      case "exists":
        return (host.fileExists(path) ? "1" : "") === answer;
      case "folder":
        return (
          host.directoryExists !== undefined && (host.directoryExists(path) ? "1" : "") === answer
        );
      case "read":
      case "source": {
        const text = host.readFile(path);
        return (text === undefined ? "" : sha1(text)) === answer;
      }
      case "real":
        return host.realpath?.(path) === answer;
      case "dirs":
        return (
          host.getDirectories !== undefined && JSON.stringify(host.getDirectories(path)) === answer
        );
      default: {
        const unreachable: never = kind;
        return unreachable;
      }
    }
  });
}
