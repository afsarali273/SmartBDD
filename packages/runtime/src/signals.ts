/** Thrown by ctx.pending(): marks the step (and scenario) 'pending'. */
export class PendingSignal extends Error {
  constructor(message = 'Step not implemented yet') {
    super(message);
    this.name = 'PendingSignal';
  }
}

/** Thrown by ctx.skip(): marks the scenario 'skipped' with the given reason. */
export class SkipSignal extends Error {
  constructor(readonly reason = 'skipped by step') {
    super(reason);
    this.name = 'SkipSignal';
  }
}

export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/** Run fn with a timeout. ms <= 0 disables the timeout. */
export async function withTimeout<T>(what: string, ms: number, fn: () => T | Promise<T>): Promise<T> {
  if (!ms || ms <= 0) return await fn();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
