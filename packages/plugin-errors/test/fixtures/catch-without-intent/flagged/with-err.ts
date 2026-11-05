import { err as fail } from "./result.js";

declare function load(): Promise<string>;
declare function render(text: string | undefined): void;

export async function usesTheProjectsErr(): Promise<unknown> {
  try {
    await load();
  } catch (e) {
    console.error(e);
  }
  render(undefined);
  return fail;
}
