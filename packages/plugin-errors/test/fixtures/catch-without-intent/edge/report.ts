declare function save(): void;
declare function render(text: string | undefined): void;
declare function reportAndShow(error: unknown): void;
declare function ignoreError(error: unknown): void;
declare const Sentry: { captureException(error: unknown): void };

export function reported(): void {
  try {
    save();
  } catch (e) {
    reportAndShow(e);
  }
  render(undefined);
}

export function reportedToSentry(): void {
  try {
    save();
  } catch (e) {
    Sentry.captureException(e);
  }
  render(undefined);
}

export function ignoredOnPurpose(): void {
  try {
    save();
  } catch (e) {
    ignoreError(e);
  }
  render(undefined);
}

// Only logs, in a file that reports elsewhere: the message shows this file's way.
export function onlyLogged(): void {
  try {
    save();
  } catch (e) {
    console.error(e);
  }
  render(undefined);
}
