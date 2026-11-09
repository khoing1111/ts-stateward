// a union declared in TypeScript's lib (or a package) is not a state the
// app designed: with `projectTypesOnly` (the default) it is not checked.
export function pluralSuffix(count: number): string {
  const rule: Intl.LDMLPluralRule = new Intl.PluralRules("en").select(count);
  switch (rule) {
    case "one":
      return "";
    default:
      return "s";
  }
}
