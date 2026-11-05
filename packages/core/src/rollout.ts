import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ruleIds } from "./severity.js";
import type { Config } from "./types.js";

export const ROLLOUT_FILE = "stateward.rollout.json";
const ROLLOUT_VERSION = 1;

/**
 * The rollout file cannot be used. The message says which file, why, and what to do;
 * `cause` carries the system error when there is one.
 */
export class RolloutError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "RolloutError";
    Object.setPrototypeOf(this, RolloutError.prototype);
  }
}

/** The rollout file of `config`: next to the config file. */
export function rolloutFile(config: Pick<Config, "configDir">): string {
  return path.join(config.configDir, ROLLOUT_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function broken(file: string, why: string, fix: string): RolloutError {
  return new RolloutError(`${path.basename(file)} ${why}; ${fix}`);
}

const REPAIR = "fix it, or delete it to start again with `stateward next`";

function parseEnabled(text: string, file: string, known: ReadonlySet<string>): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw broken(file, `is not valid JSON (${reasonOf(error)})`, REPAIR);
  }
  if (!isRecord(parsed)) {
    throw broken(file, 'must be an object like { "version": 1, "enabled": [] }', REPAIR);
  }
  const extra = Object.keys(parsed).find((key) => key !== "version" && key !== "enabled");
  if (extra !== undefined) throw broken(file, `has an unknown key "${extra}"`, REPAIR);
  if (parsed.version !== ROLLOUT_VERSION) {
    throw broken(
      file,
      `has version ${JSON.stringify(parsed.version)}, but this stateward reads version ${String(ROLLOUT_VERSION)}`,
      "update stateward, or delete the file to start again with `stateward next`",
    );
  }
  const { enabled } = parsed;
  if (!isStringArray(enabled)) {
    throw broken(file, '"enabled" must be a list of rule ids', REPAIR);
  }
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const listed of enabled) {
    const id = listed;
    if (!known.has(id)) {
      throw broken(
        file,
        `lists "${id}", which is not a rule of your packs`,
        `remove "${id}" from its "enabled" list; the other rules stay on`,
      );
    }
    if (seen.has(id)) throw broken(file, `lists "${id}" twice`, REPAIR);
    seen.add(id);
    kept.push(id);
  }
  return kept;
}

/**
 * The rules turned on, in the order they were turned on. A missing file means none yet; a file
 * that cannot be read or understood throws `RolloutError`, never "nothing there".
 */
export function readRollout(config: Config): readonly string[] {
  const file = rolloutFile(config);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isMissing(error)) return [];
    throw new RolloutError(
      `${path.basename(file)} cannot be read (${reasonOf(error)}); fix the file or its permissions, then run again`,
      { cause: error },
    );
  }
  return parseEnabled(text, file, new Set(ruleIds(config.plugins)));
}

/**
 * Saves the rules turned on. Atomic: the text goes to a temp file beside the target, then one
 * rename replaces it, so a crash leaves the old file or the new one, never half of it.
 */
export function writeRollout(config: Config, enabled: readonly string[]): void {
  const file = rolloutFile(config);
  const temp = `${file}.${String(process.pid)}.tmp`;
  const text = `${JSON.stringify({ version: ROLLOUT_VERSION, enabled }, null, 2)}\n`;
  try {
    writeFileSync(temp, text);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw new RolloutError(
      `${path.basename(file)} cannot be written (${reasonOf(error)}); check that the folder is writable, then run again`,
      { cause: error },
    );
  }
}
