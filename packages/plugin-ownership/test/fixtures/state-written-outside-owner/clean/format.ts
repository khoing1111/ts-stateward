export function formatSettings(own: { theme: string; fontSize: number }): string {
  return `${own.theme} ${String(own.fontSize)}`;
}

export function ping(own: { theme: string }, depth: number): string {
  return depth > 0 ? pong(own, depth - 1) : own.theme;
}

export function pong(own: { theme: string }, depth: number): string {
  return ping(own, depth - 1);
}
