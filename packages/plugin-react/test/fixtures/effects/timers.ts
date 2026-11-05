const running = new Set<ReturnType<typeof setInterval>>();

export function stopTimer(id: ReturnType<typeof setInterval>): void {
  running.delete(id);
  clearInterval(id);
}
