// real-world corpus: a table that loses keys in a `finally` or a timer's callback marks work in progress,
// and lives for a shorter time than its partner on purpose.
type FileId = string & { readonly brand: "FileId" };
type DraftKey = string & { readonly brand: "DraftKey" };
declare function upload(id: FileId): Promise<void>;
declare function write(key: DraftKey, text: string): void;

// excalidraw's FileManager: `savingFiles` holds the uploads in flight.
export class FileManager {
  private savingFiles = new Map<FileId, true>();
  private savedFiles = new Map<FileId, number>();

  async save(id: FileId, version: number): Promise<void> {
    this.savingFiles.set(id, true);
    try {
      await upload(id);
      this.savedFiles.set(id, version);
    } finally {
      this.savingFiles.delete(id);
    }
  }

  markSaving(id: FileId, version: number): void {
    this.savingFiles.set(id, true);
    this.savedFiles.set(id, version);
  }
}

// memos' draft cache: `pendingSaves` holds the timeouts not yet fired.
const pendingSaves = new Map<DraftKey, ReturnType<typeof setTimeout>>();
const cursors = new Map<DraftKey, number>();

export function save(key: DraftKey, text: string, cursor: number): void {
  cursors.set(key, cursor);
  pendingSaves.set(
    key,
    setTimeout(() => {
      pendingSaves.delete(key);
      write(key, text);
    }, 500),
  );
}

export function saveNow(key: DraftKey, text: string, cursor: number): void {
  const pending = pendingSaves.get(key);
  if (pending !== undefined) {
    clearTimeout(pending);
    pendingSaves.delete(key);
  }
  cursors.set(key, cursor);
  pendingSaves.set(key, setTimeout(() => write(key, text), 0));
}
