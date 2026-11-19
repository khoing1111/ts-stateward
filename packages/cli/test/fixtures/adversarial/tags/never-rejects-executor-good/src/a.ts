/** Shows its own errors. @neverRejects */
export async function wait(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
}

/** Shows its own errors. @neverRejects */
export async function parse(text: string): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      JSON.parse(text);
    } catch (error) {
      console.error(error);
    }
    resolve();
  });
}
