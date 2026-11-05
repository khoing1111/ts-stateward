import v8 from "node:v8";

/**
 * How far, in percent, V8 lets the heap grow past what the last full garbage collection kept before
 * it collects again. Left to itself V8 picks 10% to 300% from how fast it collects, and the server,
 * whose every edit drops a type checker's worth of objects, then reached 2 to 3 times what it keeps
 * (1.1 to 1.6 GB on the 3,000-file bench, 1.5 GB on excalidraw).
 */
export const HEAP_GROWING_PERCENT = 10;

/**
 * Sets V8's heap growth for this process (`--heap-growing-percent`). For the server's own process,
 * called before it starts: V8 reads the flag at each collection, so it holds from the next one on.
 */
export function limitHeapGrowth(): void {
  v8.setFlagsFromString(`--heap-growing-percent=${String(HEAP_GROWING_PERCENT)}`);
}
