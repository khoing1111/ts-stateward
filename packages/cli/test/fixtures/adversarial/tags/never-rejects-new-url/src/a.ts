/** Shows its own errors. @neverRejects */
export async function pathOf(text: string): Promise<string> {
  const url = new URL(text);
  return url.pathname;
}
