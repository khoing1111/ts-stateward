// a case shares the default's body, so a check at the top of the
// default does not compile until the case has its own copy.
type Tone = "positive" | "negative" | "neutral";

export function toneColor(tone: Tone): string {
  switch (tone) {
    case "positive":
      return "green";
    case "negative":
      return "red";
    case "neutral":
    default:
      return "gray";
  }
}

export function logTone(tone: Tone, log: string[]): void {
  switch (tone) {
    case "positive":
      log.push("+");
      break;
    case "negative":
      log.push("-");
      break;
    case "neutral":
    default:
      log.push("=");
  }
}

// The default's body declares a name: the copy goes in a block, or it would be declared twice.
export function declares(tone: Tone): string {
  switch (tone) {
    case "positive":
      return "+";
    case "negative":
      return "-";
    case "neutral":
    default:
      const shown = "=";
      return shown;
  }
}
