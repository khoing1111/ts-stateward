import { post, report } from "./lib.js";

/** Shows its own errors. @neverRejects */
export async function load(): Promise<void> {
  try {
    await import("./lib.js");
  } catch (error) {
    report(error);
  }
}

/** Shows its own errors. @neverRejects */
export async function drain(): Promise<void> {
  try {
    for await (const done of [post()]) void done;
  } catch (error) {
    report(error);
  }
}
