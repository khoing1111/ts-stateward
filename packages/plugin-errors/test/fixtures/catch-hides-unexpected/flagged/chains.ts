class NotFoundError extends Error {}
class AuthError extends Error {}
class RateLimitError extends Error {}
class TimeoutError extends Error {}
class QuotaError extends Error {}
class PaymentRequiredErrorWithAVeryLongName extends Error {}
class AnotherQuiteLongClassNameForErrors extends Error {}
class ThirdVeryLongClassNameThatKeepsGoing extends Error {}

declare function save(): Promise<void>;
declare function show(message: string): void;
declare const errors: { Missing: typeof NotFoundError };

export async function twoClasses(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("missing");
    } else if (e instanceof AuthError) {
      show("login");
    }
  }
}

export async function oneClass(): Promise<void> {
  try {
    await save();
  } catch (error) {
    if (error instanceof NotFoundError) {
      show("missing");
    }
  }
}

export async function manyClasses(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("a");
    } else if (e instanceof AuthError) {
      show("b");
    } else if (e instanceof RateLimitError) {
      show("c");
    } else if (e instanceof TimeoutError) {
      show("d");
    } else if (e instanceof QuotaError) {
      show("e");
    }
  }
}

export async function emptyElse(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("missing");
    } else {
    }
  }
}

export async function switchOnTrue(): Promise<void> {
  try {
    await save();
  } catch (e) {
    switch (true) {
      case e instanceof NotFoundError:
        show("missing");
        break;
      case e instanceof AuthError:
        show("login");
        break;
    }
  }
}

export async function emptyDefault(): Promise<void> {
  try {
    await save();
  } catch (e) {
    switch (true) {
      case e instanceof NotFoundError:
        show("missing");
        break;
      default:
    }
  }
}

export async function orAndPlainTests(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof AuthError) {
      show("a");
    } else if (e instanceof Error && e.message === "x") {
      show("b");
    }
  }
}

export async function lastTestIsNotInstanceof(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("a");
    } else if (typeof e === "string") {
      show(e);
    }
  }
}

export async function statementBranch(): Promise<number> {
  try {
    await save();
    return 1;
  } catch (e) {
    if (e instanceof NotFoundError) return 0;
  }
  return 2;
}

export async function memberClass(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof errors.Missing) {
      show("missing");
    }
  }
}

export async function tabs(): Promise<void> {
	try {
		await save();
	} catch (e) {
		if (e instanceof NotFoundError) {
			show("missing");
		}
	}
}

export async function longNames(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof PaymentRequiredErrorWithAVeryLongName) {
      show("a");
    } else if (e instanceof AnotherQuiteLongClassNameForErrors) {
      show("b");
    } else if (e instanceof ThirdVeryLongClassNameThatKeepsGoing) {
      show("c");
    }
  }
}

export async function lastChainCounts(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("a");
    }
    if (e instanceof AuthError) {
      show("b");
    }
  }
}

export async function chainOnOneLine(): Promise<void> {
  try {
    await save();
  } catch (e) { if (e instanceof NotFoundError) { show("a"); } }
}
