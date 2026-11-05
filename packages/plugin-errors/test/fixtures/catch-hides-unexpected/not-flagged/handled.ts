class NotFoundError extends Error {}
class AuthError extends Error {}
class WrappedError extends Error {}

declare function save(): Promise<void>;
declare function show(message: string): void;
declare function report(error: unknown): void;
declare const other: unknown;

export async function rethrows(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("missing");
    } else if (e instanceof AuthError) {
      show("login");
    } else {
      throw e;
    }
  }
}

export async function wraps(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("missing");
    } else {
      throw new WrappedError("save failed", { cause: e });
    }
  }
}

export async function elseHandles(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("missing");
    } else {
      report(e);
    }
  }
}

export async function elseIsAStatement(): Promise<number> {
  try {
    await save();
    return 1;
  } catch (e) {
    if (e instanceof NotFoundError) return 0;
    else return 2;
  }
}

export async function throwsAfterTheChain(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("missing");
      return;
    }
    throw e;
  }
}

export async function guardClauses(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("missing");
      return;
    }
    if (e instanceof AuthError) {
      show("login");
      return;
    }
    report(e);
  }
}

export async function negatedGuard(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
    show("missing");
  }
}

export async function switchWithDefault(): Promise<void> {
  try {
    await save();
  } catch (e) {
    switch (true) {
      case e instanceof NotFoundError:
        show("missing");
        break;
      default:
        throw e;
    }
  }
}

export async function otherValue(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (other instanceof NotFoundError) {
      show("not about the caught error");
    }
  }
}

export async function notInstanceof(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e === other) {
      show("same");
    } else if (typeof e === "string") {
      show(e);
    }
  }
}

export async function noBinding(): Promise<void> {
  try {
    await save();
  } catch {
    show("failed");
  }
}

export async function destructured(): Promise<void> {
  try {
    await save();
  } catch ({ message }) {
    show(String(message));
  }
}

export async function switchOnOther(): Promise<void> {
  try {
    await save();
  } catch (e) {
    switch (e instanceof NotFoundError) {
      case true:
        show("missing");
        break;
      case false:
        throw e;
    }
  }
}

export async function chainInsideAFunction(): Promise<void> {
  try {
    await save();
  } catch (e) {
    const describe = (): void => {
      if (e instanceof NotFoundError) show("missing");
    };
    describe();
    throw e;
  }
}
