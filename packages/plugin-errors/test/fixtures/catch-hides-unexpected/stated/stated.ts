class NotFoundError extends Error {}

declare function save(): Promise<void>;
declare function show(message: string): void;

// An empty last branch with a comment says the drop is on purpose.
export async function commentedElse(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("missing");
    } else {
      // other errors do not matter here: the page reloads in a moment
    }
  }
}

export async function commentedDefault(): Promise<void> {
  try {
    await save();
  } catch (e) {
    switch (true) {
      case e instanceof NotFoundError:
        show("missing");
        break;
      default:
      // dropped on purpose: the retry loop reports it
    }
  }
}

// A branch with nothing in it is a forgotten one.
export async function bareElse(): Promise<void> {
  try {
    await save();
  } catch (e) {
    if (e instanceof NotFoundError) {
      show("missing");
    } else {
    }
  }
}

export async function bareDefault(): Promise<void> {
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
