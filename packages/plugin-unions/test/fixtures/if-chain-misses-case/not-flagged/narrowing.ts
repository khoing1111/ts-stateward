class Dog {
  bark(): string {
    return "woof";
  }
}
class Puppy extends Dog {}
class Cat {
  meow(): string {
    return "meow";
  }
}

// `Puppy` is a `Dog`: the one test covers both.
export function derived(pet: Dog | Puppy | Cat): string {
  if (pet instanceof Dog) {
    return pet.bark();
  } else if (pet instanceof Cat) {
    return pet.meow();
  }
  return "";
}

export function typeofComplete(value: string | number | boolean | undefined): number {
  if (typeof value === "string") {
    return 1;
  } else if (typeof value === "number") {
    return 2;
  } else if (typeof value === "boolean") {
    return 3;
  } else if (typeof value === "undefined") {
    return 4;
  }
  return 0;
}

export function typeofOr(value: string | number | boolean): number {
  if (typeof value === "string" || typeof value === "number") {
    return 1;
  } else if (typeof value === "boolean") {
    return 2;
  }
  return 0;
}

// Optional properties and members that lack the property stay in the false branch.
export function inComplete(shape: { a: number } | { b: number } | { a?: number; c: number }): number {
  if ("a" in shape && shape.a !== undefined) {
    return 1;
  }
  return 0;
}

export function inOptional(shape: { a?: number; b: number } | { c: number }): number {
  if ("b" in shape) {
    return 1;
  } else if ("c" in shape) {
    return 2;
  }
  return 0;
}

// `unknown`, `any` and type parameters cannot be judged.
export function unknownValue(value: unknown): number {
  if (typeof value === "string") {
    return 1;
  } else if (typeof value === "number") {
    return 2;
  }
  return 0;
}

export function anyValue(value: unknown): number {
  if (typeof value === "string") {
    return 1;
  } else if (typeof value === "number") {
    return 2;
  }
  return 0;
}

export function unconstrained<T>(value: T): number {
  if (typeof value === "string") {
    return 1;
  } else if (typeof value === "number") {
    return 2;
  }
  return 0;
}

// A guard on `any`, or on an argument that is not the subject.
function isString(value: unknown): value is string {
  return typeof value === "string";
}
function isNumber(value: unknown): value is number {
  return typeof value === "number";
}
function assertText(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new Error("text");
}
export function guardsComplete(value: string | number): number {
  if (isString(value)) {
    return 1;
  } else if (isNumber(value)) {
    return 2;
  }
  return 0;
}

export function guardsMixed(a: string | number, b: string | number): number {
  if (isString(a)) {
    return 1;
  } else if (isNumber(b)) {
    return 2;
  }
  return 0;
}

export function assertion(value: string | number): number {
  assertText(value);
  return value.length;
}

// A custom `instanceof` is not the class test the checker applies.
class Even {
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "number" && value % 2 === 0;
  }
}
export function customInstanceof(value: Even | Dog): number {
  if (value instanceof Even) {
    return 1;
  } else if (value instanceof Dog) {
    return 2;
  }
  return 0;
}
