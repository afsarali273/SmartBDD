import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { glob } from 'tinyglobby';
import {
  EventBus,
  parsePathWithLines,
  parseSpec,
  selectScenarios,
  type ParsedSpec,
  type RunSummary,
  type ScenarioInstance,
} from '@bddx/core';
import { Executor, getGlobalRegistry } from '@bddx/runtime';
import { createReporter, type Reporter, type ReporterSpec } from '@bddx/reporters';
import { DEFAULTS, loadConfig, mergeOptions, UsageError, type BddxOptions } from './config.js';

export interface RunRequest {
  cwd?: string;
  config?: string;
  profile?: string;
  /** Feature paths/globs, optionally with `:line` suffixes. Replace config `features` when given. */
  paths?: string[];
  tags?: string;
  name?: string;
  dryRun?: boolean;
  failFast?: boolean;
  strict?: boolean;
  /** Extra reporters (added to config reporters). */
  formats?: ReporterSpec[];
  params?: Record<string, string>;
  stepTimeoutMs?: number;
  /** Override all reporters (programmatic use / tests). */
  reporters?: Reporter[];
}

export interface RunOutcome {
  success: boolean;
  summary?: RunSummary;
  /** 0 = passed, 1 = scenarios failed, 2 = usage/config/parse error. */
  exitCode: 0 | 1 | 2;
  scenarios: ScenarioInstance[];
}

let loaderRegistered = false;

/** Lets Node import .ts config and step files (via tsx). Idempotent. */
export async function registerTypeScriptLoader(): Promise<void> {
  if (loaderRegistered) return;
  const { register } = await import('tsx/esm/api');
  register();
  loaderRegistered = true;
}

const toPosix = (p: string) => p.split('\\').join('/');

/** Resolve feature paths/globs into files + per-file line filters. URIs are relative to rootDir. */
export async function discoverSpecs(rootDir: string, patterns: string[]): Promise<{ files: string[]; lines: Record<string, number[]> }> {
  const lines: Record<string, number[]> = {};
  const globs: string[] = [];
  for (const raw of patterns) {
    const { path, lines: ls } = parsePathWithLines(raw);
    const abs = isAbsolute(path) ? path : resolve(rootDir, path);
    const st = await stat(abs).catch(() => undefined);
    if (st?.isDirectory()) {
      globs.push(toPosix(relative(rootDir, abs) || '.') + '/**/*.{feature,feature.md}');
    } else if (st?.isFile()) {
      const uri = toPosix(relative(rootDir, abs));
      globs.push(uri);
      if (ls.length) lines[uri] = [...(lines[uri] ?? []), ...ls];
    } else {
      globs.push(toPosix(path));
    }
  }
  const files = (await glob(globs, { cwd: rootDir, absolute: false, dot: false })).map(toPosix).sort();
  return { files, lines };
}

export async function discoverSupportFiles(rootDir: string, patterns: string[]): Promise<string[]> {
  const files = await glob(patterns, { cwd: rootDir, absolute: true, ignore: ['**/node_modules/**', '**/*.d.ts'] });
  return files.sort();
}

/** The whole `bddx run` pipeline, usable programmatically. */
export async function runBddx(req: RunRequest = {}): Promise<RunOutcome> {
  const cwd = req.cwd ?? process.cwd();
  await registerTypeScriptLoader();
  const loaded = await loadConfig(req.config, cwd, req.profile);
  const rootDir = loaded.rootDir;

  let opts: BddxOptions = loaded.options;
  const cliOverrides: BddxOptions = {};
  if (req.tags) cliOverrides.tags = req.tags;
  if (req.name) cliOverrides.name = req.name;
  if (req.params) cliOverrides.params = req.params;
  if (req.failFast !== undefined) cliOverrides.failFast = req.failFast;
  if (req.strict !== undefined) cliOverrides.strict = req.strict;
  if (req.stepTimeoutMs !== undefined) cliOverrides.stepTimeoutMs = req.stepTimeoutMs;
  opts = mergeOptions(opts, cliOverrides);

  // CLI paths are relative to cwd; config globs are relative to rootDir.
  const featurePatterns = req.paths?.length
    ? req.paths.map((p) => {
        const { path, lines } = parsePathWithLines(p);
        const abs = resolve(cwd, path);
        return toPosix(relative(rootDir, abs)) + (lines.length ? `:${lines.join(':')}` : '');
      })
    : asArray(opts.features ?? DEFAULTS.features);
  const { files, lines } = await discoverSpecs(rootDir, featurePatterns);
  if (!files.length) throw new UsageError(`No spec files found for: ${featurePatterns.join(', ')} (root: ${rootDir})`);

  const specs: ParsedSpec[] = [];
  for (const uri of files) {
    const source = await readFile(resolve(rootDir, uri), 'utf8');
    specs.push(parseSpec(source, uri, { ...(opts.language ? { language: opts.language } : {}) }));
  }
  const all = specs.flatMap((s) => s.scenarios);
  const selected = selectScenarios(all, {
    ...(opts.tags ? { tags: opts.tags } : {}),
    ...(opts.name ? { name: opts.name } : {}),
    ...(Object.keys(lines).length ? { lines } : {}),
  });

  // Support code: steps, hooks, parameter types. They register on the global registry.
  const registry = getGlobalRegistry();
  if (opts.stepTimeoutMs !== undefined) registry.defaultTimeoutMs = opts.stepTimeoutMs;
  const supportFiles = await discoverSupportFiles(rootDir, asArray(opts.steps ?? DEFAULTS.steps));
  for (const f of supportFiles) await import(pathToFileURL(f).href);
  if (opts.stepTimeoutMs !== undefined) registry.defaultTimeoutMs = opts.stepTimeoutMs;

  const reporters =
    req.reporters ?? [...(opts.reporters ?? ['console']), ...(req.formats ?? [])].map((spec) => createReporter(resolveOutputFile(spec, rootDir)));
  const bus = new EventBus();
  for (const r of reporters) bus.on((e) => r.onEvent(e));

  const hasParseErrors = specs.some((s) => s.errors.length > 0);
  const result = await new Executor({
    registry,
    bus,
    specs,
    dryRun: !!req.dryRun,
    failFast: !!opts.failFast,
    strict: opts.strict ?? true,
    params: opts.params ?? {},
  }).execute(selected);

  const listenerErrors = await bus.flush();
  for (const r of reporters) await r.close?.();
  for (const e of listenerErrors) process.stderr.write(`Reporter error: ${e instanceof Error ? e.stack : String(e)}\n`);

  const exitCode: 0 | 1 | 2 = hasParseErrors ? 2 : result.success ? 0 : 1;
  return { success: result.success && !hasParseErrors, summary: result.summary, exitCode, scenarios: selected };
}

/** Report paths in the config are relative to the config folder, not to the shell's cwd. */
function resolveOutputFile(spec: ReporterSpec, rootDir: string): ReporterSpec {
  if (typeof spec === 'string') {
    const i = spec.indexOf(':');
    return i > 0 ? [spec.slice(0, i), { outputFile: resolve(rootDir, spec.slice(i + 1)) }] : spec;
  }
  if (Array.isArray(spec) && typeof spec[1]['outputFile'] === 'string') {
    return [spec[0], { ...spec[1], outputFile: resolve(rootDir, spec[1]['outputFile']) }];
  }
  return spec;
}

function asArray(x: string | string[]): string[] {
  return Array.isArray(x) ? x : [x];
}
