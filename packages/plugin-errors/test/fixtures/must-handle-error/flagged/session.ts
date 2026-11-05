/** @mustHandle Send the user to the sign-in page and come back here afterwards. */
export type SessionExpired = { readonly kind: "session-expired"; readonly returnTo: string };
