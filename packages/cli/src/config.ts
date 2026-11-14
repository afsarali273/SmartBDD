import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReporterSpec } from '@bddx/reporters';

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
  return out;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
