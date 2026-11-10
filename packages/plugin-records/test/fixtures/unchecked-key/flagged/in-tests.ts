/** An `in` test on a key that is not taken from the same object. */
const TERMS = { a: "A", b: "B" } as const;
const OTHER = { a: 1, b: 2, c: 3 };
type TermId = keyof typeof TERMS;

export const otherIds = (): TermId[] =>
  Object.keys(OTHER).filter((key): key is TermId => key in TERMS);

export const listed = (keys: string[]): TermId[] =>
  keys.filter((key): key is TermId => key in TERMS);
