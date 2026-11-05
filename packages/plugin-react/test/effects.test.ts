import { describe, expect, it } from "vitest";
import { checkFixture } from "@stateward/core/testing";
import { react } from "../src/index.js";
import { check, fixture, shown, type Shown } from "./helpers.js";

const EFFECTS = fixture("effects");
/** Depends on @tanstack/react-query and on the React Compiler. */
const QUERY = fixture("effects-query");
const RACE = ["react/effect-race"];

const plugin = react();
const findings = (dir: string, addons: readonly string[] = RACE): Shown[] =>
  shown(dir, check(dir, {}, [plugin], addons));
const ofRule = (rule: string, dir: string = EFFECTS): Shown[] =>
  findings(dir).filter((finding) => finding.rule === `react/${rule}`);

const expected: Shown[] = [
  {
    rule: "react/effect-missing-cleanup",
    severity: "warning",
    file: "ChatRoom.tsx",
    at: "chat.subscribe(room, (message) => setMessages((current) => [...current, message]))",
    message: "`chat.subscribe(…)` returns an unsubscribe function that this effect never calls",
    hint: "return it as the cleanup: `return chat.subscribe(…);`",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-missing-cleanup",
    severity: "warning",
    file: "ChatRoom.tsx",
    at: "presence.subscribe(setOnline)",
    message: "`presence.subscribe(…)` returns a subscription that this effect never ends",
    hint: "end it in the cleanup: `return () => subscription.unsubscribe();`",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-missing-cleanup",
    severity: "warning",
    file: "ChatRoom.tsx",
    at: "new WebSocket(url)",
    message: "this effect opens a `WebSocket` and never closes it",
    hint: "close it in the cleanup: `return () => socket.close();`",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-copies-derived-value",
    severity: "warning",
    file: "ProfilePage.tsx",
    at: "setFullName(`${first} ${last}`)",
    message:
      "`fullName` is copied from `first` and `last` in an effect: an extra render with a stale value first",
    hint: "compute it while rendering, and remove the state and the effect:\n    const fullName = `${first} ${last}`;",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/state-copies-prop",
    severity: "warning",
    file: "ProfilePage.tsx",
    at: "setDraft(props.name)",
    message:
      "an effect overwrites the draft `draft` with `props.name` whenever it changes, losing edits",
    hint: "drop the effect and render `<NameEditor key={…}>` so the draft starts over when `name` changes",
    notes: ["ProfilePage.tsx: useState(props.name): `draft` starts as `props.name` here"],
    fixes: [],
  },
  {
    rule: "react/effect-response-race",
    severity: "warning",
    file: "ProfilePage.tsx",
    at: "setUser(loaded)",
    message: "a slow response for an old `userId` can overwrite a newer one",
    hint: "ignore a response that arrives after the effect is cleaned up:\n    let ignore = false;\n    … if (!ignore) setUser(…);\n    return () => { ignore = true; };",
    notes: ["ProfilePage.tsx: fetchUser(userId): the request that can answer late"],
    fixes: [],
  },
  {
    rule: "react/effect-copies-derived-value",
    severity: "warning",
    file: "SearchBox.tsx",
    at: "setVisible(filterUsers(users, query))",
    message:
      "`visible` is copied from `users` and `query` in an effect: an extra render with a stale value first",
    hint: "compute it while rendering (in `useMemo` if `filterUsers` is slow), and remove the state and the effect:\n    const visible = filterUsers(users, query);",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-loops",
    severity: "error",
    file: "SearchBox.tsx",
    at: "setFilters({ ...filters, page: 1 })",
    message:
      "this effect sets `filters`, one of its own dependencies, to a new value each time: a render loop",
    hint: "set it only when it must change (`if (…) setFilters(…)`), or make the change in the event that causes it",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-copies-derived-value",
    severity: "warning",
    file: "SearchBox.tsx",
    at: "setLabel(query)",
    message:
      "`label` is copied from `query` in an effect: an extra render with a stale value first",
    hint: "compute it while rendering, and remove the state and the effect:\n    const label = query;",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-response-race",
    severity: "warning",
    file: "SearchBox.tsx",
    at: "setResults(found)",
    message: "a slow response for an old `query` can overwrite a newer one",
    hint: "ignore a response that arrives after the effect is cleaned up:\n    let ignore = false;\n    … if (!ignore) setResults(…);\n    return () => { ignore = true; };",
    notes: ["SearchBox.tsx: searchUsers(query): the request that can answer late"],
    fixes: [],
  },
  {
    rule: "react/effect-missing-cleanup",
    severity: "warning",
    file: "Timer.tsx",
    at: "setInterval(() => setSeconds((current) => current + 1), 1000)",
    message: "this effect starts an interval and never clears it: it keeps running after unmount",
    hint: "keep its id and clear it in the cleanup: `const id = setInterval(…); return () => clearInterval(id);`",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-missing-cleanup",
    severity: "warning",
    file: "Timer.tsx",
    at: "setTimeout(() => setVisible(false), 3000)",
    message: "this effect starts a timeout that sets `visible` and never clears it",
    hint: "keep its id and clear it in the cleanup: `const id = setTimeout(…); return () => clearTimeout(id);`",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-loops",
    severity: "error",
    file: "Timer.tsx",
    at: "setCount(count + 1)",
    message:
      "this effect sets `count`, one of its own dependencies, to a new value each time: a render loop",
    hint: "set it only when it must change (`if (…) setCount(…)`), or make the change in the event that causes it",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-loops",
    severity: "error",
    file: "Timer.tsx",
    at: "setRenders((current) => current + 1)",
    message:
      "this effect runs after every render and sets `renders` to a new value each time: a render loop",
    hint: "set it only when it must change (`if (…) setRenders(…)`), or make the change in the event that causes it",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-missing-cleanup",
    severity: "warning",
    file: "WindowSize.tsx",
    at: 'window.addEventListener("resize", () => setWidth(window.innerWidth))',
    message: "the `resize` listener on `window` is an inline function, so no cleanup can remove it",
    hint: 'keep the handler in a variable (`const onResize = …`), then `return () => window.removeEventListener("resize", onResize)`',
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-missing-cleanup",
    severity: "warning",
    file: "WindowSize.tsx",
    at: 'window.addEventListener("resize", onResize)',
    message: "this effect adds a `resize` listener to `window` and never removes it",
    hint: 'remove it in the cleanup: `return () => window.removeEventListener("resize", onResize)`',
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-missing-cleanup",
    severity: "warning",
    file: "WindowSize.tsx",
    at: "new ResizeObserver(([entry]) => setSize(entry?.contentRect.width ?? 0))",
    message: "this effect creates a `ResizeObserver` and never disconnects it",
    hint: "disconnect it in the cleanup: `return () => observer.disconnect();`",
    notes: [],
    fixes: [],
  },
];

