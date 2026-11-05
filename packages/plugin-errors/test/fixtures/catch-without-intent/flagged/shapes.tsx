declare function save(): Promise<void>;
declare function close(): void;
declare function track(event: string): void;
declare const stored: string;

// Nothing is returned when the parse fails, though the function returns a value.
export function readName(): string | undefined {
  try {
    return JSON.parse(stored).name;
  } catch (e) {
    console.warn(e);
  }
  track("no-name");
  return undefined;
}

// An async event handler: nothing above it shows the failure.
export const handleSubmit = async (): Promise<void> => {
  try {
    await save();
  } catch (e) {
    console.error(e);
  }
  close();
};

export function SaveButton() {
  return (
    <button
      onClick={async () => {
        try {
          await save();
        } catch (e) {
          console.error(e);
        }
        close();
      }}
    />
  );
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      button: { onClick?: () => unknown };
    }
  }
}
