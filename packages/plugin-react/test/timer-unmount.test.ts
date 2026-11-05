import { describe, expect, it } from "vitest";
import { react } from "../src/index.js";
import { check, fixture, shown, type Shown } from "./helpers.js";

const TIMERS = fixture("timers");
const RULE = "react/timer-runs-after-unmount";

const all = shown(TIMERS, check(TIMERS, {}, [react()]));
const ofRule = (rule: string): Shown[] => all.filter((finding) => finding.rule === rule);

const quickFix = (hook: string, clear: string, ref: string): string =>
  `add an effect that clears it on unmount: \`${hook}(() => () => ${clear}(${ref}.current), [])\` (quick fix)`;

describe("react/timer-runs-after-unmount", () => {
  it("names the lasting action of a timer kept in a ref that no unmount cleanup clears", () => {
    expect(ofRule(RULE).filter((finding) => finding.severity === "warning")).toEqual([
      {
        rule: RULE,
        severity: "warning",
        file: "Frame.tsx",
        at: "requestAnimationFrame(function step() {\n      setX(to);\n      last.current = to;\n    })",
        message: "`frame` can still write `last.current` after `Follower` unmounts",
        hint: quickFix("useEffect", "cancelAnimationFrame", "frame"),
        notes: [],
        fixes: [
          "Frame.tsx@25: , useEffect | Frame.tsx@243: \n  useEffect(() => () => cancelAnimationFrame(frame.current), []);",
        ],
      },
      {
        rule: RULE,
        severity: "warning",
        file: "HoverChip.tsx",
        at: "window.setTimeout(() => {\n      setOpen(false);\n      onClose();\n    }, 150)",
        message: "`closeTimer` can still run `onClose(…)` after `HoverChip` unmounts",
        hint: quickFix("useEffect", "clearTimeout", "closeTimer"),
        notes: [],
        fixes: [
          "HoverChip.tsx@25: , useEffect | HoverChip.tsx@328: \n  useEffect(() => () => clearTimeout(closeTimer.current), []);",
        ],
      },
      {
        rule: RULE,
        severity: "warning",
        file: "Interval.tsx",
        at: 'window.setInterval(() => {\n      setTicks((current) => current + 1);\n      store.dispatch({ type: "tick" });\n    }, 1000)',
        message: "`ticker` can still run `store.dispatch(…)` after `Ticker` unmounts",
        hint: quickFix("useEffect", "clearInterval", "ticker"),
        notes: [],
        fixes: ["Interval.tsx@299: \n  useEffect(() => () => clearInterval(ticker.current), []);"],
      },
      {
        rule: RULE,
        severity: "warning",
        file: "Popover.tsx",
        at: "setTimeout(hide, 300)",
        message: "`hideTimer` can still run `layer.release(…)` after `Popover` unmounts",
        hint: quickFix("React.useEffect", "clearTimeout", "hideTimer"),
        notes: [],
        fixes: [
          "Popover.tsx@427: \n  React.useEffect(() => () => clearTimeout(hideTimer.current), []);",
        ],
      },
      {
        rule: RULE,
        severity: "warning",
        file: "RailMenu.tsx",
        at: "window.setTimeout(() => navigate(to), 200)",
        message: "`goTimer` can still run `navigate(…)` after `RailMenu` unmounts",
        hint: quickFix("useEffect", "clearTimeout", "goTimer"),
        notes: [],
        fixes: [
          "RailMenu.tsx@25: , useEffect | RailMenu.tsx@295: \n  useEffect(() => () => clearTimeout(goTimer.current), []);",
        ],
      },
    ]);
  });

  it("says it cannot tell when a cleanup hands the ref to a function it cannot see", () => {
    expect(ofRule(RULE).filter((finding) => finding.severity === "unknown")).toEqual([
      {
        rule: RULE,
        severity: "unknown",
        file: "Cleared.tsx",
        at: "window.setTimeout(onClose, 150)",
        message:
          "stateward cannot tell whether `closeTimer` is cleared when the component unmounts",
        hint: "clear it in an effect cleanup written in the component (`clearTimeout(ref.current)`) to make it checkable",
        notes: [],
        fixes: [],
      },
    ]);
  });

  it("stays silent for state-only timers, cleared timers, and a console log", () => {
    const at = ofRule(RULE).map((finding) => finding.at);
    expect(at.some((text) => text.includes("console.log"))).toBe(false);
    expect(at).not.toContain("window.setTimeout(() => setOpen(false), 150)");
    expect(ofRule(RULE).filter((finding) => finding.file === "Cleared.tsx")).toHaveLength(1);
    expect(ofRule(RULE).filter((finding) => finding.file === "RailMenu.tsx")).toHaveLength(1);
    expect(ofRule(RULE).filter((finding) => finding.file === "HoverChip.tsx")).toHaveLength(1);
  });

  it("leaves a timer that an effect starts to react/effect-missing-cleanup: one cause, one message", () => {
    expect(ofRule("react/effect-missing-cleanup")).toEqual([
      {
        rule: "react/effect-missing-cleanup",
        severity: "warning",
        file: "Cleared.tsx",
        at: "window.setTimeout(() => {\n      setValue(query);\n      onSearch(query);\n    }, 300)",
        message:
          "the timeout in `debounce.current` is cleared before each new one, but not on unmount",
        hint: "clear it on unmount, in an effect of its own:\n    useEffect(() => () => clearTimeout(debounce.current), []);",
        notes: [],
        fixes: [],
      },
    ]);
  });
});
