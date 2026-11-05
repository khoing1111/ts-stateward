// A stub of neverthrow's types (not installed): `Ok | Err`, told apart by `isOk()` and `isErr()`.
declare module "neverthrow" {
  export class Ok<T, E> {
    readonly value: T;
    isOk(): this is Ok<T, E>;
    isErr(): this is Err<T, E>;
  }
  export class Err<T, E> {
    readonly error: E;
    isOk(): this is Ok<T, E>;
    isErr(): this is Err<T, E>;
  }
  export type Result<T, E> = Ok<T, E> | Err<T, E>;
}
