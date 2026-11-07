// A request whose package types did not resolve (Infisical without its packages, user trial
// 1.0.2): the message names the awaited call, not a call written in its arguments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const createSession: any;
declare function showError(error: unknown): void;

export async function submit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: { customTtl: any },
  onCreated: (session: unknown) => void,
): Promise<void> {
  try {
    const session: unknown = await createSession.mutateAsync({ ttl: form.customTtl.trim() });
    onCreated(session);
  } catch (e) {
    showError(e);
  }
}
