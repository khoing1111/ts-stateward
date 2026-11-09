export function isKeyOf<T extends object>(table: T, key: PropertyKey): key is keyof T {
  return Object.hasOwn(table, key);
}
