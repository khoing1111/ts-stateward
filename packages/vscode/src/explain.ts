/** The command a code action runs, and the server request behind it (both named in the language server). */
export const EXPLAIN_COMMAND = "stateward.explain";
export const EXPLAIN_REQUEST = "stateward/explain";
/** Explanations open as read-only documents of this scheme, which the Markdown preview can show. */
export const EXPLAIN_SCHEME = "stateward-explain";

/** The rule id a `stateward.explain` call carries; undefined when the argument is anything else. */
export function ruleIdFromArgument(argument: unknown): string | undefined {
  return typeof argument === "string" && argument.length > 0 ? argument : undefined;
}

/** The path of a rule's explanation document: `react-context/fake-default-value` -> `/react-context/fake-default-value.md`. */
export function explainPath(ruleId: string): string {
  return `/${ruleId}.md`;
}
