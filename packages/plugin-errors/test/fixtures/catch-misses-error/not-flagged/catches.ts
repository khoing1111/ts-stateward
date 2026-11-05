import { limited, mixed, send } from "./api.js";
import { AuthError, HttpError, RateLimitError } from "./errors.js";

function show(text: string): void {
  console.log(text);
}

export async function everyClass(): Promise<void> {
  try {
    await send("hi");
  } catch (e) {
    if (e instanceof AuthError) {
      show("log in");
    } else if (e instanceof HttpError || e instanceof TypeError) {
      show("network");
    } else {
      show("other");
    }
  }
}

export async function rethrowsRest(): Promise<void> {
  try {
    await send("hi");
  } catch (e) {
    if (e instanceof AuthError) {
      show("log in");
    } else {
      throw e;
    }
  }
}

export async function wrapsRest(): Promise<void> {
  try {
    await send("hi");
  } catch (e) {
    if (e instanceof AuthError) {
      show("log in");
      return;
    }
    throw new Error("send failed", { cause: e });
  }
}

export async function baseClass(): Promise<void> {
  try {
    await send("hi");
  } catch (e) {
    if (e instanceof Error) {
      show(e.message);
    }
  }
}

export function onlyUnknown(run: () => void): void {
  try {
    run();
  } catch (e) {
    if (e instanceof AuthError) {
      show("log in");
    } else {
      show("other");
    }
  }
}

export async function noChain(): Promise<void> {
  try {
    await send("hi");
  } catch (e) {
    show(String(e));
  }
}

export function testNotRead(): void {
  try {
    limited();
  } catch (e) {
    if (e instanceof RateLimitError && e.retry) {
      show("retry");
    } else if (e instanceof AuthError) {
      show("log in");
    } else {
      show("other");
    }
  }
}

export async function unawaited(): Promise<void> {
  try {
    return send("hi");
  } catch (e) {
    if (e instanceof AuthError) {
      show("log in");
    } else {
      show("other");
    }
  }
}

export function openChain(): void {
  try {
    mixed();
  } catch (e) {
    if (e instanceof AuthError) {
      show("log in");
    } else {
      show("other");
    }
  }
}

declare function setError(e: unknown): void;

export async function tailUsesError(): Promise<void> {
  try {
    await send("hi");
  } catch (e) {
    if (e instanceof AuthError) return;
    setError(e);
  }
}

export async function elseUsesError(): Promise<void> {
  try {
    await send("hi");
  } catch (e) {
    if (e instanceof AuthError) {
      show("log in");
    } else {
      show(String(e));
    }
  }
}

/** @throws {AuthError} */
function later(): Promise<void> {
  return send("hi");
}

export function rejectsNotThrows(): void {
  try {
    void later().then(show);
  } catch (e) {
    if (e instanceof RateLimitError) {
      show("retry");
    } else {
      show("other");
    }
  }
}

export function passedOnInit(init: RequestInit): Promise<void> {
  return (async () => {
    try {
      await fetch("/x", init);
    } catch (e) {
      if (e instanceof TypeError) {
        show("network");
      } else {
        show("other");
      }
    }
  })();
}
