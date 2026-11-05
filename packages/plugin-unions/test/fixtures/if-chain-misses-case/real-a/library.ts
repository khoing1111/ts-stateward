// a union declared in TypeScript's lib is not checked by default.
export function pluralSuffix(count: number): string {
  const rule: Intl.LDMLPluralRule = new Intl.PluralRules("en").select(count);
  if (rule === "one") {
    return "";
  } else if (rule === "two") {
    return "s";
  } else {
    return "s";
  }
}
