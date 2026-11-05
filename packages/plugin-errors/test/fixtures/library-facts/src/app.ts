import { DeclaredError, fetchIt, parse } from "declared-lib";
import { LibError, each, load, missing } from "inferred-lib";
import { check } from "cjs-lib";
import { get } from "minified-lib";
import { hash } from "native-lib";
import { run } from "eval-lib";
import { go, later } from "config-lib";
import { deep } from "large-lib";

export function useDeclared(): string {
  return parse("x");
}

export async function useDeclaredAsync(): Promise<string> {
  return fetchIt();
}

export function useInferred(): unknown {
  return load("x");
}

export function useCallback(): void {
  each(() => {});
}

export function useMissing(): void {
  missing();
}

export function useCommonJs(): number {
  return check(1);
}

export function useMinified(): unknown {
  return get({}, "a.b");
}

export function useNative(): string {
  return hash("x");
}

export function useEval(): unknown {
  return run("1");
}

export function useConfig(): void {
  go();
}

export async function useConfigAsync(): Promise<void> {
  await later();
}

export function useLarge(): number {
  return deep();
}

export function handles(): void {
  try {
    load("x");
    get({}, "a");
  } catch (e) {
    if (e instanceof LibError) {
      console.log("lib");
    } else if (e instanceof DeclaredError) {
      console.log("declared");
    }
  }
}

declare const external: { run(): void };

export function useMixed(): unknown {
  external.run();
  return get({}, "a");
}
