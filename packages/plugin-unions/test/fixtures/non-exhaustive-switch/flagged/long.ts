type Word = "alpha" | "bravo" | "charlie" | "delta" | "echo" | "foxtrot";

export function five(word: Word): number {
  switch (word) {
    case "alpha":
      return 1;
    default:
      return 0;
  }
}

export function three(word: Word): number {
  switch (word) {
    case "alpha":
    case "bravo":
    case "charlie":
      return 1;
    default:
      return 0;
  }
}

export function four(word: Word): number {
  switch (word) {
    case "alpha":
    case "bravo":
      return 1;
    default:
      return 0;
  }
}
