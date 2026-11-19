/** Shows its own errors. @neverRejects */
export async function wait(): Promise<void> {
  await new Promise<void>((_, reject) => reject(new Error("late")));
}

/** Shows its own errors. @neverRejects */
export async function parse(text: string): Promise<void> {
  await new Promise<void>((resolve) => {
    JSON.parse(text);
    resolve();
  });
}
