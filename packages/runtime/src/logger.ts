/**
 * Levelled logging.
 *
 *   ctx.log('plain info');                 // same as ctx.log.info
 *   ctx.log.debug('payload', { id: 1 });   // optional structured data
 *   ctx.log.warn('slow response');
 *   ctx.log.error('cleanup failed', err);
 *
 *   import { log } from '@bddx/runtime';   // anywhere (page objects, API clients, helpers):
 *   log.info('clicked save');              // attributed to the scenario/step currently running
 *
 * Every call becomes a `log` event (all levels, always), so NDJSON/HTML reports have everything.
 * The console reporter shows logs at or above `logLevel` (default 'warn'; CLI --log-level).
 *
 * The global `log` finds the current scenario through AsyncLocalStorage, so it works across `await`
 * and with concurrent scenarios. Outside any scenario/hook it logs at run level.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogLevel } from '@bddx/core';

export type LogFn = (message: string, data?: unknown) => void;

export interface Logger extends LogFn {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

export type LogSink = (level: LogLevel, message: string, data?: unknown) => void;

/** Errors are not JSON-friendly: keep their useful parts. */
function normaliseData(data: unknown): unknown {
  if (data instanceof Error) return { name: data.name, message: data.message, stack: data.stack };
  return data;
}

export function createLogger(sink: LogSink): Logger {
  const at = (level: LogLevel): LogFn => (message, data) =>
    sink(level, String(message), data === undefined ? undefined : normaliseData(data));
  const logger = at('info') as Logger;
  logger.debug = at('debug');
  logger.info = at('info');
  logger.warn = at('warn');
  logger.error = at('error');
  return logger;
}

const current = new AsyncLocalStorage<Logger>();
let fallback: Logger | undefined;

/** Run `fn` with `logger` as the target of the global `log`. */
export function withLogger<T>(logger: Logger, fn: () => T): T {
  return current.run(logger, fn);
}

/** Set the run-level logger used when no scenario/hook is active (the executor does this). */
export function setFallbackLogger(logger: Logger | undefined): void {
  fallback = logger;
}

const route =
  (level: LogLevel): LogFn =>
  (message, data) => {
    const target = current.getStore() ?? fallback;
    if (target) target[level](message, data);
    else if (level === 'warn' || level === 'error') process.stderr.write(`[${level}] ${message}\n`);
  };

/** Global logger: attributed to whatever scenario/step/hook is running in this async context. */
export const log: Logger = Object.assign(route('info'), {
  debug: route('debug'),
  info: route('info'),
  warn: route('warn'),
  error: route('error'),
});
