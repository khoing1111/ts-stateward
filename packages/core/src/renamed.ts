/**
 * Rule ids a release renamed, so that a rule's name says what is wrong. The old id keeps working:
 * a config, an ignore comment, the rollout file and the baseline that still use one are read under
 * the new id, with a warning that says what to rename. Ids only: core still knows no library.
 */

const RULES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    // 1.2.0
    "unions/default-hides-cases": "unions/non-exhaustive-switch",
    "unions/tag-does-not-discriminate": "unions/ambiguous-discriminant",
    "records/table-type-too-loose": "records/ambiguous-table",
    "react/provider-value-changes-every-render":
      "react-context/provider-value-changes-every-render",
  }),
);

/** The id a renamed rule has now, or undefined when `ruleId` was not renamed. */
export function renamedRule(ruleId: string): string | undefined {
  return RULES.get(ruleId);
}

/** What a config that names an old id is told: `a` is now `b`; rename it in `where`. */
export function renameNotice(before: string, now: string, where: string): string {
  return `\`${before}\` is now \`${now}\`; rename it in ${where}`;
}

/**
 * What a config that names an old id is told when the rule moved to a pack it does not load
 * (`react/a` is now `react-context/a`): the entry is ignored until the pack is added.
 */
export function movedNotice(before: string, now: string, where: string): string {
  const pack = now.split("/")[0] ?? now;
  return `\`${before}\` is now \`${now}\`, in the ${pack} pack, which the config does not load; add that pack, or remove the line in ${where}`;
}

/** An old rule id written in quotes in a file's text: the id's span, its line, and the new id. */
export type RenamedIdPlace = {
  readonly before: string;
  readonly now: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
};

/**
 * Every old id a text names as a string (`"records/table-type-too-loose"`), in order: what a
 * config file has to rename, and where. Only whole quoted ids count, so a longer id or a comment
 * that mentions one in other words is left alone.
 */
export function renamedIdsIn(text: string): RenamedIdPlace[] {
  const places: RenamedIdPlace[] = [];
  const quoted = /(["'`])([^"'`\n]+)\1/g;
  for (const match of text.matchAll(quoted)) {
    const id = match[2];
    const now = id === undefined ? undefined : RULES.get(id);
    if (id === undefined || now === undefined) continue;
    const start = match.index + 1;
    const line = text.slice(0, start).split("\n").length;
    places.push({ before: id, now, start, end: start + id.length, line });
  }
  return places;
}
