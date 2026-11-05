import { dispatch, getFolder, useUpdateFolderMutation } from "./api.js";
import type { Folder } from "./api.js";

declare function notify(text: string): void;
declare function toast(text: string): void;
declare function parseFolder(values: unknown): Folder;

// A real project's folder rename: an optimistic update, then the request, then a
// rollback in the `catch`. Without `.unwrap()` a failed request never reaches the rollback.
export function useFolderActions(
  folders: readonly Folder[],
  setFolders: (folders: readonly Folder[]) => void,
) {
  const [updateFolder] = useUpdateFolderMutation();

  async function rename(folder: Folder, name: string): Promise<void> {
    const previous = folders;
    try {
      setFolders(folders.map((one) => (one.id === folder.id ? { ...one, name } : one)));
      await updateFolder({ ...folder, name });
      notify("Folder updated!");
    } catch {
      setFolders(previous);
      notify("Could not rename the folder");
    }
  }

  // A parse before the request: the `catch` is for it too, but "Folder updated!" still shows
  // after a failed request.
  async function renameFromForm(values: unknown): Promise<void> {
    try {
      const folder = parseFolder(values);
      await updateFolder(folder);
      notify("Folder updated!");
    } catch {
      notify("Check the folder's name");
    }
  }

  // The failure is read, but its branch does not return.
  async function move(folder: Folder): Promise<void> {
    toast("Moving…");
    const result = await updateFolder(folder);
    if ("error" in result) {
      toast("failed");
    }
    toast("Folder moved");
  }

  async function archive(folder: Folder): Promise<void> {
    const result = await updateFolder({ ...folder, archived: true });
    if (result.error) {
      toast("failed");
    }
    notify("Folder archived");
  }

  async function refresh(id: string): Promise<void> {
    const { data, isError } = await dispatch(getFolder.initiate(id));
    if (isError) {
      toast("failed");
    }
    notify(`Loaded ${data?.name ?? ""}`);
  }

  return { rename, renameFromForm, move, archive, refresh };
}
