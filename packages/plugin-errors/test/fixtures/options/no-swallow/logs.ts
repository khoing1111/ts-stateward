declare function save(): void;
declare function render(): void;
declare function logError(error: unknown): void;
declare const audit: { record(error: unknown): void };
declare const appLogger: { send(error: unknown): void };

export function viaHelper() {
  try {
    save();
  } catch (e) {
    logError(e);
  }
  render();
}

export function viaMethod() {
  try {
    save();
  } catch (e) {
    audit.record(e);
  }
  render();
}

export function viaLogger() {
  try {
    save();
  } catch (e) {
    appLogger.send(e);
  }
  render();
}

export function viaConsole() {
  try {
    save();
  } catch (e) {
    console.error(e);
  }
  render();
}
