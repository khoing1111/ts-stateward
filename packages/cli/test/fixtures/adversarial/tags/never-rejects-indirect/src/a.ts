import { post } from "./lib.js";

/** Shows its own errors. @neverRejects */
export async function viaCall(): Promise<void> {
  await post.call(null);
}

/** Shows its own errors. @neverRejects */
export async function viaAlias(): Promise<void> {
  const send = post;
  await send();
}

export class Saver {
  /** Shows its own errors. @neverRejects */
  async run(): Promise<void> {
    await post();
  }
}
