import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { glob } from 'tinyglobby';
import {
  EventBus,
  buildPlan,
  idsToRerun,
  mergeEventStreams,
  parseDuration,
  parseNdjson,
  createFileDataLoader,
  type LogLevel,
  type Plan,
  parsePathWithLines,
  parseSpecFile,
  specFileGlobSuffix,
  type DataLoader,
  selectScenarios,
  type ParsedSpec,
  type RunSummary,
  type ScenarioInstance,
} from '@bddx/core';
import { Executor, getGlobalRegistry, type RetryOptions } from '@bddx/runtime';
import { CONSOLE_REPORTERS, createReporter, type Reporter, type ReporterSpec } from '@bddx/reporters';
import { applySetOverrides, DEFAULTS, loadConfig, mergeOptions, UsageError, type BddxOptions } from './config.js';

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
  /** Max concurrent scenarios (overrides config `workers`). */
  workers?: number;
  /** Pull in dependencies of selected scenarios (default true). */
  withDeps?: boolean;
  /** `--set path=value` overrides, applied after the profile and before the other CLI flags. */
  sets?: string[];
  /** Console log level (overrides config `logLevel`). */
  logLevel?: LogLevel;
  /** Extra attempts for failed scenarios (overrides config retry.scenario). */
  retry?: number;
  failOnFlaky?: boolean;
  /** NDJSON events of an earlier run: run only scenarios that did not pass there (plus their dependencies). */
  rerunFailed?: string;
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
      globs.push(toPosix(relative(rootDir, abs) || '.') + `/**/*.${specFileGlobSuffix()}`);
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
export interface PreparedRun {
  rootDir: string;
  /** Set with --rerun-failed: the ids that did not pass in the earlier run. */
  rerunIds?: string[] | undefined;
  opts: BddxOptions;
  specs: ParsedSpec[];
  all: ScenarioInstance[];
  selected: ScenarioInstance[];
  plan: Plan;
}

/** Config + discovery + parsing + selection + plan. Shared by `run`, `plan` and `list`. */
export async function prepareRun(req: RunRequest = {}): Promise<PreparedRun> {
  const cwd = req.cwd ?? process.cwd();
  await registerTypeScriptLoader();
  const loaded = await loadConfig(req.config, cwd, req.profile);
  const rootDir = loaded.rootDir;

  let opts: BddxOptions = req.sets?.length ? applySetOverrides(loaded.options, req.sets) : loaded.options;
  const cliOverrides: BddxOptions = {};
  if (req.logLevel) cliOverrides.logLevel = req.logLevel;
  if (req.retry !== undefined || req.failOnFlaky !== undefined) {
    cliOverrides.retry = {
      ...(req.retry !== undefined ? { scenario: req.retry } : {}),
      ...(req.failOnFlaky !== undefined ? { failOnFlaky: req.failOnFlaky } : {}),
    };
  }
  if (req.tags) cliOverrides.tags = req.tags;
  if (req.name) cliOverrides.name = req.name;
  if (req.params) cliOverrides.params = req.params;
  if (req.failFast !== undefined) cliOverrides.failFast = req.failFast;
  if (req.strict !== undefined) cliOverrides.strict = req.strict;
  if (req.stepTimeoutMs !== undefined) cliOverrides.stepTimeoutMs = req.stepTimeoutMs;
  if (req.workers !== undefined) cliOverrides.workers = req.workers;
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

  // Dependencies may live in files outside the selected paths: parse every configured spec for resolution.
  const allFiles = req.paths?.length
    ? [...new Set([...files, ...(await discoverSpecs(rootDir, asArray(opts.features ?? DEFAULTS.features))).files])]
    : files;
  const dataLoader = makeDataLoader(rootDir, opts, req.profile);
  const specs: ParsedSpec[] = [];
  for (const uri of allFiles) {
    const source = await readFile(resolve(rootDir, uri), 'utf8');
    specs.push(await parseSpecFile(source, uri, { dataLoader, ...(opts.language ? { language: opts.language } : {}) }));
  }
  const inPaths = new Set(files);
  const all = specs.flatMap((s) => s.scenarios);
  let rerunIds: string[] | undefined;
  if (req.rerunFailed) {
    const file = resolve(cwd, req.rerunFailed);
    const text = await readFile(file, 'utf8').catch(() => {
      throw new UsageError(`--rerun-failed: cannot read ${file}`);
    });
    rerunIds = idsToRerun(parseNdjson(text));
  }
  const selected = selectScenarios(
    all.filter((s) => inPaths.has(s.uri)),
    {
      ...(opts.tags ? { tags: opts.tags } : {}),
      ...(opts.name ? { name: opts.name } : {}),
      ...(Object.keys(lines).length ? { lines } : {}),
      ...(rerunIds ? { ids: rerunIds } : {}),
    },
  );
  const plan = buildPlan(all, selected, {
    workers: opts.workers ?? 1,
    withDeps: req.withDeps ?? true,
    ...(opts.groups ? { groups: opts.groups } : {}),
    ...(opts.defaultMode ? { defaultMode: opts.defaultMode } : {}),
  });
  cliDebug(opts.logLevel, [
    `config: ${loaded.configFile ?? '(none, defaults)'}${req.profile ? `, profile ${req.profile}` : ''}`,
    ...(req.sets?.length ? [`--set: ${req.sets.join(' ')}`] : []),
    `specs: ${files.length} selected file(s), ${allFiles.length} parsed; scenarios: ${all.length} total, ${selected.length} selected`,
    `plan: ${plan.nodes.length} node(s), workers=${plan.workers}${opts.defaultMode ? `, defaultMode=${opts.defaultMode}` : ''}`,
    ...(rerunIds ? [`rerun: ${rerunIds.length} scenario(s) did not pass in ${req.rerunFailed}`] : []),
  ]);
  return { rootDir, opts, rerunIds, specs: specs.filter((s) => inPaths.has(s.uri) || plan.nodes.some((n) => n.scenario.uri === s.uri)), all, selected, plan };
}

