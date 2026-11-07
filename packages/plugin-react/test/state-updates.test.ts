import { describe, expect, it } from "vitest";
import { checkFixture } from "@stateward/core/testing";
import { react } from "../src/index.js";
import { check, fixture, shown, type Shown } from "./helpers.js";

const STATE_UPDATES = fixture("state-updates");
/** Lists the React Compiler in its package.json. */
const COMPILED = fixture("state-updates-compiled");

const plugin = react();
const findings = (dir: string): Shown[] => shown(dir, check(dir, {}, [plugin]));
const ofRule = (rule: string, dir: string = STATE_UPDATES): Shown[] =>
  findings(dir).filter((finding) => finding.rule === `react/${rule}`);

const stale: Shown[] = [
  {
    rule: "react/closure-reads-stale-state",
    severity: "warning",
    file: "ChatRoom.tsx",
    at: "setMessages([...messages, message])",
    message: "the listener reads a stale `messages`: the value from an earlier render",
    hint: "pass an updater, which gets the latest value: `setMessages((messages) => [...messages, message])` (quick fix)",
    notes: [],
    fixes: ["ChatRoom.tsx@345: (messages) => [...messages, message]"],
  },
  {
    rule: "react/closure-reads-stale-state",
    severity: "warning",
    file: "ChatRoom.tsx",
    at: "setSize({ ...size, width: window.innerWidth })",
    message: "the listener reads a stale `size`: the value from the first render",
    hint: "pass an updater, which gets the latest value: `setSize((size) => ({ ...size, width: window.innerWidth }))` (quick fix)",
    notes: [],
    fixes: ["ChatRoom.tsx@1299: (size) => ({ ...size, width: window.innerWidth })"],
  },
  {
    rule: "react/closure-reads-stale-state",
    severity: "warning",
    file: "Counter.tsx",
    at: "setCount(count + 1)",
    message: "the interval always sets 1: `count` is the value from the first render",
    hint: "pass an updater, which gets the latest value: `setCount((count) => count + 1)` (quick fix)",
    notes: [],
    fixes: ["Counter.tsx@271: (count) => count + 1"],
  },
  {
    rule: "react/closure-reads-stale-state",
    severity: "warning",
    file: "Counter.tsx",
    at: "setSeconds(seconds - step)",
    message: "the timeout reads a stale `seconds`: the value from an earlier render",
    hint: "pass an updater, which gets the latest value: `setSeconds((seconds) => seconds - step)` (quick fix)",
    notes: [],
    fixes: ["Counter.tsx@1184: (seconds) => seconds - step"],
  },
  {
    rule: "react/closure-reads-stale-state",
    severity: "warning",
    file: "Counter.tsx",
    at: "setPage(page + 1)",
    message: "the callback always sets 2: `page` is the value from the first render",
    hint: "pass an updater, which gets the latest value: `setPage((page) => page + 1)` (quick fix)",
    notes: [],
    fixes: ["Counter.tsx@1393: (page) => page + 1"],
  },
];

const staleUnknown: Shown[] = [
  {
    rule: "react/closure-reads-stale-state",
    severity: "unknown",
    file: "Counter.tsx",
    at: "setTicks(ticks + 1)",
    message:
      "not checked: whether `ticks` is a value from an old render: the call has no dependency array to read",
    hint: "write the dependency array in the call (`[ticks]`), so it can be checked",
    notes: [],
    fixes: [],
  },
];

const indexKeys: Shown[] = [
  {
    rule: "react/index-key-on-reordered-list",
    severity: "warning",
    file: "TodoList.tsx",
    at: "index",
    message:
      "list keyed by index, but `todos` is filtered: a row's state can move to the wrong item",
    hint: "key each row by something the item owns, such as `key={todo.id}`, so its state stays with it",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/index-key-on-reordered-list",
    severity: "warning",
    file: "TodoList.tsx",
    at: "`todo-${i}`",
    message:
      "list keyed by index, but `todos` is filtered: a row's state can move to the wrong item",
    hint: "key each row by something the item owns, such as `key={todo.id}`, so its state stays with it",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/index-key-on-reordered-list",
    severity: "warning",
    file: "TodoList.tsx",
    at: "i",
    message: "list keyed by index, but `todos` is sorted: a row's state can move to the wrong item",
    hint: "key each row by something the item owns, such as `key={todo.id}`, so its state stays with it",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/index-key-on-reordered-list",
    severity: "warning",
    file: "TodoList.tsx",
    at: "String(index)",
    message:
      "list keyed by index, but `posts` is prepended to: a row's state can move to the wrong item",
    hint: "key each row by something the item owns, such as `key={post.id}`, so its state stays with it",
    notes: [],
    fixes: [],
  },
];

