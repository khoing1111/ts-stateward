/** An `in` test on a key taken from `Object.keys` of the same object: each is an own key. */
const TERMS = { a: "A", b: "B" } as const;
type TermId = keyof typeof TERMS;

export const termIds = (): TermId[] =>
  Object.keys(TERMS).filter((key): key is TermId => key in TERMS);

export const firstTerm = (): TermId | undefined =>
  Object.keys(TERMS).find(function (key): key is TermId {
    return key in TERMS;
  });

export function inGuard(): string[] {
  const found: string[] = [];
  for (const key of Object.keys(TERMS)) if (key in TERMS) found.push(TERMS[key as TermId]);
  return found;
}
