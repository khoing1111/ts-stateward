import { NotFoundError } from "./errors.js";

export async function load(id: string): Promise<string> {
  const response = await fetch(`/users/${id}`);
  if (!response.ok) throw new NotFoundError(id);
  return response.text();
}

export async function loadSafe(id: string): Promise<string> {
  try {
    return await load(id);
  } catch {
    return "";
  }
}

export async function loadUnawaited(id: string): Promise<string> {
  try {
    return load(id);
  } catch {
    return "";
  }
}

export function floating(id: string): void {
  void load(id);
}

export async function withThen(id: string): Promise<unknown> {
  return load(id).then((text) => JSON.parse(text));
}

export async function withCatch(id: string): Promise<string> {
  return load(id).catch(() => "");
}

export async function loadAll(ids: readonly string[]): Promise<string[]> {
  return Promise.all(ids.map((id) => load(id)));
}

export async function held(id: string): Promise<string> {
  const pending = load(id);
  return await pending;
}

export function abortable(signal: AbortSignal): Promise<Response> {
  return fetch("/slow", { signal });
}
