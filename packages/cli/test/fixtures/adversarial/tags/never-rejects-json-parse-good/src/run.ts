import { post, report } from "./api.js";

/** Shows its own errors. @neverRejects */
export async function run(text: string): Promise<void> {
  try {
    JSON.parse(text);
    await post();
  } catch (error) {
    report(error);
  }
}
