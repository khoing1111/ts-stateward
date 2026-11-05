type CardId = string & { readonly brand: "CardId" };
type TagId = string & { readonly brand: "TagId" };

// Deleted together everywhere: silent (it is also fully paired, see the merge suggestion).
export const titles = new Map<CardId, string>();
export const owners = new Map<CardId, string>();

export function addCard(id: CardId, title: string, owner: string): void {
  titles.set(id, title);
  owners.set(id, owner);
}

export function removeCard(id: CardId): void {
  titles.delete(id);
  owners.delete(id);
}

export function clearCards(): void {
  titles.clear();
  owners.clear();
}

// Reset of one only.
export let colors: Record<TagId, string> = {};
export const counts: Record<TagId, number> = {};

export function addTag(id: TagId, color: string): void {
  colors[id] = color;
  counts[id] = 0;
}

export function resetTags(): void {
  colors = {};
}
