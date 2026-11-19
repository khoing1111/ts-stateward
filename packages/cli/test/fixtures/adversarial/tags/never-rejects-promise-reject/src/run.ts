/** Shows its own errors. @neverRejects */
export async function run(): Promise<void> {
  return Promise.reject(new Error("failed"));
}
