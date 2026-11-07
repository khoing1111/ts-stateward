/**
 * The sections a bundled rule's explain text may have, in this order. Before them come the title,
 * a one-sentence summary and the example (bad code, then the fixed code), so a reader who just
 * saw a finding meets the code first.
 */
export const EXPLAIN_SECTIONS = [
  "Why it matters",
  "When it says “not checked”",
  "What it does not catch",
  "Getting the best from it",
  "Turn it on or off",
] as const;

/** The sections every bundled rule has; the others are left out when they would say nothing. */
export const REQUIRED_EXPLAIN_SECTIONS: readonly (typeof EXPLAIN_SECTIONS)[number][] = [
  "Why it matters",
  "What it does not catch",
  "Turn it on or off",
];

/** The example fences: ```ts example-bad, ```tsx example-good file=Panel.tsx. */
const EXAMPLE_FENCE = /^```(?:ts|tsx) example-(bad|good)(?: file=[\w./-]+)?$/;

/**
 * What is wrong with a bundled rule's explain text: a missing title, summary, example or section,
 * an unknown section, or sections out of order. Empty when it is as it should be. A `##` heading
 * inside a code fence is not a section.
 */
export function explainSectionProblems(id: string, explain: string): readonly string[] {
  const lines = explain.split("\n");
  const problems: string[] = [];
  if (lines[0] !== `# ${id}`) problems.push(`${id}: the explain text must start with "# ${id}"`);
  const headings: string[] = [];
  const examples: { role: string; beforeSections: boolean }[] = [];
  let fenced = false;
  for (const line of lines) {
    const example = fenced ? null : EXAMPLE_FENCE.exec(line);
    if (example !== null) {
      examples.push({ role: example[1] ?? "", beforeSections: headings.length === 0 });
    }
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced && line.startsWith("## ")) headings.push(line.slice(3).trim());
  }
  const summary = lines.slice(1).find((line) => line.trim() !== "");
  if (summary === undefined || summary.startsWith("#") || summary.startsWith("```")) {
    problems.push(`${id}: the explain text needs a one-sentence summary after the title`);
  }
  for (const role of ["bad", "good"]) {
    if (!examples.some((example) => example.role === role && example.beforeSections)) {
      problems.push(
        `${id}: the explain text needs a \`ts example-${role}\` block before its sections`,
      );
    }
  }
  for (const section of REQUIRED_EXPLAIN_SECTIONS) {
    if (!headings.includes(section)) {
      problems.push(`${id}: the explain text lacks the section "## ${section}"`);
    }
  }
  for (const heading of headings) {
    if (!EXPLAIN_SECTIONS.some((section) => section === heading)) {
      problems.push(`${id}: "## ${heading}" is not one of the sections; the order is ${order()}`);
    }
  }
  const present = headings.filter((heading) => EXPLAIN_SECTIONS.some((s) => s === heading));
  const expected = EXPLAIN_SECTIONS.filter((section) => present.includes(section));
  const misplaced = expected.find((section, index) => present[index] !== section);
  if (misplaced !== undefined) {
    problems.push(`${id}: the section "## ${misplaced}" is out of order; the order is ${order()}`);
  }
  return problems;
}

function order(): string {
  return EXPLAIN_SECTIONS.map((section) => `"${section}"`).join(", ");
}
