import { createInterface } from "node:readline/promises";
import { DEFAULT_PRESET, PRESETS } from "@stateward/core/internal";
import type { Preset } from "@stateward/core/internal";
import { PACK_NAMES, packDescription } from "./init.js";
import type { PackName } from "./init.js";

/** The streams `init` talks through; real ones are stdin and stdout, tests pass fakes. */
export type Terminal = { input: NodeJS.ReadableStream; output: NodeJS.WritableStream };

/** Shows `text` (which may span lines), then `prompt` on the last line, and returns the answer. */
export type Ask = (text: string, prompt: string) => Promise<string>;

/** What the developer chose. `rollout` is undefined when the question was not asked. */
export type InitChoices = {
  packs: readonly PackName[];
  preset: Preset;
  rollout: boolean | undefined;
  /** Whether to add the React Router add-on to the config. */
  reactRouter: boolean;
};

export type InitContext = {
  /** The packs detected from package.json: ticked at first. */
  detected: readonly PackName[];
  /** Set by `--packs` / `--preset`: that question is skipped. */
  packs: readonly PackName[] | undefined;
  preset: Preset | undefined;
  /** Whether the project already has code, which is when "one rule at a time" is worth asking. */
  hasCode: boolean;
  /** Whether package.json lists React Router. */
  usesReactRouter: boolean;
};

/** What each preset means, in the question `init` asks. */
const PRESET_LINES: Readonly<Record<Preset, string>> = {
  recommended: "what breaks is an error, what only helps is a hint (default)",
  strict: "every rule an error",
};

const PACK_NAME_WIDTH = Math.max(...PACK_NAMES.map((name) => name.length));

const PRESET_NUMBERS = PRESETS.map((_, index) => String(index + 1));

/** What the preset question accepts, as its error says: `1, 2, recommended or strict`. */
const PRESET_ANSWERS = ((answers: readonly string[]) =>
  `${answers.slice(0, -1).join(", ")} or ${answers.slice(-1).join("")}`)([
  ...PRESET_NUMBERS,
  ...PRESETS,
]);

/** The preset names are padded to the longest, so the descriptions line up. */
const PRESET_NAME_WIDTH = Math.max(...PRESETS.map((name) => name.length));

function renderPacks(selected: readonly PackName[]): string {
  const lines = PACK_NAMES.map(
    (name, index) =>
      `  ${String(index + 1)}. [${selected.includes(name) ? "x" : " "}] ${name.padEnd(PACK_NAME_WIDTH)}  ${packDescription(name)}`,
  );
  return ["Which packs do you want?", ...lines].join("\n");
}

/** Toggles the packs numbered in `answer`; a message when it is not numbers in range. */
function togglePacks(
  selected: readonly PackName[],
  answer: string,
): { ok: true; packs: readonly PackName[] } | { ok: false; message: string } {
  let packs = selected;
  for (const token of answer.split(/[\s,]+/).filter((part) => part !== "")) {
    const name = /^[1-9]\d*$/.test(token) ? PACK_NAMES[Number(token) - 1] : undefined;
    if (name === undefined) {
      return {
        ok: false,
        message: `"${token}" is not a pack number; type numbers from 1 to ${String(PACK_NAMES.length)}, or press Enter.`,
      };
    }
    const current = packs;
    packs = current.includes(name)
      ? current.filter((existing) => existing !== name)
      : [...current, name];
  }
  if (packs.length === 0) return { ok: false, message: "Pick at least one pack." };
  return { ok: true, packs: PACK_NAMES.filter((name) => packs.includes(name)) };
}

async function askPacks(ask: Ask, detected: readonly PackName[]): Promise<readonly PackName[]> {
  let message = "";
  for (;;) {
    const answer = await ask(
      `${message}${renderPacks(detected)}`,
      "Type numbers to toggle (for example 2 4), or press Enter to accept: ",
    );
    const toggled = togglePacks(detected, answer);
    if (toggled.ok) return toggled.packs;
    message = `${toggled.message}\n\n`;
  }
}

async function askPreset(ask: Ask): Promise<Preset> {
  const lines = PRESETS.map(
    (name, index) =>
      `  ${String(index + 1)}. ${name.padEnd(PRESET_NAME_WIDTH)}  ${PRESET_LINES[name]}`,
  );
  let message = "";
  for (;;) {
    const answer = (
      await ask(
        `${message}Which preset?\n${lines.join("\n")}`,
        `Choose ${PRESET_NUMBERS.join(" or ")}, or press Enter for ${DEFAULT_PRESET}: `,
      )
    )
      .trim()
      .toLowerCase();
    if (answer === "") return DEFAULT_PRESET;
    const chosen = PRESETS.find((name, index) => answer === name || answer === String(index + 1));
    if (chosen !== undefined) return chosen;
    message = `"${answer}" is not a preset; type ${PRESET_ANSWERS}.\n\n`;
  }
}

async function askYesNo(ask: Ask, text: string, prompt: string): Promise<boolean> {
  let message = "";
  for (;;) {
    const answer = (await ask(`${message}${text}`, prompt)).trim().toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    message = `"${answer}" is not yes or no; type y or n, or press Enter.\n`;
  }
}

/**
 * The questions of `init`, each with the recommended answer as its default (Enter accepts) and
 * each asked once. A question whose answer is already known (`--packs`, `--preset`) or beside the
 * point for this project (no code yet, no React Router) is not asked.
 */
export async function askInit(ask: Ask, context: InitContext): Promise<InitChoices> {
  const packs = context.packs ?? (await askPacks(ask, context.detected));
  const preset = context.preset ?? (await askPreset(ask));
  const rollout = context.hasCode
    ? await askYesNo(
        ask,
        "This project already has code. Meeting every rule at once can bury you in findings.",
        "Turn rules on one at a time? (recommended for existing code) [Y/n] ",
      )
    : undefined;
  const reactRouter =
    context.usesReactRouter && packs.includes("react-context")
      ? await askYesNo(
          ask,
          "React Router found. The react-router add-on follows your routes to see which providers a page has.",
          "Add it? [Y/n] ",
        )
      : false;
  return { packs, preset, rollout, reactRouter };
}

/** The `--yes` asker: every question gets its default, and nothing is shown. */
export const acceptDefaults: Ask = () => Promise.resolve("");

/**
 * An asker over a terminal. Lines are queued as they arrive, so answers typed ahead (or piped)
 * are not lost; when the input ends, every later question gets its default, so `init` never hangs.
 */
export function openTerminal(terminal: Terminal): { ask: Ask; close: () => void } {
  const readline = createInterface({ input: terminal.input, output: terminal.output });
  const queued: string[] = [];
  let waiting: ((line: string) => void) | undefined;
  let ended = false;
  readline.on("line", (line) => {
    if (waiting === undefined) {
      queued.push(line);
      return;
    }
    const resolve = waiting;
    waiting = undefined;
    resolve(line);
  });
  readline.on("close", () => {
    ended = true;
    waiting?.("");
    waiting = undefined;
  });
  const ask: Ask = (text, prompt) => {
    terminal.output.write(`\n${text}\n`);
    if (ended) {
      // A closed interface is not used again (newer Node versions refuse): show the prompt by hand.
      terminal.output.write(`${prompt}\n`);
      return Promise.resolve(queued.shift() ?? "");
    }
    readline.setPrompt(prompt);
    readline.prompt();
    const next = queued.shift();
    if (next !== undefined) return Promise.resolve(next);
    return new Promise((resolve) => {
      waiting = resolve;
    });
  };
  return {
    ask,
    close: () => {
      readline.close();
    },
  };
}
