import { post } from "./api.js";

/** Shows its own errors. @neverRejects */
export async function run(text: string): Promise<void> {
  if (text === "") throw new Error("empty");
  await post();
}
