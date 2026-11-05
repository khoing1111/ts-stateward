import { useState } from "react";

// The shapes the 111 warnings of a large app were made of: reads, conditions, defaults,
// `in` tests, `break` and store dispatches after the request. None calls code of the project
// with what the request gave, so none is reported.
class RequestError extends Error {}
type Folder = { id: string; name: string; items?: readonly string[] };
type Action = { type: string; text: string };

async function getFolder(id: string): Promise<Folder> {
  const response = await fetch(`/folders/${id}`);
  if (!response.ok) throw new RequestError(String(response.status));
  return { id, name: id };
}

function addNotification(text: string): Action {
  return { type: "notifications/add", text };
}

declare function showError(error: unknown): void;

export function useFolder(id: string, dispatch: (action: Action) => void) {
  const [name, setName] = useState("");
  const [items, setItems] = useState<readonly string[]>([]);

  async function load(): Promise<void> {
    try {
      const folder = await getFolder(id);
      setName(folder.name);
      setItems(folder.items ?? []);
      if ("items" in folder) setItems(folder.items ?? []);
    } catch (e) {
      showError(e);
    }
  }

  async function announce(): Promise<void> {
    try {
      const folder = await getFolder(id);
      dispatch(addNotification(`Loaded ${folder.name}`));
    } catch (e) {
      showError(e);
    }
  }

  async function firstNamed(ids: readonly string[]): Promise<string> {
    let found = "";
    for (const one of ids) {
      try {
        const folder = await getFolder(one);
        if (folder.name === "") continue;
        found = folder.name;
        break;
      } catch (e) {
        showError(e);
      }
    }
    return found;
  }

  return { name, items, load, announce, firstNamed };
}

// A promise's own `resolve` cannot throw (an image insert in a real editor).
export function loadInPromise(id: string): Promise<string> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const folder = await getFolder(id);
        resolve(folder.name);
      } catch (e) {
        showError(e);
        reject(new Error("Could not load the folder"));
      }
    })();
  });
}
