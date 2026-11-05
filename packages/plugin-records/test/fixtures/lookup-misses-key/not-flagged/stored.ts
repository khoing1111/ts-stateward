// real-world corpus (tldraw, excalidraw): the value looked up is stored, and its first use checks for a
// missing entry; or it is the fallback of `??`, whose result is checked the same way.
type Action = { kbd?: string };
declare function useActions(): Record<string, Action>;
declare const icons: Record<string, string>;
declare const palette: Record<string, string | readonly string[]>;
declare function show(text: string): void;

export function lockTooltip(): string {
  const actions = useActions();
  const toggle = actions["toggle-tool-lock"];
  return toggle?.kbd ?? "";
}

export function iconFor(name: string): string {
  const asset = icons[name] ?? icons["question-mark"];
  if (!asset) return "";
  return asset;
}

export function shadesOf(): void {
  const shades = palette["red"];
  if (Array.isArray(shades)) shades.forEach(show);
}
