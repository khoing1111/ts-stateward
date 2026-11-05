// A Result of another shape: only the `resultTypes` option makes it one.
export type Either<E, A> =
  | { readonly _tag: "Left"; readonly left: E }
  | { readonly _tag: "Right"; readonly right: A };

declare function sendMail(to: string): Either<Error, string>;

export function dropped(): void {
  sendMail("ada@example.com");
}
