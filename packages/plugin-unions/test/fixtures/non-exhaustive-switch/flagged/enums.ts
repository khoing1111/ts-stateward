enum Color {
  Red,
  Green,
  Blue,
}

export function numeric(color: Color): number {
  switch (color) {
    case Color.Red:
      return 1;
    default:
      return 0;
  }
}

enum Level {
  Low = "low",
  High = "high",
}

export function text(level: Level): number {
  switch (level) {
    case Level.High:
      return 1;
    default:
      return 0;
  }
}
