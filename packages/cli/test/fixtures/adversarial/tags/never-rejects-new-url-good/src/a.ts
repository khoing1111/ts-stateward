/** Shows its own errors. @neverRejects */
export async function pathOf(text: string): Promise<string> {
  try {
    const url = new URL(text);
    return url.pathname;
  } catch {
    return "/";
  }
}
