import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReporterSpec } from '@bddx/reporters';
import type { GroupConfig, GroupMode, LogLevel } from '@bddx/core';

/**
 * bddx.config.ts
 *
 *   import { defineConfig } from '@bddx/cli';
 *   export default defineConfig({
 *     features: 'features/**\/*.feature',
 *     steps: 'steps/**\/*.ts',
 *     reporters: ['console', ['junit', { outputFile: 'reports/junit.xml' }]],
 *     profiles: { ci: { reporters: ['progress', 'junit:reports/junit.xml'], failFast: true } },
 *   });
 *
 * All globs are relative to the config file's folder.
 * Phase 3 adds `groups`, phase 4 adds `retry`.
 */
export interface BddxOptions {
  /** Spec globs. Default: features/**\/*.feature and features/**\/*.feature.md */
  features?: string | string[];
  /** Support code globs (steps, hooks, parameter types). Default: steps/**\/*.{ts,js,mjs} and features/**\/*.steps.{ts,js,mjs} */
  steps?: string | string[];
  /** Tag expression applied to every run. ANDed with CLI --tags. */
  tags?: string;
  /** Regex on scenario name. */
  name?: string;
  reporters?: ReporterSpec[];
  /** Values exposed as ctx.params; CLI -D key=value overrides. */
  params?: Record<string, string>;
  /** Default timeout for steps and hooks (ms). Default 30000. 0 disables. */
  stepTimeoutMs?: number;
  failFast?: boolean;
  /** When true (default) pending/undefined/ambiguous fail the run. */
  strict?: boolean;
  /** Default Gherkin language. Default 'en'. */
  language?: string;
  /**
   * Folder for `@data:` files, relative to the config folder. Default: the config folder.
   * With --profile <p>, `<dataDir>/<p>/<file>` is tried first.
   */
  dataDir?: string;
  /** Max scenarios running at once (in-process). Default 1. CLI: --workers. */
  workers?: number;
  /**
   * Named groups: mode (parallel | serial | exclusive), workers cap, dependsOn other groups,
   * onDependencyFailure ('skip' | 'run'), priority, locks, match (tag expression for membership).
   * Scenarios also join groups with @group:<name>.
   */
  groups?: Record<string, GroupConfig>;
  /** How ungrouped scenarios run: 'parallel' | 'serial' | 'exclusive'. Shorthand for groups.default.mode. */
  defaultMode?: GroupMode;
  /**
   * Scenario retry: `{ scenario: 2, delay: '1s', on: ['TimeoutError', '/ECONN/'], failOnFlaky: false }`.
   * `on` entries match the error name exactly or the message as a substring; "/regex/" strings are regular expressions.
   * Per scenario: @retry:N / @noRetry. Per group: groups.x.scenarioRetry, groups.x.retry (whole group).
   */
  retry?: { scenario?: number; delay?: string | number; on?: string[]; failOnFlaky?: boolean };
  /** Time budget per scenario attempt, e.g. '2m'. Per scenario: @timeout:<duration>. */
  scenarioTimeout?: string | number;
  /** Console log level: 'debug' | 'info' (default) | 'warn' | 'error' | 'silent'. Events always contain every log; file reports have their own `logLevel` option. */
  logLevel?: LogLevel | 'silent';
}

/** Every top-level option `--set` may change. Keep in sync with BddxOptions. */
export const OPTION_KEYS = [
  'features', 'steps', 'tags', 'name', 'reporters', 'params', 'stepTimeoutMs', 'failFast', 'strict',
  'language', 'dataDir', 'workers', 'groups', 'defaultMode', 'logLevel', 'retry', 'scenarioTimeout',
] as const;

/**
 * Apply `--set path=value` overrides (repeatable), e.g.
 *   --set workers=6  --set groups.checkout.mode=serial  --set 'groups.api.dependsOn=["setup"]'
 *   --set params.baseUrl=https://qa.example.com
 * Values are parsed as JSON when possible (numbers, true/false, null, arrays, objects, "quoted strings"),
 * otherwise kept as plain strings. Unknown top-level keys are rejected (typo protection).
 */
