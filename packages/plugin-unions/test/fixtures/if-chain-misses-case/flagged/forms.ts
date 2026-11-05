type Shape = { radius: number } | { side: number } | { width: number; height: number };

export function inChecks(shape: Shape): number {
  if ("radius" in shape) {
    return shape.radius;
  } else if ("side" in shape) {
    return shape.side;
  }
  return 0;
}

export function typeofChain(value: string | number | boolean): number {
  if (typeof value === "string") {
    return value.length;
  } else if (typeof value === "number") {
    return value;
  }
  return 0;
}

export function typeofNullable(value: string | number | null): number {
  if (typeof value === "string") {
    return 1;
  } else if (value === null) {
    return 2;
  }
  return 0;
}

export function typeofObject(value: string | number | { a: 1 } | (() => void)): number {
  if (typeof value === "string") {
    return 1;
  } else if (typeof value === "function") {
    return 2;
  } else if (typeof value === "object") {
    return 3;
  }
  return 0;
}

class Dog {
  bark(): string {
    return "woof";
  }
}
class Cat {
  meow(): string {
    return "meow";
  }
}
class Bird {
  tweet(): string {
    return "tweet";
  }
}

export function instances(pet: Dog | Cat | Bird): string {
  if (pet instanceof Dog) {
    return pet.bark();
  } else if (pet instanceof Cat) {
    return pet.meow();
  }
  return "";
}

type Circle = { shape: "circle"; radius: number };
type Square = { shape: "square"; side: number };
type Triangle = { shape: "triangle"; base: number };
type Figure = Circle | Square | Triangle;

function isCircle(figure: Figure): figure is Circle {
  return figure.shape === "circle";
}
function isSquare(figure: Figure): figure is Square {
  return figure.shape === "square";
}

export function guards(figure: Figure): number {
  if (isCircle(figure)) {
    return figure.radius;
  } else if (isSquare(figure)) {
    return figure.side;
  }
  return 0;
}

export function combined(figure: Figure): number {
  if (figure.shape === "circle" || figure.shape === "square") {
    return 1;
  } else if (figure.shape === "square") {
    return 2;
  }
  return 0;
}

export function combinedGuards(figure: Figure): number {
  if (isCircle(figure) || isSquare(figure)) {
    return 1;
  } else if (typeof figure === "string") {
    return 2;
  }
  return 0;
}
