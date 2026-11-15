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

export class CancellationError extends Error {
  constructor(message = 'Run cancelled') {
    super(message);
    this.name = 'CancellationError';
  }
}

export function abortError(signal: AbortSignal, fallback = 'Run cancelled'): Error {
  return signal.reason instanceof Error ? signal.reason : new CancellationError(signal.reason ? String(signal.reason) : fallback);
}

/** Run fn with a timeout. ms <= 0 disables the timeout. */
export async function withTimeout<T>(what: string, ms: number, fn: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw abortError(signal);
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const races: Promise<T>[] = [Promise.resolve().then(fn)];
    if (ms > 0) {
      races.push(new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
      }));
    }
    if (signal) {
      races.push(new Promise<never>((_, reject) => {
        onAbort = () => reject(abortError(signal));
        signal.addEventListener('abort', onAbort!, { once: true });
      }));
    }
    return await Promise.race(races);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Delay that rejects promptly when cancelled. */
export async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError(signal!));
    };
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
