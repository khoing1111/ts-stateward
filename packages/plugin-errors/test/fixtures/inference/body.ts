import { NotFoundError } from "./errors.js";

/** `Response.json()` rejects with a SyntaxError for a body that is not JSON. */
export async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (response.status === 404) throw new NotFoundError(url);
  return response.json();
}

/** Reading a body can fail with a TypeError: the body was read already, or the connection broke. */
export async function getBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  return response.blob();
}
