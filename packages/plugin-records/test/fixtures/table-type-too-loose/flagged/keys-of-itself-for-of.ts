// The keys come from `Object.keys` of the same record and are looked up again in it: the hint says
// to take key and value together with `Object.entries`.
const scores: Record<string, number> = { ann: 3, bob: 5 };

export function totalScore(): number {
  let sum = 0;
  for (const name of Object.keys(scores)) sum += scores[name] ?? 0;
  return sum;
}
