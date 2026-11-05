const widths: Record<string, number> = { narrow: 10, wide: 40 };

export const widthLines = Object.keys(widths).map((key) => `${key}=${String(widths[key])}`);
