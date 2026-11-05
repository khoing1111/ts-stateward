/** The moves of a work-done progress that the server makes. */
export type ProgressReporter = {
  begin(title: string): void;
  /** Where the work stands: a short message and a percentage from 0 to 100. */
  report(message: string, percentage: number): void;
  done(): void;
};

/** What a client that shows no progress gets: every move does nothing. */
export const SILENT_PROGRESS: ProgressReporter = {
  begin: () => undefined,
  report: () => undefined,
  done: () => undefined,
};

/**
 * Runs `work` inside a progress titled `title`; `work` reports on it. `begin` is always followed by `done`, also when
 * `work` throws (the error then goes on to the caller). A progress that cannot be opened (the
 * client refused it) does not stop the work.
 */
export async function withProgress<T>(
  open: () => Promise<ProgressReporter>,
  title: string,
  work: (reporter: ProgressReporter) => Promise<T>,
): Promise<T> {
  const reporter = await open().catch(() => undefined);
  reporter?.begin(title);
  try {
    return await work(reporter ?? SILENT_PROGRESS);
  } finally {
    reporter?.done();
  }
}
