declare function load(): Promise<string>;
declare function render(text: string | undefined): void;
declare function save(): void;
declare const logger: { warn(error: unknown): void; trace(error: unknown): void };
declare const log: { anything(error: unknown): void };
declare const reporter: { debug(error: unknown): void; info(error: unknown): void };

export async function logsWithConsole(): Promise<void> {
  let text: string | undefined;
  try {
    text = await load();
  } catch (e) {
    console.error(e);
  }
  render(text);
}

export async function noBinding(): Promise<void> {
  try {
    save();
  } catch {
    console.warn("save failed");
  }
  render(undefined);
}

export async function loggerAndLog(): Promise<void> {
  try {
    save();
  } catch (e) {
    logger.warn(e);
    log.anything(e);
  }
  render(undefined);
}

export async function logMethodsOnAnyObject(): Promise<void> {
  try {
    save();
  } catch (e) {
    reporter.debug(e);
    reporter.info(e);
  }
  render(undefined);
}

export class Service {
  private readonly logger = logger;

  run(): string {
    try {
      save();
    } catch (e) {
      this.logger.trace(e);
    }
    return "done";
  }
}

export function insideAnIf(flag: boolean): void {
  if (flag) {
    try {
      save();
    } catch (e) {
      console.log(e);
    }
  }
  render(undefined);
}

export function insideALoop(items: readonly string[]): void {
  for (const item of items) {
    try {
      save();
    } catch (e) {
      console.error(item, e);
    }
    // Not the end of the loop's body: this runs as if the save had worked.
    render(item);
  }
}

export function nestedTry(): void {
  try {
    try {
      save();
    } catch (e) {
      console.error(e);
    }
    render(undefined);
  } finally {
    save();
  }
}

export function withAFinally(): void {
  try {
    save();
  } catch (e) {
    console.error(e);
  } finally {
    render(undefined);
  }
  render(undefined);
}
