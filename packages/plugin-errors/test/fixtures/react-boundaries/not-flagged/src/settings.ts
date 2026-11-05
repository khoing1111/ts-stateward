import { ParseError } from "./errors";

export type Settings = { theme: string };

export function readSettings(text: string): Settings {
  try {
    return JSON.parse(text);
  } catch {
    throw new ParseError("the saved settings are not valid JSON");
  }
}
