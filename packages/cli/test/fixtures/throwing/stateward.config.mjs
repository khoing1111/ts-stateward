const rule = {
  kind: "file",
  meta: {
    description: "always throws",
    defaultSeverity: "error",
    tier: "core",
    group: "g",
    explain: "Always throws.",
  },
  check() {
    throw new Error("kaput");
  },
};

export default { preset: "recommended", plugins: [{ name: "boom", description: "Fails on purpose.", rules: { throws: rule } }] };
