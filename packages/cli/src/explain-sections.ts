/** The sections every bundled rule's explain text has, in this order. */
export const EXPLAIN_SECTIONS = [
  "Why",
  "When to use it",
  "What it catches",
  "What it does not catch",
  "Turn it on or off",
] as const;

/**
 * What is wrong with a bundled rule's explain text: a missing title, summary or section, or
 * sections out of order. Empty when it is as it should be. A `##` heading inside a code fence is
 * not a section.
 */
export function explainSectionProblems(id: string, explain: string): readonly string[] {
  const lines = explain.split("\n");
  const problems: string[] = [];
  if (lines[0] !== `# ${id}`) problems.push(`${id}: the explain text must start with "# ${id}"`);
  const headings: string[] = [];
  let fenced = false;
  for (const line of lines) {
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced && line.startsWith("## ")) headings.push(line.slice(3).trim());
  }
  const summary = lines.slice(1).find((line) => line.trim() !== "");
  if (summary === undefined || summary.startsWith("#")) {
    problems.push(`${id}: the explain text needs a one-sentence summary after the title`);
  }
  for (const section of EXPLAIN_SECTIONS) {
    if (!headings.includes(section)) {
      problems.push(`${id}: the explain text lacks the section "## ${section}"`);
    }
  }
  const present = headings.filter((heading) => EXPLAIN_SECTIONS.some((s) => s === heading));
  const expected = EXPLAIN_SECTIONS.filter((section) => present.includes(section));
  const misplaced = expected.find((section, index) => present[index] !== section);
  if (misplaced !== undefined) {
    problems.push(
      `${id}: the section "## ${misplaced}" is out of order; the order is ${EXPLAIN_SECTIONS.map((s) => `"${s}"`).join(", ")}`,
    );
  }
  return problems;
}
