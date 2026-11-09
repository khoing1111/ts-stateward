const palette: Record<string, string> = { red: "#f00", green: "#0f0" };

function describe(colors: Readonly<Record<string, string>>): number {
  return Object.keys(colors).length;
}

function describeMap(colors: ReadonlyMap<string, string>): number {
  return colors.size;
}

const tones = new Map([["dark", "#000"]]);

export const paletteSize = describe(palette);
export const toneSize = describeMap(tones);
