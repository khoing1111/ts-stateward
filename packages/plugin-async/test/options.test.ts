import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import type { OptionValue, RuleConfig } from "@stateward/core";
import { asyncFlow } from "../src/index.js";
import { brief, checkWith, fixture as handlerFixture } from "./handler-helpers.js";
import { fixture } from "./helpers.js";

/*
 * Each option of the async pack, shown changing what its rule reports. The default of
 * every option is today's behaviour, which the rule's own tests cover.
 */

const RULES = ["pending-state-stuck-on-failure", "handler-rejection-lost"] as const;
const pack = asyncFlow();

/** `file: headline` of each finding of `rule` over a fixture, with the options given. */
function lines(
  name: string,
  rule: (typeof RULES)[number],
  options: Readonly<Record<string, OptionValue>> = {},
): string[] {
  const rules: Record<string, RuleConfig> = {};
  for (const key of RULES) rules[`async/${key}`] = key === rule ? ["warning", options] : "off";
  const { findings } = checkFixture(fixture(name), [pack], rules, []);
  expectMessageStandard(findings);
  return findings.map((finding) => `${path.basename(finding.location.file)}: ${finding.message}`);
}

const count = (...args: Parameters<typeof lines>): number => lines(...args).length;

describe("async/pending-state-stuck-on-failure options", () => {
  const dir = "pending-state-stuck-on-failure/flagged";
  it("`ignore` leaves out the states named", () => {
    expect(count(dir, "pending-state-stuck-on-failure")).toBe(13);
    expect(count(dir, "pending-state-stuck-on-failure", { ignore: ["loading", "busy"] })).toBe(8);
    expect(lines(dir, "pending-state-stuck-on-failure", { ignore: ["*"] })).toEqual([]);
  });
});

/** How many findings of the handler rule mention `text` under the options given. */
function handlerCount(
  name: string,
  options: Readonly<Record<string, OptionValue>>,
  text: string,
): number {
  return brief(
    checkWith(handlerFixture(name), "handler-rejection-lost", ["error", options]),
  ).filter((line) => line.includes(text)).length;
}

describe("async/handler-rejection-lost options", () => {
  const dir = "handler-rejection-lost/flagged";
  it("`ignoreProps` leaves out the props a library awaits", () => {
    expect(handlerCount(dir, {}, "`onSave`")).toBe(5);
    expect(handlerCount(dir, { ignoreProps: ["onSave"] }, "`onSave`")).toBe(0);
    expect(handlerCount(dir, { ignoreProps: ["on*"] }, " handler is")).toBe(0);
  });

  it("`timers` says which calls take a callback nobody awaits", () => {
    expect(handlerCount(dir, {}, "callback")).toBe(6);
    expect(handlerCount(dir, { timers: ["setInterval"] }, "callback")).toBe(1);
  });
});
