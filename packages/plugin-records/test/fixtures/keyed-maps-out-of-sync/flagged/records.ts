type UserId = string & { readonly brand: "UserId" };

// Records written together with the same key in two functions.
export const names: Record<UserId, string> = {};
export const ages: Record<UserId, number> = {};

export function addUser(id: UserId, name: string, age: number): void {
  names[id] = name;
  ages[id] = age;
}

export function renameUser(id: UserId, name: string, age: number): void {
  names[id] = name;
  ages[id] = age;
}

// Maps: set and delete together.
export const titles = new Map<number, string>();
export const owners = new Map<number, string>();

export function addDoc(docId: number, title: string, owner: string): void {
  titles.set(docId, title);
  owners.set(docId, owner);
}

export function removeDoc(docId: number): void {
  titles.delete(docId);
  owners.delete(docId);
}
