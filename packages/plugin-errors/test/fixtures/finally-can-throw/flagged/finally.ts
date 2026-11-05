declare function work(): void;
declare function cleanup(): void;
declare function report(error: unknown): void;
declare const raw: string;
declare const value: unknown;

export function parse(): void {
  try {
    work();
  } finally {
    const state: unknown = JSON.parse(raw);
    cleanup();
    report(state);
  }
}

export function stringify(): void {
  try {
    work();
  } finally {
    report(JSON.stringify(value));
  }
}

export function newUrl(): void {
  try {
    work();
  } finally {
    report(new URL(raw));
  }
}

export function decoders(): void {
  try {
    work();
  } finally {
    report(decodeURIComponent(raw));
  }
  try {
    work();
  } finally {
    report(decodeURI(raw));
  }
}

export function cloneAndAtob(): void {
  try {
    work();
  } finally {
    report(structuredClone(value));
  }
  try {
    work();
  } finally {
    report(atob(raw));
  }
}

export function throwsDirectly(): void {
  try {
    work();
  } finally {
    if (raw === "") throw new Error("empty");
  }
}

function mustHave(text: string): string {
  if (text === "") throw new Error("empty");
  return text;
}

const mustBeKnown = (text: string): string => {
  if (text !== "a") {
    throw new Error("unknown");
  }
  return text;
};

async function mustSave(): Promise<void> {
  throw new Error("cannot save");
}

function guardedThenRethrows(): void {
  try {
    work();
  } catch (e) {
    throw e;
  }
}

class Store {
  close(): void {
    throw new Error("closed");
  }

  run(): void {
    try {
      work();
    } finally {
      this.close();
    }
  }
}

export function sameFileFunctions(): void {
  try {
    work();
  } finally {
    report(mustHave(raw));
  }
  try {
    work();
  } finally {
    report(mustBeKnown(raw));
  }
  try {
    work();
  } finally {
    guardedThenRethrows();
  }
}

export async function awaitedAsync(): Promise<void> {
  try {
    work();
  } finally {
    await mustSave();
  }
}

export function insideTheCatchOfANestedTry(): void {
  try {
    work();
  } finally {
    try {
      cleanup();
    } catch {
      JSON.parse(raw);
    }
  }
}

export function insideANestedFinally(): void {
  try {
    work();
  } finally {
    try {
      cleanup();
    } finally {
      JSON.parse(raw);
    }
  }
}

export function onlyTheFirstIsReported(): void {
  try {
    work();
  } finally {
    JSON.parse(raw);
    new URL(raw);
  }
}

export function longCallee(): void {
  const someVeryLongFunctionNameForTheTest = (): void => {
    throw new Error("x");
  };
  try {
    work();
  } finally {
    someVeryLongFunctionNameForTheTest();
  }
}

export function inABranch(flag: boolean): void {
  try {
    work();
  } finally {
    if (flag) {
      cleanup();
    } else {
      JSON.parse(raw);
    }
  }
}
