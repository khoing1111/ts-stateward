declare function save(): Promise<void>;
declare function load(): Promise<string[]>;
declare function showError(error: unknown): void;

// A function that catches only part of its work, or fails again in its `catch`, can still reject.
export function PartlyCaught() {
  const removeThenReload = async (): Promise<void> => {
    try {
      await save();
    } catch {
      // shown by the global handler
    }
    await load();
  };
  const rethrows = async (): Promise<void> => {
    try {
      await save();
    } catch (e) {
      showError(e);
      throw e;
    }
  };
  return (
    <div>
      <button
        onClick={async () => {
          await removeThenReload();
        }}
      />
      <button
        onClick={async () => {
          await rethrows();
        }}
      />
    </div>
  );
}