const notChecked: Shown[] = [
  {
    rule: "react/effect-missing-cleanup",
    severity: "unknown",
    file: "Timer.tsx",
    at: "setInterval(() => setNow(Date.now()), 1000)",
    message: "stateward cannot tell whether this effect's cleanup stops the interval",
    hint: "undo it in the returned function itself (`removeEventListener`, `clearInterval`, `disconnect`, …) to make it checkable",
    notes: [],
    fixes: [],
  },
];

const compiled: Shown[] = [
  {
    rule: "react/effect-copies-derived-value",
    severity: "warning",
    file: "Profile.tsx",
    at: "setFullName(`${first} ${last}`)",
    message:
      "`fullName` is copied from `first` and `last` in an effect: an extra render with a stale value first",
    hint: "compute it while rendering, and remove the state and the effect:\n    const fullName = `${first} ${last}`;",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/effect-response-race",
    severity: "warning",
    file: "Profile.tsx",
    at: "setUser",
    message: "a slow response for an old `userId` can overwrite a newer one",
    hint: "load it with `useQuery` from @tanstack/react-query, which drops late responses, or ignore them:\n    let ignore = false;\n    … if (!ignore) setUser(…);\n    return () => { ignore = true; };",
    notes: ["Profile.tsx: fetchUser(userId): the request that can answer late"],
    fixes: [],
  },
];

const byRule = (rule: string): Shown[] =>
  expected.filter((finding) => finding.rule === `react/${rule}`);

describe("react/effect-copies-derived-value: a profile header and a user filter", () => {
  it("reports an effect that only copies a value computed from props and state, with the line to write", () => {
    expect(ofRule("effect-copies-derived-value")).toEqual(byRule("effect-copies-derived-value"));
  });
  it("says nothing of a state also set by an event, or a value already computed while rendering", () => {
    expect(ofRule("effect-copies-derived-value").map((finding) => finding.at)).toEqual([
      "setFullName(`${first} ${last}`)",
      "setVisible(filterUsers(users, query))",
      "setLabel(query)",
    ]);
  });
});

describe("react/state-copies-prop: a name editor", () => {
  it("reports useState(prop) re-synced by an effect, once, with where it starts; a draft the user edits gets only the `key` fix", () => {
    expect(ofRule("state-copies-prop")).toEqual(byRule("state-copies-prop"));
  });
});

describe("react/effect-loops: search filters and counters", () => {
  it("reports an unconditional set to a new value of a state in the effect's dependencies, or with none listed", () => {
    expect(ofRule("effect-loops")).toEqual(byRule("effect-loops"));
  });
  it("says nothing of a guarded set, or a set to the same value", () => {
    const at = ofRule("effect-loops").map((finding) => finding.at);
    expect(at).not.toContain("setCount(count - 1)");
    expect(at).not.toContain("setLabel(query)");
  });
});

describe("react/effect-missing-cleanup: a chat subscription, window resize, timers", () => {
  it("reports what an effect starts and never stops, with the cleanup to return", () => {
    expect(
      ofRule("effect-missing-cleanup").filter((finding) => finding.severity !== "unknown"),
    ).toEqual(byRule("effect-missing-cleanup"));
  });
  it("is not checked (info) when the cleanup hands the id to a function in another module", () => {
    expect(findings(EFFECTS).filter((finding) => finding.severity === "unknown")).toEqual(
      notChecked,
    );
  });
});

describe("react/effect-response-race: a profile card and a search box", () => {
  it("reports a state set after a request with no flag or abort in the cleanup", () => {
    expect(ofRule("effect-response-race")).toEqual(byRule("effect-response-race"));
  });
  it("is off until its add-on is listed", () => {
    expect(
      findings(EFFECTS, []).filter((finding) => finding.rule === "react/effect-response-race"),
    ).toEqual([]);
  });
  it("suggests the project's data-fetching hook, and stays on with the React Compiler, like the whole group", () => {
    expect(findings(QUERY)).toEqual(compiled);
  });
});

describe("react: effects findings", () => {
  it("are the same, in the same order, on a second run", () => {
    const first = checkFixture(EFFECTS, [react()], {}, RACE).findings;
    const second = checkFixture(EFFECTS, [react()], {}, RACE).findings;
    expect(second).toEqual(first);
    expect(findings(EFFECTS)).toHaveLength(expected.length + notChecked.length);
  });
});
