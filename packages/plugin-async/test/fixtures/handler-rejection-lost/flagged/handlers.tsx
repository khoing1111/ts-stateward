declare function save(): Promise<void>;
declare function load(): Promise<string[]>;
declare function showError(error: unknown): void;
declare function setItems(items: string[]): void;

async function saveAll(): Promise<void> {
  await save();
}

const saveLater = async (): Promise<void> => {
  await save();
};

export function Buttons() {
  return (
    <div>
      <button
        onClick={async () => {
          await save();
        }}
      >
        Save
      </button>
      <form
        onSubmit={async function () {
          const items = await load();
          setItems(items);
        }}
      />
      <Widget onSave={async () => await save()} />
      <Widget onSave={async () => fetch("/api")} />
      <Widget onSave={async () => saveAll()} />
      <Widget onSave={async () => saveLater()} />
      <Widget onSave={async () => Promise.all([save(), save()])} />
      <input
        onChange={async () => {
          try {
            showError("saving");
          } catch (e) {
            await save();
          }
        }}
      />
      <input
        onBlur={async () => {
          try {
            await save();
          } finally {
            showError("done");
          }
        }}
      />
      <input
        onFocus={async () => {
          for await (const item of stream()) setItems([item]);
        }}
      />
      <input onKeyDown={(async () => await save())} />
      <input
        onInput={async () => {
          if (Math.random() > 0.5) {
            return fetch("/api");
          }
          return undefined;
        }}
      />
    </div>
  );
}

// The component does not ask for a promise, so nothing awaits what the handler returns.
declare function Widget(props: { onSave: () => void }): unknown;
declare function stream(): AsyncIterable<string>;

export function listen(target: EventTarget): void {
  target.addEventListener("click", async () => {
    await save();
  });
  document.addEventListener("keydown", async function (event) {
    showError(event);
    await save();
  });
}

export function timers(): void {
  setTimeout(async () => {
    await save();
  }, 100);
  setInterval(async () => {
    await save();
  }, 1000);
  queueMicrotask(async () => {
    await save();
  });
  window.setTimeout(async () => {
    await save();
  }, 100);
}

export function twoAwaitsOneFinding(): void {
  setTimeout(async () => {
    await save();
    await save();
  }, 100);
}

export function longName(): void {
  const someVeryLongObjectName = { addEventListener: (_name: string, _listener: () => void) => {} };
  someVeryLongObjectName.addEventListener("x", async () => {
    await save();
  });
}