const compiled: Shown[] = [
  {
    rule: "react/closure-reads-stale-state",
    severity: "warning",
    file: "Counter.tsx",
    at: "setCount(count + 1)",
    message: "the interval always sets 1: `count` is the value from the first render",
    hint: "pass an updater, which gets the latest value: `setCount((count) => count + 1)` (quick fix)",
    notes: [],
    fixes: ["Counter.tsx@177: (count) => count + 1"],
  },
  {
    rule: "react/index-key-on-reordered-list",
    severity: "warning",
    file: "TodoList.tsx",
    at: "index",
    message:
      "list keyed by index, but `todos` is filtered: a row's state can move to the wrong item",
    hint: "key each row by something the item owns, such as `key={todo.id}`, so its state stays with it",
    notes: [],
    fixes: [],
  },
];

describe("react/closure-reads-stale-state: a counter, a countdown, a pager, a chat room", () => {
  it("reports a setter given an expression on its own state, inside an interval, a timeout, a listener or a callback that keeps an old render", () => {
    expect(
      ofRule("closure-reads-stale-state").filter((finding) => finding.severity !== "unknown"),
    ).toEqual(stale);
  });
  it("says nothing of an updater, an effect that restarts with the state, an effect that runs once, or a handler written in JSX", () => {
    const at = ofRule("closure-reads-stale-state").map((finding) => finding.at);
    expect(at).not.toContain("setCount((count) => count + 1)");
    expect(at).not.toContain("setMessages((messages) => [...messages, message])");
    expect(at).toHaveLength(stale.length + staleUnknown.length);
  });
  it("is not checked (info) when the dependency array is not written in the call", () => {
    expect(
      ofRule("closure-reads-stale-state").filter((finding) => finding.severity === "unknown"),
    ).toEqual(staleUnknown);
  });
  it("offers an updater as a quick fix that is left to the editor, never applied by --fix", () => {
    const { findings: raw } = checkFixture(STATE_UPDATES, [plugin], {}, []);
    const fixes = raw.flatMap((finding) =>
      finding.kind === "problem" && finding.ruleId === "react/closure-reads-stale-state"
        ? finding.fixes
        : [],
    );
    expect(fixes).toHaveLength(stale.length);
    expect(fixes.map((fix) => fix.safe)).toEqual(stale.map(() => undefined));
    expect(fixes.map((fix) => fix.title)).toContain("Pass an updater: setCount((count) => …)");
  });
  it("stays on with the React Compiler, which does not change which render a timer holds", () => {
    expect(
      findings(COMPILED).filter((finding) => finding.rule.endsWith("closure-reads-stale-state")),
    ).toEqual(compiled.filter((finding) => finding.rule.endsWith("closure-reads-stale-state")));
  });
});

describe("react/index-key-on-reordered-list: a todo list, a feed, a log", () => {
  it("reports key={index} on a list that is filtered, sorted or added to at the front", () => {
    expect(ofRule("index-key-on-reordered-list")).toEqual(indexKeys);
  });
  it("says nothing of an id key, a list that is only appended to, or a fixed list", () => {
    const names = ofRule("index-key-on-reordered-list").map((finding) => finding.hint);
    expect(names).toHaveLength(4);
    expect(ofRule("index-key-on-reordered-list").map((finding) => finding.at)).not.toContain(
      "todo.id",
    );
  });
  it("stays on with the React Compiler", () => {
    expect(ofRule("index-key-on-reordered-list", COMPILED)).toEqual(
      compiled.filter((finding) => finding.rule.endsWith("index-key-on-reordered-list")),
    );
  });
});

describe("react: state-updates findings", () => {
  it("are the same, in the same order, on a second run", () => {
    const first = checkFixture(STATE_UPDATES, [react()], {}, []).findings;
    const second = checkFixture(STATE_UPDATES, [react()], {}, []).findings;
    expect(second).toEqual(first);
  });
});
