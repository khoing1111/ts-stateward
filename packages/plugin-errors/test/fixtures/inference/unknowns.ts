import { remote } from "fake-lib";

type Api = { getUser(id: string): Promise<string> };

export async function user(api: Api): Promise<string> {
  return api.getUser("1");
}

export function dynamic(fns: readonly (() => void)[]): void {
  fns[0]?.();
}

export function fromPackage(): string {
  return remote();
}

export function many(
  a: () => void,
  b: () => void,
  c: () => void,
  d: () => void,
  e: () => void,
  f: () => void,
): void {
  a();
  b();
  c();
  d();
  e();
  f();
}
