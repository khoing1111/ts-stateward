enum Color {
  Red,
  Green,
  Blue,
}

enum Level {
  Low = "low",
  High = "high",
}

export function colors(color: Color): number {
  if (color === Color.Red) {
    return 0;
  } else if (Color.Green === color) {
    return 1;
  }
  return 2;
}

export function levels(level: Level): number {
  if (level === Level.Low) {
    return 0;
  } else if (level === "high") {
    return 1;
  } else {
    return 2;
  }
}

export function levelsHidden(level: Level, other: Level): number {
  if (level === Level.Low) {
    return 0;
  } else if (other === Level.Low) {
    return 1;
  }
  return 2;
}
