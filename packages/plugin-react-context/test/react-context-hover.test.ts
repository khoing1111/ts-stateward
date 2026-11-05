import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import { reactContext } from "../src/index.js";

const dir = fileURLToPath(new URL("./fixtures/hover", import.meta.url));

class HoverTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoverTestError";
  }
}

function checkerFor(addons: readonly string[] = []) {
  const parsed = parseConfig({ preset: "recommended", plugins: [reactContext()], addons }, dir);
  if (!parsed.ok) throw new HoverTestError(parsed.errors.join("\n"));
  return createChecker({ config: parsed.value, cwd: dir });
}

/** The hover at the first `needle` in `file`, with the cursor `into` characters after its start. */
function hoverAt(
  checker: ReturnType<typeof checkerFor>,
  file: string,
  needle: string,
  into = 1,
): readonly string[] {
  const absolute = path.join(dir, "src", file);
  const at = readFileSync(absolute, "utf8").indexOf(needle);
  if (at < 0) throw new HoverTestError(`${needle} is not in ${file}`);
  return checker.hover(absolute, at + into);
}

describe("react-context hover: needs / provides", () => {
  const checker = checkerFor();
  checker.check();

  it("says what a component reads", () => {
    expect(hoverAt(checker, "Avatar.tsx", "Avatar()")).toEqual([
      "**<Avatar>** needs `ThemeCtx` (read here)",
    ]);
  });

  it("says what a component needs through a child, on the declaration and on a tag", () => {
    const expected = ["**<Profile>** needs `AuthCtx` (read here), `ThemeCtx` (via `<Avatar>`)"];
    expect(hoverAt(checker, "Profile.tsx", "Profile()")).toEqual(expected);
    expect(hoverAt(checker, "main.tsx", "<Profile />", 2)).toEqual(expected);
  });

  it("says what a component needs through a hook", () => {
    expect(hoverAt(checker, "Menu.tsx", "Menu()")).toEqual([
      "**<Menu>** needs `ThemeCtx` (via `useTheme()`)",
    ]);
  });

  it("says what a component provides to its children", () => {
    expect(hoverAt(checker, "Shell.tsx", "Shell(")).toEqual([
      "**<Shell>** provides `ThemeCtx` to its children",
    ]);
  });

  it("says both, on two lines, for a component that reads and provides", () => {
    expect(hoverAt(checker, "Gate.tsx", "Gate(")).toEqual([
      "**<Gate>** needs `AuthCtx` (read here)\n\nprovides `ThemeCtx` to its children",
    ]);
  });

  it("says nothing for a component that needs and provides nothing, or for what is no component", () => {
    expect(hoverAt(checker, "Plain.tsx", "Plain()")).toEqual([]);
    expect(hoverAt(checker, "main.tsx", "<Plain />", 2)).toEqual([]);
    expect(hoverAt(checker, "main.tsx", "document")).toEqual([]);
    expect(hoverAt(checker, "main.tsx", "createRoot(")).toEqual([]);
  });

  it("says nothing before a full check has run", () => {
    expect(hoverAt(checkerFor(), "Profile.tsx", "Profile()")).toEqual([]);
  });
});