/** The whole `bddx run` pipeline, usable programmatically. */
export async function runBddx(req: RunRequest = {}): Promise<RunOutcome> {
  const { rootDir, opts, specs, plan, rerunIds } = await prepareRun(req);
  if (rerunIds && !plan.nodes.length) {
    process.stdout.write(`Nothing to rerun: every scenario passed in ${req.rerunFailed}.\n`);
    return { success: true, exitCode: 0, scenarios: [] };
  }
  if (plan.errors.length) {
    process.stderr.write(`bddx: invalid execution plan:\n${plan.errors.map((e) => `  ${e.uri ? `${e.uri}:${e.line} ` : ''}${e.message}`).join('\n')}\n`);
    return { success: false, exitCode: 2, scenarios: plan.nodes.map((n) => n.scenario) };
  }

  // Support code: steps, hooks, parameter types. They register on the global registry.
  const registry = getGlobalRegistry();
  const supportFiles = await discoverSupportFiles(rootDir, asArray(opts.steps ?? DEFAULTS.steps));
  for (const f of supportFiles) await import(pathToFileURL(f).href);
  cliDebug(opts.logLevel, [`support code: ${supportFiles.length} file(s), ${registry.stepDefinitions.length} step(s), ${registry.hookDefinitions.length} hook(s)`]);
  if (opts.stepTimeoutMs !== undefined) registry.defaultTimeoutMs = opts.stepTimeoutMs;

  const reporters =
    req.reporters ??
    [...(opts.reporters ?? ['console']), ...(req.formats ?? [])].map((spec) => createReporter(withLogLevel(resolveOutputFile(spec, rootDir), opts.logLevel)));
  const bus = new EventBus();
  for (const r of reporters) bus.on((e) => r.onEvent(e));

  const hasParseErrors = specs.some((s) => s.errors.length > 0);
  const result = await new Executor({
    registry,
    bus,
    specs,
    plan,
    dryRun: !!req.dryRun,
    failFast: !!opts.failFast,
    strict: opts.strict ?? true,
    params: opts.params ?? {},
    ...(opts.retry ? { retry: toRetryOptions(opts.retry) } : {}),
    ...(opts.scenarioTimeout !== undefined ? { scenarioTimeoutMs: toMs(opts.scenarioTimeout, 'scenarioTimeout') } : {}),
  }).execute(plan.nodes.map((n) => n.scenario));

  const listenerErrors = await bus.flush();
  for (const r of reporters) await r.close?.();
  for (const e of listenerErrors) process.stderr.write(`Reporter error: ${e instanceof Error ? e.stack : String(e)}\n`);

  const exitCode: 0 | 1 | 2 = hasParseErrors ? 2 : result.success ? 0 : 1;
  return { success: result.success && !hasParseErrors, summary: result.summary, exitCode, scenarios: plan.nodes.map((n) => n.scenario) };
}

