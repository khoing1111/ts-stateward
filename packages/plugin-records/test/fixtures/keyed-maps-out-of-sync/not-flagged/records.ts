type UserId = string & { readonly brand: "UserId" };
type OrderId = number;

// Different key types.
export const names: Record<UserId, string> = {};
export const totals: Record<OrderId, number> = {};

export function addUser(id: UserId, name: string): void {
  names[id] = name;
}
export function addOrder(id: OrderId, total: number): void {
  totals[id] = total;
}
export function both(user: UserId, order: OrderId): void {
  names[user] = "";
  totals[order] = 0;
}
export function both2(user: UserId, order: OrderId): void {
  names[user] = "x";
  totals[order] = 1;
}

// Written with different keys: never kept in step.
export const first: Record<UserId, string> = {};
export const second: Record<UserId, string> = {};
export function setBoth(a: UserId, b: UserId): void {
  first[a] = "a";
  second[b] = "b";
}
export function setFirst(id: UserId): void {
  first[id] = "c";
}

// A derived cache: the right side reads the other container.
export const sizes: Record<UserId, number> = {};
export const labels: Record<UserId, string> = {};
export function measure(id: UserId): void {
  sizes[id] = 1;
  labels[id] = `size ${String(sizes[id])}`;
}
export function measureAgain(id: UserId): void {
  sizes[id] = 2;
  labels[id] = `size ${String(sizes[id])}`;
}

// Read together only.
export const left: Record<UserId, string> = {};
export const right: Record<UserId, string> = {};
export function show(id: UserId): string {
  return `${left[id] ?? ""}${right[id] ?? ""}`;
}
export function show2(id: UserId): string {
  return `${right[id] ?? ""}${left[id] ?? ""}`;
}

// Arrays are not looked at.
export const listA: string[] = [];
export const listB: string[] = [];
export function push1(i: number): void {
  listA[i] = "";
  listB[i] = "";
}
export function push2(i: number): void {
  listA[i] = "";
  listB[i] = "";
}
