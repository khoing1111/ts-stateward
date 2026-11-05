// None of these is a Result: no union told apart by `ok` or `success`, no `isOk()` and `isErr()`.
declare function nothing(): void;
declare function later(): Promise<void>;
declare function maybe(): number | undefined;
declare function anything(): unknown;
declare function respond(): Promise<{ readonly ok: boolean; readonly status: number }>;
declare function tagged(): { kind: "a" } | { kind: "b" };
declare const optional: { run(): number } | undefined;

export async function lookalikes(): Promise<void> {
  nothing();
  await later();
  maybe();
  anything();
  await respond();
  tagged();
  optional?.run();
  await Promise.all([later(), later()]);
}
