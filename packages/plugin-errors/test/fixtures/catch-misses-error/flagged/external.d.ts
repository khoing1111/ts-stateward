import type { FirstError, SecondError } from "./errors.js";

/** @throws {SecondError} */
export declare function load(id: string): string;

/** @throws {FirstError} */
export declare function open(id: string): string;
/** @throws {SecondError} */
export declare function open(id: number): string;

export declare function untagged(): void;
