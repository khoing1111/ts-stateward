export class AErr extends Error {}
export class BErr extends Error {}

export function makeB(): BErr {
  return new BErr("made");
}

export function failB(): never {
  throw new BErr("b");
}

export class Box {
  get value(): number {
    throw new BErr("get");
  }
  set value(_next: number) {
    throw new BErr("set");
  }
}
