declare function work(): void;
declare function cleanup(): void;
declare function report(error: unknown): void;
declare const raw: string;
declare const value: unknown;

export function safeCalls(): void {
  try {
    work();
  } finally {
    cleanup();
    report(Math.max(1, 2));
    report(String(value));
    report(raw.trim());
  }
}

export function nestedTryCatch(): void {
  try {
    work();
  } finally {
    try {
      report(JSON.parse(raw));
      new URL(raw);
      throw new Error("handled below");
    } catch (e) {
      report(e);
    }
  }
}

export function nestedTryCatchFinally(): void {
  try {
    work();
  } finally {
    try {
      cleanup();
    } catch (e) {
      report(e);
    } finally {
      cleanup();
    }
  }
}

export function notInFinally(): void {
  try {
    report(JSON.parse(raw));
    throw new Error("in the try");
  } catch (e) {
    report(JSON.parse(raw));
    report(e);
  }
}

export function insideAFunctionThatIsNotCalled(): void {
  try {
    work();
  } finally {
    const later = (): unknown => JSON.parse(raw);
    function other(): never {
      throw new Error("never called here");
    }
    report(later);
    report(other);
  }
}

export function localNames(): void {
  const JSON = { parse: (text: string): string => text };
  const decodeURI = (text: string): string => text;
  try {
    work();
  } finally {
    report(JSON.parse(raw));
    report(decodeURI(raw));
  }
}

function catchesItself(text: string): string {
  try {
    if (text === "") throw new Error("empty");
    return text;
  } catch {
    return "";
  }
}

function throwsInACallback(items: readonly string[]): void {
  items.forEach((item) => {
    if (item === "") throw new Error("empty");
  });
}

function doesNotThrow(text: string): string {
  return text.trim();
}

async function rejects(): Promise<void> {
  throw new Error("rejected");
}

export function calls(): void {
  try {
    work();
  } finally {
    report(catchesItself(raw));
    throwsInACallback([raw]);
    report(doesNotThrow(raw));
    // Not awaited: the rejection is not thrown here.
    void rejects().catch(report);
  }
}

export function noFinally(): void {
  try {
    work();
  } catch (e) {
    report(e);
  }
  report(JSON.parse(raw));
}
