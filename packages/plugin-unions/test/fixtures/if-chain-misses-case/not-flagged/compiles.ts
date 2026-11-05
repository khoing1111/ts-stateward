// The chains the rule asks for, written out: each must compile, so the hints are not a trap.
type Circle = { shape: "circle"; radius: number };
type Square = { shape: "square"; side: number };
type Triangle = { shape: "triangle"; base: number };
type Figure = Circle | Square | Triangle;

function fail(value: never): never {
  throw new Error(String(value));
}

function isCircle(figure: Figure): figure is Circle {
  return figure.shape === "circle";
}
function isSquare(figure: Figure): figure is Square {
  return figure.shape === "square";
}

export function discriminant(figure: Figure): number {
  if (figure.shape === "circle") {
    return 1;
  } else if (figure.shape === "square") {
    return 2;
  } else if (figure.shape === "triangle") {
    return 3;
  } else {
    return fail(figure);
  }
}

export function generic<T extends Figure>(figure: T): number {
  if (figure.shape === "circle") {
    return 1;
  } else if (figure.shape === "square") {
    return 2;
  } else if (figure.shape === "triangle") {
    return 3;
  } else {
    return fail(figure);
  }
}

export function genericValue<T extends "a" | "b" | "c">(value: T): number {
  if (value === "a") {
    return 1;
  } else if (value === "b" || value === "c") {
    return 2;
  } else {
    return fail(value);
  }
}

export function guards(figure: Figure): number {
  if (isCircle(figure)) {
    return 1;
  } else if (isSquare(figure)) {
    return 2;
  } else if (figure.shape === "triangle") {
    return 3;
  } else {
    return fail(figure);
  }
}

export function guardsOnly(figure: Circle | Square): number {
  if (isCircle(figure)) {
    return 1;
  } else if (isSquare(figure)) {
    return 2;
  } else {
    return fail(figure);
  }
}

export function typeofs(value: string | number | boolean | undefined | null): number {
  if (typeof value === "string") {
    return 1;
  } else if (typeof value === "number") {
    return 2;
  } else if (typeof value === "boolean") {
    return 3;
  } else if (typeof value === "undefined" || value === null) {
    return 4;
  } else {
    return fail(value);
  }
}

export function typeofsObjects(value: string | { a: 1 } | (() => void) | null): number {
  if (typeof value === "string") {
    return 1;
  } else if (typeof value === "function") {
    return 2;
  } else if (typeof value === "object") {
    return 3;
  } else {
    return fail(value);
  }
}

export function inChecks(shape: { a: number } | { b: number } | { c: number }): number {
  if ("a" in shape) {
    return 1;
  } else if ("b" in shape) {
    return 2;
  } else if ("c" in shape) {
    return 3;
  } else {
    return fail(shape);
  }
}

export function inOptional(shape: { a?: number; b: number } | { c: number }): number {
  if ("a" in shape && shape.a !== undefined) {
    return 1;
  } else if ("b" in shape) {
    return 2;
  } else if ("c" in shape) {
    return 3;
  } else {
    return fail(shape);
  }
}

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

export function instances(pet: Dog | Puppy | Cat): string {
  if (pet instanceof Dog) {
    return pet.bark();
  } else if (pet instanceof Cat) {
    return pet.meow();
  } else {
    return fail(pet);
  }
}