export function makeDataLoader(rootDir: string, opts: BddxOptions, profile?: string): DataLoader {
  return createFileDataLoader({
    rootDir,
    dataDir: resolve(rootDir, opts.dataDir ?? '.'),
    ...(profile ? { profile } : {}),
  });
}

/** Console reporters get the effective log level unless their own options set one. */
function withLogLevel(spec: ReporterSpec, level: BddxOptions['logLevel']): ReporterSpec {
  if (!level) return spec;
  if (typeof spec === 'string' && CONSOLE_REPORTERS.includes(spec)) return [spec, { logLevel: level }];
  if (Array.isArray(spec) && CONSOLE_REPORTERS.includes(spec[0]) && spec[1]['logLevel'] === undefined) {
    return [spec[0], { ...spec[1], logLevel: level }];
  }
  return spec;
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

function toMs(v: string | number, name: string): number {
  if (typeof v === 'number') return v;
  try {
    return parseDuration(v);
  } catch (e) {
    throw new UsageError(`${name}: ${(e as Error).message}`);
  }
}

function toRetryOptions(r: NonNullable<BddxOptions['retry']>): RetryOptions {
  const out: RetryOptions = {};
  if (r.scenario !== undefined) {
    if (!Number.isInteger(r.scenario) || r.scenario < 0) throw new UsageError(`retry.scenario must be a whole number >= 0`);
    out.scenario = r.scenario;
  }
  if (r.delay !== undefined) out.delayMs = toMs(r.delay, 'retry.delay');
  if (r.on) out.on = r.on.map((x) => (/^\/.+\/[a-z]*$/.test(x) ? new RegExp(x.slice(1, x.lastIndexOf('/')), x.slice(x.lastIndexOf('/') + 1)) : x));
  if (r.failOnFlaky !== undefined) out.failOnFlaky = r.failOnFlaky;
  return out;
}

/** Replay one or more NDJSON event files (merged: later runs win) into reporters. */
export async function reportFromEvents(files: string[], formats: ReporterSpec[], cwd = process.cwd()): Promise<0 | 1 | 2> {
  if (!files.length) throw new UsageError('bddx report: give at least one NDJSON events file');
  const streams = [];
  for (const f of files) {
    const text = await readFile(resolve(cwd, f), 'utf8').catch(() => {
      throw new UsageError(`bddx report: cannot read ${f}`);
    });
    streams.push(parseNdjson(text));
  }
  const merged = mergeEventStreams(streams);
  const reporters = (formats.length ? formats : ['console']).map((spec) => createReporter(resolveOutputFile(spec, cwd)));
  for (const e of merged) for (const r of reporters) await r.onEvent(e);
  for (const r of reporters) await r.close?.();
  const end = merged.at(-1);
  return end?.type === 'runFinished' && end.success ? 0 : 1;
}

/** CLI-side diagnostics (before the event bus exists) go to stderr at --log-level debug. */
function cliDebug(level: BddxOptions['logLevel'], lines: string[]): void {
  if (level !== 'debug') return;
  for (const l of lines) process.stderr.write(`[bddx:debug] ${l}\n`);
}

function asArray(x: string | string[]): string[] {
  return Array.isArray(x) ? x : [x];
}
