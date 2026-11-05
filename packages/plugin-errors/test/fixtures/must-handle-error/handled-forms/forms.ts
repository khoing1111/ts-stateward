import { showPaymentError, showRenewal } from "./notify.js";
import { Declined, Expired, pay } from "./errors.js";

/** A guard that rethrows everything else, then handles the error. */
export function guarded(): number {
  try {
    return pay();
  } catch (e) {
    if (!(e instanceof Declined)) throw e;
    return 0;
  }
}

/** A guard that names two classes. */
export function guardedTwice(): number {
  try {
    return pay();
  } catch (e) {
    if (!(e instanceof Expired || e instanceof Declined)) {
      throw e;
    }
    return 0;
  }
}

/** A conditional expression that tests the class. */
export function conditional(): number {
  try {
    return pay();
  } catch (e) {
    return e instanceof Declined ? 0 : -1;
  }
}

/** A chain of conditional expressions. */
export function chained(): number {
  try {
    return pay();
  } catch (e) {
    return e instanceof Expired ? 1 : e instanceof Declined ? 0 : 2;
  }
}

/** An `&&` that acts only on the class. */
export function andThen(): void {
  try {
    pay();
  } catch (e) {
    e instanceof Declined && console.log("declined");
  }
}

/** A `switch (true)` case. */
export function switched(): number {
  try {
    return pay();
  } catch (e) {
    switch (true) {
      case e instanceof Declined:
        return 0;
      default:
        throw e;
    }
  }
}

/** A helper declared here and called only inside the `try`. */
export function helper(): number {
  const charge = (): number => pay();
  try {
    return charge();
  } catch (e) {
    if (e instanceof Declined) return 0;
    throw e;
  }
}

/** A helper declared as a function and called twice, both inside handling `try` blocks. */
export function helperDeclared(): number {
  function charge(): number {
    return pay();
  }
  try {
    charge();
  } catch (e) {
    if (e instanceof Declined) return 0;
    throw e;
  }
  try {
    return charge();
  } catch (e) {
    return e instanceof Declined ? 0 : -1;
  }
}

/** the catch hands the error to a helper that names the class first thing. */
export function handledByHelper(): number {
  try {
    return pay();
  } catch (e) {
    showPaymentError(e);
    return 0;
  }
}

export function handledByArrowHelper(): number {
  try {
    return pay();
  } catch (error) {
    showRenewal(error);
    return 0;
  }
}
