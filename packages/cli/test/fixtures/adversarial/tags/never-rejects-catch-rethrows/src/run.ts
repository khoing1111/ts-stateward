import { post } from "./api.js";

/** Shows its own errors. @neverRejects */
export async function run(): Promise<void> {
  try {
    await post();
  } catch (error) {
    throw error;
  }
}
