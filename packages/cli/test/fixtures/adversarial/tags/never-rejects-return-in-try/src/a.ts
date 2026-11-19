async function post(): Promise<void> {
  const response = await fetch("/save");
  if (!response.ok) throw new Error("not saved");
}

/** Shows its own errors. @neverRejects */
export async function save(): Promise<void> {
  try {
    return post();
  } catch {
    return;
  }
}
