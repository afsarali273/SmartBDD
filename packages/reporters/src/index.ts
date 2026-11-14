import { consoleReporter } from './console.js';
import { junitReporter } from './junit.js';
import { ndjsonReporter } from './ndjson.js';
import { cucumberJsonReporter } from './cucumber-json.js';
import { htmlReporter } from './html.js';
import type { Reporter, ReporterFactory, ReporterOptions } from './types.js';

export * from './types.js';
export { consoleReporter, type ConsoleReporterOptions } from './console.js';
export { junitReporter } from './junit.js';
export { ndjsonReporter } from './ndjson.js';
export { cucumberJsonReporter } from './cucumber-json.js';
export { htmlReporter } from './html.js';
export { formatLogLine, LogIndex, type ReportLogLevel } from './logs.js';

/** Built-in reporters by name. Plugins (phase 6) will be able to add to this map. */
export const builtInReporters: Record<string, ReporterFactory> = {
  console: consoleReporter,
  pretty: (o) => consoleReporter({ ...o, style: 'pretty' }),
  progress: (o) => consoleReporter({ ...o, style: 'progress' }),
  junit: junitReporter,
  ndjson: ndjsonReporter,
  'cucumber-json': cucumberJsonReporter,
  json: cucumberJsonReporter,
  html: htmlReporter,
};

/**
 * Reporter spec forms:
 *   'console'                              -> defaults
 *   'junit:reports/junit.xml'              -> outputFile shorthand (CLI --format)
 *   ['junit', { outputFile: 'x.xml' }]     -> full options (config file)
 *   a Reporter object                      -> used as is (custom reporters)
 */
export type ReporterSpec = string | [string, ReporterOptions] | Reporter;

/** Reporters that print to the console (receive `logLevel`). */
export const CONSOLE_REPORTERS = ['console', 'pretty', 'progress'];

export function createReporter(spec: ReporterSpec): Reporter {
  if (typeof spec === 'object' && !Array.isArray(spec)) return spec;
  let name: string;
  let options: ReporterOptions = {};
  if (Array.isArray(spec)) {
    [name, options] = spec;
  } else {
    const i = spec.indexOf(':');
    name = i > 0 ? spec.slice(0, i) : spec;
    if (i > 0) options = { outputFile: spec.slice(i + 1) };
  }
  const factory = builtInReporters[name];
  if (!factory) {
    throw new Error(`Unknown reporter "${name}". Built-in reporters: ${Object.keys(builtInReporters).join(', ')}`);
  }
  return factory(options);
}

export function isReporter(x: unknown): x is Reporter {
  return typeof x === 'object' && x !== null && typeof (x as Reporter).onEvent === 'function';
}
