/** A package value that is disposable but never needs a release (like a test mock). */
export declare function fn(): { (): void; [Symbol.dispose](): void };
export declare function stubGlobal(name: string, value: unknown): void;
