// The seven catches a real project's run reported, by shape: each reports the error or
// tells the user, through a reporter every project means the same thing by, a store or a state.
declare const Sentry: {
  captureException(error: unknown): void;
  captureMessage(message: string): void;
};
declare const Bugsnag: { notify(error: unknown): void };
declare const datadogRum: { addError(error: unknown): void };
declare function captureException(error: unknown): void;
type Action = { type: string; payload?: unknown };
declare function dispatch(action: Action): void;
declare function addNotification(notification: { kind: string; text: string }): Action;
declare function setError(error: unknown): void;
declare function setState(state: "idle" | "loading" | "failed"): void;
declare function save(): Promise<void>;
declare function render(): void;

export async function toSentry(): Promise<void> {
  try {
    await save();
  } catch (e) {
    Sentry.captureException(e);
  }
  render();
}

export async function sentryMessage(): Promise<void> {
  try {
    await save();
  } catch {
    Sentry.captureMessage("save failed");
  }
  render();
}

export async function importedCapture(): Promise<void> {
  try {
    await save();
  } catch (e) {
    console.error(e);
    captureException(e);
  }
  render();
}

export async function toBugsnagAndDatadog(): Promise<void> {
  try {
    await save();
  } catch (e) {
    Bugsnag.notify(e);
    datadogRum.addError(e);
  }
  render();
}

export async function notifies(): Promise<void> {
  try {
    await save();
  } catch {
    dispatch(addNotification({ kind: "error", text: "Could not save" }));
  }
  render();
}

declare function serverErrorNotification(error: unknown): Action;

export async function notifiesEitherWay(refusal: boolean): Promise<void> {
  try {
    await save();
  } catch (e) {
    dispatch(refusal ? addNotification({ kind: "error", text: "Refused" }) : serverErrorNotification(e));
  }
  render();
}

export async function errorAction(): Promise<void> {
  try {
    await save();
  } catch (e) {
    dispatch({ type: "folders/saveError", payload: e });
  }
  render();
}

export async function inState(): Promise<void> {
  try {
    await save();
  } catch (e) {
    setError(e);
  }
  try {
    await save();
  } catch {
    setState("failed");
  }
  render();
}