export function applySetOverrides(options: BddxOptions, sets: readonly string[]): BddxOptions {
  const out = structuredClone(options) as Record<string, unknown>;
  for (const raw of sets) {
    const eq = raw.indexOf('=');
    if (eq <= 0) throw new UsageError(`--set expects path=value, got "${raw}"`);
    const path = raw.slice(0, eq).split('.').filter(Boolean);
    const valueText = raw.slice(eq + 1);
    if (!(OPTION_KEYS as readonly string[]).includes(path[0]!)) {
      throw new UsageError(`--set: unknown option "${path[0]}". Known: ${OPTION_KEYS.join(', ')}`);
    }
    let value: unknown = valueText;
    try {
      value = JSON.parse(valueText);
    } catch {
      /* plain string */
    }
    let cur = out;
    for (const key of path.slice(0, -1)) {
      const next = cur[key];
      if (next === undefined || next === null) cur[key] = {};
      else if (typeof next !== 'object' || Array.isArray(next)) {
        throw new UsageError(`--set ${raw}: "${key}" is not an object`);
      }
      cur = cur[key] as Record<string, unknown>;
    }
    cur[path.at(-1)!] = value;
  }
  return out as BddxOptions;
}

export interface BddxConfig extends BddxOptions {
  /** Named overrides selected with --profile. Merged over the base config. */
  profiles?: Record<string, BddxOptions>;
}

export function defineConfig(config: BddxConfig): BddxConfig {
  return config;
}

export const CONFIG_FILES = ['bddx.config.ts', 'bddx.config.mts', 'bddx.config.js', 'bddx.config.mjs', 'bddx.config.json'];

export const DEFAULTS = {
  features: ['features/**/*.feature', 'features/**/*.feature.md'],
  steps: ['steps/**/*.{ts,js,mjs}', 'features/**/*.steps.{ts,js,mjs}'],
};

export interface LoadedConfig {
  /** Folder that globs and URIs are relative to. */
  rootDir: string;
  configFile?: string;
  options: BddxOptions;
}

/** Find and load the config. Must be called after the TS loader is registered. */
export async function loadConfig(explicit: string | undefined, cwd: string, profile?: string): Promise<LoadedConfig> {
  let file: string | undefined;
  if (explicit) {
    file = resolve(cwd, explicit);
    if (!existsSync(file)) throw new UsageError(`Config file not found: ${file}`);
  } else {
    file = CONFIG_FILES.map((f) => resolve(cwd, f)).find((f) => existsSync(f));
  }
  if (!file) return { rootDir: cwd, options: {} };

  let config: BddxConfig;
  if (file.endsWith('.json')) {
    const { readFile } = await import('node:fs/promises');
    config = JSON.parse(await readFile(file, 'utf8')) as BddxConfig;
  } else {
    const mod = (await import(pathToFileURL(file).href)) as { default?: BddxConfig };
    config = mod.default ?? (mod as BddxConfig);
  }

  const { profiles, ...base } = config;
  let options: BddxOptions = base;
  if (profile) {
    const p = profiles?.[profile];
    if (!p) throw new UsageError(`Profile "${profile}" not found in ${file}. Available: ${Object.keys(profiles ?? {}).join(', ') || 'none'}`);
    options = mergeOptions(base, p);
  }
  return { rootDir: dirname(file), configFile: file, options };
}

/** Later wins; `params` are merged key by key; `tags` are ANDed. */
export function mergeOptions(a: BddxOptions, b: BddxOptions): BddxOptions {
  const out: BddxOptions = { ...a, ...b };
  if (a.params || b.params) out.params = { ...a.params, ...b.params };
  if (a.tags && b.tags) out.tags = `(${a.tags}) and (${b.tags})`;
  if (a.groups || b.groups) out.groups = { ...a.groups, ...b.groups };
  if (a.retry || b.retry) out.retry = { ...a.retry, ...b.retry };
  return out;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
