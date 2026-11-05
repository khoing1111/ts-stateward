export declare class DeclaredError extends Error {}
/** @throws {DeclaredError} */
export declare function parse(text: string): string;
/** @throws {DeclaredError | TypeError} */
export declare function fetchIt(): Promise<string>;
