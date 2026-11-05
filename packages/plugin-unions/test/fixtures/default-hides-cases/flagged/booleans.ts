export function flag(on: boolean): number {
  switch (on) {
    case true:
      return 1;
    default:
      return 0;
  }
}
