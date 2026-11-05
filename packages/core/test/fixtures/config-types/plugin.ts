import { definePlugin, defineRule, option } from "../../../src/index.js";

const sized = defineRule({
  kind: "file",
  meta: {
    description: "d",
    defaultSeverity: "warning",
    tier: "core",
    group: "sizing",
    explain: "e",
    options: {
      max: option.number({ default: 3, description: "Most." }),
      mode: option.string({ default: "a", description: "Mode.", oneOf: ["a", "b"] }),
      ignore: option.strings({ default: [], description: "Names." }),
      levels: option.severities({ kinds: { sure: "S.", guess: "G." }, description: "Per kind." }),
    },
  },
  check() {
    return;
  },
});

const plain = defineRule({
  kind: "file",
  meta: { description: "d", defaultSeverity: "warning", tier: "core", group: "g", explain: "e" },
  check() {
    return;
  },
});

export const first = definePlugin({
  name: "first",
  description: "d",
  rules: { sized, plain },
});

export const second = definePlugin({
  name: "second",
  description: "d",
  rules: { plain },
});
