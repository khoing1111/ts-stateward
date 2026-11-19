import { post } from "./lib.js";

/** Shows its own errors. @neverRejects */
export async function load(): Promise<void> {
  await import("./lib.js");
}

/** Shows its own errors. @neverRejects */
export async function drain(): Promise<void> {
  for await (const done of [post()]) void done;
}
