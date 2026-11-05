/** The custom messages of the language server (packages/language-server/src/adoption.ts), read at the boundary. */
export const STATUS_NOTIFICATION = "stateward/status";
/** A config's whole-project check started (`checking: true`) or ended. */
export const CHECKING_NOTIFICATION = "stateward/checking";
export const PLAN_REQUEST = "stateward/plan";
export const NEXT_REQUEST = "stateward/next";
export const RECHECK_REQUEST = "stateward/recheck";

export type Status = {
  /** The config this status is for (one per config in a monorepo); absent from an older server. */
  configFile?: string;
  errors: number;
  warnings: number;
  infos: number;
  /** Findings the baseline accepts; not in the counts above. */
  baselined: number;
  /** Set when the config turns no rule on (a plugin alone turns nothing on); absent otherwise. */
  noRulesOn?: true;
  rollout: {
    on: boolean;
    current?: { ruleId: string; findings: number };
    enabled: number;
    total: number;
  };
};

export type PlanRule = {
  order: number;
  ruleId: string;
  /** "<plugin>/<group>" */
  group: string;
  findings: number;
  fixable: number;
  protects: string;
};

export type Plan = { rollout: boolean; enabled: readonly string[]; rules: readonly PlanRule[] };

export type NextKind = "turned-on" | "all-on" | "blocked" | "rollout-off" | "failed";
export type NextAnswer = { kind: NextKind; message: string };

/** The server answered with something this version of the extension does not understand. */
export class UnexpectedAnswerError extends Error {
  constructor(request: string) {
    super(
      `The language server's answer to ${request} is not one this extension understands; update the extension and stateward to the same version`,
    );
    this.name = "UnexpectedAnswerError";
    Object.setPrototypeOf(this, UnexpectedAnswerError.prototype);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseCurrent(value: unknown): Status["rollout"]["current"] | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const { ruleId, findings } = value;
  return typeof ruleId === "string" && isCount(findings) ? { ruleId, findings } : null;
}

/** The status in a `stateward/status` notification; undefined for anything else. */
export function parseStatus(value: unknown): Status | undefined {
  if (!isRecord(value) || !isRecord(value.rollout)) return undefined;
  const { errors, warnings, infos, rollout } = value;
  // A server from before the baseline sends no count: none are baselined.
  const baselined = value.baselined === undefined ? 0 : value.baselined;
  const { on, enabled, total } = rollout;
  const current = parseCurrent(rollout.current);
  if (
    !isCount(errors) ||
    !isCount(warnings) ||
    !isCount(infos) ||
    !isCount(baselined) ||
    typeof on !== "boolean" ||
    !isCount(enabled) ||
    !isCount(total) ||
    current === null
  ) {
    return undefined;
  }
  const { configFile } = value;
  if (configFile !== undefined && typeof configFile !== "string") return undefined;
  return {
    ...(configFile === undefined ? {} : { configFile }),
    errors,
    warnings,
    infos,
    baselined,
    ...(value.noRulesOn === true ? { noRulesOn: true } : {}),
    rollout: { on, ...(current === undefined ? {} : { current }), enabled, total },
  };
}

export type Checking = { configFile: string; checking: boolean };

/** The payload of a `stateward/checking` notification; undefined for anything else. */
export function parseChecking(value: unknown): Checking | undefined {
  if (!isRecord(value)) return undefined;
  const { configFile, checking } = value;
  return typeof configFile === "string" && typeof checking === "boolean"
    ? { configFile, checking }
    : undefined;
}

function parseRule(value: unknown): PlanRule | undefined {
  if (!isRecord(value)) return undefined;
  const { order, ruleId, group, findings, fixable, protects } = value;
  if (
    !isCount(order) ||
    typeof ruleId !== "string" ||
    typeof group !== "string" ||
    !isCount(findings) ||
    !isCount(fixable) ||
    typeof protects !== "string"
  ) {
    return undefined;
  }
  return { order, ruleId, group, findings, fixable, protects };
}

/** The answer to `stateward/plan`; throws `UnexpectedAnswerError` for anything else. */
export function parsePlan(value: unknown): Plan {
  if (!isRecord(value) || typeof value.rollout !== "boolean") {
    throw new UnexpectedAnswerError(PLAN_REQUEST);
  }
  const { enabled, rules } = value;
  if (
    !Array.isArray(enabled) ||
    !enabled.every((id: unknown) => typeof id === "string") ||
    !Array.isArray(rules)
  ) {
    throw new UnexpectedAnswerError(PLAN_REQUEST);
  }
  const parsed = rules.map((rule: unknown) => parseRule(rule));
  const complete = parsed.filter((rule) => rule !== undefined);
  if (complete.length !== parsed.length) throw new UnexpectedAnswerError(PLAN_REQUEST);
  return { rollout: value.rollout, enabled, rules: complete };
}

const NEXT_KINDS: readonly NextKind[] = ["turned-on", "all-on", "blocked", "rollout-off", "failed"];

/** The answer to `stateward/next`; throws `UnexpectedAnswerError` for anything else. */
export function parseNext(value: unknown): NextAnswer {
  if (!isRecord(value) || typeof value.message !== "string") {
    throw new UnexpectedAnswerError(NEXT_REQUEST);
  }
  const kind = NEXT_KINDS.find((candidate) => candidate === value.kind);
  if (kind === undefined) throw new UnexpectedAnswerError(NEXT_REQUEST);
  return { kind, message: value.message };
}
