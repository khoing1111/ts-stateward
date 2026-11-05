import { logThenShow, relay, rethrowDeclined } from "./notify.js";
import { Declined, pay } from "./errors.js";

/** The guard names `Error`, not the marked class. */
export function guardedByError(): number {
  try {
    return pay();
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    return 0;
  }
}

/** The conditional expression tests `Error`. */
export function conditionalByError(): number {
  try {
    return pay();
  } catch (e) {
    return e instanceof Error ? 0 : -1;
  }
}

/** A guard that does not leave the `catch` is not a guard: the error is met by nothing. */
export function notAGuard(): number {
  try {
    return pay();
  } catch (e) {
    if (!(e instanceof Declined)) console.log(e);
    return 0;
  }
}

/** One call of the helper sits outside a `try`: the helper is reported. */
export function helperCalledBare(): number {
  const charge = (): number => pay();
  try {
    charge();
  } catch (e) {
    if (e instanceof Declined) return 0;
    throw e;
  }
  return charge();
}

/** helpers that do not count as naming the class. */
export function helperRethrows(): number {
  try {
    return pay();
  } catch (e) {
    rethrowDeclined(e);
    return 0;
  }
}

export function helperTestsLater(): number {
  try {
    return pay();
  } catch (e) {
    logThenShow(e);
    return 0;
  }
}

export function helperTwoLevels(): number {
  try {
    return pay();
  } catch (e) {
    relay(e);
    return 0;
  }
}
