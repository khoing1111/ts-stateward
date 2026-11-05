declare function save(): void;
declare function render(text: string | undefined): void;
declare function showError(error: unknown): void;

// A project function that is not declared as a helper: it may report the error, or not.
export function showsTheError(): void {
  try {
    save();
  } catch (e) {
    showError(e);
  }
  render(undefined);
}

export function loggingCallWithAnEffect(): void {
  try {
    save();
  } catch (e) {
    console.error(e);
    render(String(e));
  }
  render(undefined);
}
