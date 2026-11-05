declare function save(): Promise<void>;
declare function showError(error: unknown): void;

export function chainedThen(): void {
  setTimeout(async () => {
    // `.then` does not catch: the failure still rejects.
    await save().then(() => showError("saved"));
  });
}

declare function saveEverything(first: string, second: string): Promise<void>;

export function longCall(button: HTMLElement): void {
  button.addEventListener("click", async () => {
    await saveEverything("the first argument", "the second argument");
  });
}
