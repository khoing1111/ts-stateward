type Status = { kind: "idle" } | { kind: "running"; pid: number } | { kind: "failed" };
type Mode = "r" | "w";

export function block(status: Status): number {
  if (status.kind === "idle") {
    return 0;
  } else if (status.kind === "running") {
    return status.pid;
  } else if (status.kind === "failed") {
    return 2;
  } else {
    return -1;
  }
}

export function sameLine(status: Status): number {
  if (status.kind === "idle") {
    return 0;
  } else if (status.kind === "running") {
    return status.pid;
  } else if (status.kind === "failed") {
    return 2;
  } else { return -1; }
}

export function plain(mode: Mode): number {
  if (mode === "r") {
    return 0;
  } else if (mode === "w") {
    return 1;
  } else {
    return -1;
  }
}

export function tabs(mode: Mode): number {
	if (mode === "r") {
		return 0;
	} else if (mode === "w") {
		return 1;
	} else {
		return -1;
	}
}

export function empty(mode: Mode): number {
  if (mode === "r") {
    return 0;
  } else if (mode === "w") {
    return 1;
  } else {
  }
  return -1;
}

export function bare(mode: Mode): number {
  if (mode === "r") {
    return 0;
  } else if (mode === "w") {
    return 1;
  } else return -1;
}

export function typeofComplete(value: string | number): number {
  if (typeof value === "string") {
    return 0;
  } else if (typeof value === "number") {
    return 1;
  } else {
    return -1;
  }
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

export function instancesComplete(pet: Dog | Cat): string {
  if (pet instanceof Dog) {
    return pet.bark();
  } else if (pet instanceof Cat) {
    return pet.meow();
  } else {
    return "";
  }
}

export function inComplete(shape: { a: number } | { b: number }): number {
  if ("a" in shape) {
    return shape.a;
  } else if ("b" in shape) {
    return shape.b;
  } else {
    return 0;
  }
}

export function plainObject(job: { kind: "a" | "b" }): number {
  if (job.kind === "a") {
    return 0;
  } else if (job.kind === "b") {
    return 1;
  } else {
    return 2;
  }
}

type Circle = { shape: "circle"; radius: number };
type Square = { shape: "square"; side: number };
type Figure = Circle | Square;

function isCircle(figure: Figure): figure is Circle {
  return figure.shape === "circle";
}
function isSquare(figure: Figure): figure is Square {
  return figure.shape === "square";
}

export function guardsComplete(figure: Figure): number {
  if (isCircle(figure)) {
    return figure.radius;
  } else if (isSquare(figure)) {
    return figure.side;
  } else {
    return 0;
  }
}

export function generic<T extends Figure>(t: T): number {
  if (t.shape === "circle") {
    return 1;
  } else if (t.shape === "square") {
    return 2;
  } else {
    return 0;
  }
}

export function genericValue<T extends "a" | "b">(x: T): number {
  if (x === "a") {
    return 1;
  } else if (x === "b") {
    return 2;
  } else {
    return 0;
  }
}

export function orTests(figure: Figure | { shape: "triangle" }): number {
  if (figure.shape === "circle" || figure.shape === "square") {
    return 1;
  } else if (figure.shape === "triangle") {
    return 2;
  } else {
    return 0;
  }
}
