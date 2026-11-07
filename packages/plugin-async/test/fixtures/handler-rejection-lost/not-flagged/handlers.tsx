import ConfirmDialog from "./dialog.js";
declare function save(): Promise<void>;
declare function load(): Promise<string[]>;
declare function showError(error: unknown): void;
declare function log(message: string): void;
declare function Widget(props: { onSave: () => unknown; once?: () => unknown }): unknown;
declare function AsyncButton(props: { onClick: () => Promise<void> }): unknown;
declare function MaybeAsync(props: { onSave?: (() => PromiseLike<void>) | undefined }): unknown;
declare function MethodProp(props: { onSave(): Promise<void> }): unknown;
// The prop's type is an alias of a promise-returning function, in a union of props
// (excalidraw's `TTDDialog`, `onTextSubmit: TTTDDialog.onTextSubmit`, real-world corpus).
type SubmitHandler = (text: string) => Promise<{ answer: string }>;
declare function AliasProp(props: { onSubmit: SubmitHandler } | { fallback: true }): unknown;

const byName = async (): Promise<void> => {
  await save();
};

export function Buttons() {
  return (
    <div>
      <button
        onClick={async () => {
          try {
            await save();
          } catch (e) {
            showError(e);
          }
        }}
      />
      <button
        onClick={async () => {
          try {
            const items = await load();
            log(String(items.length));
            await save();
          } catch (e) {
            showError(e);
          } finally {
            log("done");
          }
        }}
      />
      <button
        onClick={async () => {
          try {
            try {
              await save();
            } finally {
              log("inner");
            }
          } catch (e) {
            showError(e);
          }
        }}
      />
      <button onClick={() => void save()} />
      <button onClick={() => log("plain")} />
      <button onClick={async () => log("no await")} />
      <button onClick={byName} />
      <button
        onClick={async () => {
          const later = async (): Promise<void> => {
            await save();
          };
          log(String(later));
        }}
      />
      <button
        onClick={async () => {
          const later = (): Promise<void> => save();
          log(String(later));
        }}
      />
      <Widget once={async () => await save()} onSave={() => undefined} />
      <button data-online={async () => await save()} />
      <input online={async () => await save()} />
      <input onclick={async () => await save()} />
      <button onClick={async () => Promise.resolve()} />
      <button onClick={async () => nothing()} />
      <button
        onClick={async () => {
          await save().catch(showError);
          log("saved");
        }}
      />
      <AsyncButton
        onClick={async () => {
          await save();
        }}
      />
      <AsyncButton onClick={async () => await save()} />
      <MaybeAsync onSave={async () => fetch("/api").then(() => undefined)} />
      <MethodProp onSave={async () => save()} />
      <ConfirmDialog
        onSubmit={async () => {
          await save();
        }}
      />
      <AliasProp
        onSubmit={async (text) => {
          const lines = await load();
          return { answer: `${text}${String(lines.length)}` };
        }}
      />
    </div>
  );
}

declare function nothing(): void;

export function listen(target: EventTarget): void {
  target.addEventListener("click", () => {
    void save();
  });
  target.addEventListener("click", async () => {
    try {
      await save();
    } catch (e) {
      showError(e);
    }
  });
  target.addEventListener("click", async () => log("no await"));
  target.removeEventListener("click", async () => {
    await save();
  });
  target.addEventListener("click", byName);
}

export function timers(): void {
  setTimeout(() => {
    log("tick");
  }, 100);
  setTimeout(async () => {
    try {
      await save();
    } catch (e) {
      showError(e);
    }
  }, 100);
  setInterval(byName, 1000);
  const queue = (_callback: () => Promise<void>): void => {};
  queue(async () => {
    await save();
  });
  const local = { setTimeout: (_callback: () => Promise<void>): void => {} };
  local.setTimeout(async () => {
    await save();
  });
}

export function caughtTimer(): void {
  setTimeout(async () => {
    await save().catch((error: unknown) => showError(error));
  }, 10);
}

export function localFetch(fetch: () => string): void {
  setTimeout(async () => fetch(), 100);
}

export function generator(): void {
  setTimeout(async function* () {
    await save();
    yield 1;
  }, 100);
}

// The awaited function catches its own failures: every await in it is inside a `try` with a
// `catch` that neither throws nor awaits (Infisical's dialogs, user trial 1.0.2).
export function ConfirmRemove() {
  const handleRemove = async (): Promise<void> => {
    try {
      await save();
      log("removed");
    } catch {
      // the global request handler shows a toast
    }
  };
  async function handleRotate(id: string): Promise<void> {
    if (id === "") return;
    try {
      const items = await load();
      log(String(items.length));
    } catch (e) {
      showError(e);
    }
  }
  return (
    <div>
      <button
        onClick={async () => {
          await handleRemove();
        }}
      />
      <button
        onClick={async () => {
          await handleRotate("a");
          log("rotated");
        }}
      />
      <button onClick={async () => handleRemove()} />
    </div>
  );
}
