import { post, report } from "./lib.js";

/** Shows its own errors. @neverRejects */
export async function viaCall(): Promise<void> {
  try {
    await post.call(null);
  } catch (error) {
    report(error);
  }
}

/** Shows its own errors. @neverRejects */
export async function viaAlias(): Promise<void> {
  const send = post;
  try {
    await send();
  } catch (error) {
    report(error);
  }
}

export class Saver {
  /** Shows its own errors. @neverRejects */
  async run(): Promise<void> {
    try {
      await post();
    } catch (error) {
      report(error);
    }
  }
}
