import { post } from "./api.js";

/** Shows its own errors. @neverRejects */
export async function run(text: string): Promise<void> {
  JSON.parse(text);
  await post();
}
