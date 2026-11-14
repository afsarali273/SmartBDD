import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BDDX_VERSION, explainNode, parseSpecFile, planToJSON, renderPlanMermaid, renderPlanText, selectScenarios } from '@bddx/core';
import { DEFAULTS, loadConfig, UsageError } from './config.js';
import { discoverSpecs, makeDataLoader, prepareRun, registerTypeScriptLoader, reportFromEvents, runBddx } from './run.js';
import type { Reporter } from '@bddx/reporters';

const HELP = `bddx ${BDDX_VERSION}

Usage:
  bddx [run] [paths...] [options]    Run scenarios (paths may be files, folders, globs, file:line)
  bddx list  [paths...] [options]    List selected scenarios with ids and tags, without running
  bddx snippets [paths...] [options] Print ready-to-paste code for every undefined step (runs nothing)
  bddx report <events.ndjson...>     Build reports from event files; several files are merged (later runs win)
             -f html:reports/report.html -f junit:reports/junit.xml
  bddx plan  [paths...] [options]    Show the execution plan: groups, dependencies, locks (runs nothing)
             --plan-format text|json|mermaid    --explain <scenario id>

Options:
  -c, --config <file>     Config file (default: bddx.config.{ts,mts,js,mjs,json} in cwd)
  -p, --profile <name>    Use a profile from the config
  -t, --tags <expr>       Tag expression, e.g. "@smoke and not @wip"
      --name <regex>      Only scenarios whose name matches
  -f, --format <spec>     Add a reporter: console | progress | junit[:file] | ndjson[:file] | cucumber-json[:file]  (repeatable)
  -D, --define k=v        Set ctx.params.k (repeatable)
      --dry-run           Match steps and report undefined ones, run nothing
      --fail-fast         Stop after the first failed scenario
      --no-strict         Pending/undefined steps do not fail the run
      --timeout <ms>      Default step/hook timeout
  -w, --workers <n>       Max scenarios running at once (default 1)
      --pool <kind>       inline (default: one process) | process (one Node process per worker)
  -s, --set <path=value>  Override any config value (repeatable), e.g. --set groups.checkout.mode=serial
      --log-level <level> Console logs: debug | info (default) | warn | error | silent
      --no-deps           Do not pull in dependencies of selected scenarios
  -r, --retry <n>         Retry failed scenarios up to n times (config retry.scenario; @retry:N per scenario)
      --fail-on-flaky     Fail the run when a scenario passed only after a retry
      --rerun-failed <f>  Run only scenarios that did not pass in events file <f> (+ their dependencies)
  -h, --help              Show help
  -v, --version           Show version

Exit codes: 0 passed, 1 failed, 2 usage/config/parse error.
`;

export async function main(argv: string[]): Promise<number> {
  const noStrict = argv.includes('--no-strict');
  const noDeps = argv.includes('--no-deps');
  const args = argv.filter((a) => a !== '--no-strict' && a !== '--no-deps');
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        config: { type: 'string', short: 'c' },
        profile: { type: 'string', short: 'p' },
        tags: { type: 'string', short: 't' },
        name: { type: 'string' },
        format: { type: 'string', short: 'f', multiple: true },
        define: { type: 'string', short: 'D', multiple: true },
        'dry-run': { type: 'boolean' },
        'fail-fast': { type: 'boolean' },
        timeout: { type: 'string' },
        workers: { type: 'string', short: 'w' },
        pool: { type: 'string' },
        set: { type: 'string', short: 's', multiple: true },
        retry: { type: 'string', short: 'r' },
        'fail-on-flaky': { type: 'boolean' },
        'rerun-failed': { type: 'string' },
        'log-level': { type: 'string' },
        'plan-format': { type: 'string' },
        explain: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${BDDX_VERSION}\n`);
    return 0;
  }

  let command = 'run';
  let paths = positionals;
  if (['run', 'list', 'snippets', 'plan', 'report'].includes(positionals[0] ?? '')) {
    command = positionals[0]!;
    paths = positionals.slice(1);
  }

  try {
    const params: Record<string, string> = {};
    for (const d of values.define ?? []) {
      const i = d.indexOf('=');
      if (i <= 0) throw new UsageError(`-D expects key=value, got "${d}"`);
      params[d.slice(0, i)] = d.slice(i + 1);
    }

    if (command === 'list') return await list(paths, values.config, values.profile, values.tags, values.name);
    if (command === 'snippets') return await snippets(paths, values.config, values.profile, values.tags, values.name);
    if (command === 'report') return await reportFromEvents(paths, values.format ?? []);
    const retry = values.retry !== undefined ? Number(values.retry) : undefined;
    if (retry !== undefined && (!Number.isInteger(retry) || retry < 0)) throw new UsageError(`--retry expects a whole number >= 0, got "${values.retry}"`);
    const workers = values.workers !== undefined ? Number(values.workers) : undefined;
    const logLevel = values['log-level'];
    if (logLevel !== undefined && !['debug', 'info', 'warn', 'error', 'silent'].includes(logLevel)) {
      throw new UsageError(`--log-level must be debug, info, warn, error or silent (got "${logLevel}")`);
    }
    const common = {
      ...(values.set ? { sets: values.set } : {}),
      ...(logLevel ? { logLevel: logLevel as 'debug' } : {}),
    };
    const pool = values.pool;
    if (pool !== undefined && pool !== 'inline' && pool !== 'process') throw new UsageError(`--pool must be inline or process (got "${pool}")`);
    if (workers !== undefined && (!Number.isInteger(workers) || workers < 1)) throw new UsageError(`--workers expects a positive integer, got "${values.workers}"`);
    if (command === 'plan') {
      const { plan } = await prepareRun({
        ...common,
        ...(values.config ? { config: values.config } : {}),
        ...(values.profile ? { profile: values.profile } : {}),
        ...(paths.length ? { paths } : {}),
        ...(values.tags ? { tags: values.tags } : {}),
        ...(values.name ? { name: values.name } : {}),
        ...(workers ? { workers } : {}),
        ...(noDeps ? { withDeps: false } : {}),
      });
      if (values.explain) process.stdout.write(`${explainNode(plan, values.explain)}\n`);
      else {
        const fmt = values['plan-format'] ?? 'text';
        if (fmt === 'json') process.stdout.write(`${JSON.stringify(planToJSON(plan), null, 2)}\n`);
        else if (fmt === 'mermaid') process.stdout.write(renderPlanMermaid(plan));
        else if (fmt === 'text') process.stdout.write(renderPlanText(plan));
        else throw new UsageError(`--plan-format must be text, json or mermaid (got "${fmt}")`);
      }
      return plan.errors.length ? 2 : 0;
    }

    const outcome = await runBddx({
      ...common,
      ...(values.config ? { config: values.config } : {}),
      ...(values.profile ? { profile: values.profile } : {}),
      ...(paths.length ? { paths } : {}),
      ...(values.tags ? { tags: values.tags } : {}),
      ...(values.name ? { name: values.name } : {}),
      ...(values.format ? { formats: values.format } : {}),
      ...(Object.keys(params).length ? { params } : {}),
      ...(values['dry-run'] ? { dryRun: true } : {}),
      ...(values['fail-fast'] ? { failFast: true } : {}),
      ...(noStrict ? { strict: false } : {}),
      ...(values.timeout ? { stepTimeoutMs: Number(values.timeout) } : {}),
      ...(workers ? { workers } : {}),
      ...(pool ? { pool: pool as 'inline' | 'process' } : {}),
      ...(noDeps ? { withDeps: false } : {}),
      ...(retry !== undefined ? { retry } : {}),
      ...(values['fail-on-flaky'] ? { failOnFlaky: true } : {}),
      ...(values['rerun-failed'] ? { rerunFailed: values['rerun-failed'] } : {}),
    });
    return outcome.exitCode;
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`bddx: ${err.message}\n`);
      return 2;
    }
    process.stderr.write(`bddx: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    return 2;
  }
}

async function list(paths: string[], config?: string, profile?: string, tags?: string, name?: string): Promise<number> {
  const cwd = process.cwd();
  await registerTypeScriptLoader();
  const loaded = await loadConfig(config, cwd, profile);
  const opts = loaded.options;
  const patterns = paths.length ? paths.map((p) => resolve(cwd, p)) : Array.isArray(opts.features) ? opts.features : [opts.features ?? DEFAULTS.features].flat();
  const { files, lines } = await discoverSpecs(loaded.rootDir, patterns);
  let errors = 0;
  const dataLoader = makeDataLoader(loaded.rootDir, opts, profile);
  for (const uri of files) {
    const spec = await parseSpecFile(await readFile(resolve(loaded.rootDir, uri), 'utf8'), uri, { dataLoader });
    for (const e of spec.errors) {
      errors++;
      process.stderr.write(`${e.uri}:${e.line ?? '?'} ${e.message}\n`);
    }
    const tagExpr = [opts.tags, tags].filter(Boolean).map((t) => `(${t})`).join(' and ');
    const selected = selectScenarios(spec.scenarios, {
      ...(tagExpr ? { tags: tagExpr } : {}),
      ...((name ?? opts.name) ? { name: (name ?? opts.name)! } : {}),
      ...(Object.keys(lines).length ? { lines } : {}),
    });
    for (const s of selected) {
      const tags = s.tags.map((t) => t.name).join(' ');
      process.stdout.write(`${s.id}\t${s.uri}:${s.line}${tags ? `\t${tags}` : ''}\n`);
    }
  }
  return errors ? 2 : 0;
}

async function snippets(paths: string[], config?: string, profile?: string, tags?: string, name?: string): Promise<number> {
  const found = new Map<string, string[]>();
  const collector: Reporter = {
    name: 'snippets',
    onEvent(e) {
      if (e.type === 'planReady') for (const sc of e.scenarios) for (const st of sc.steps) where.set(`${sc.id}|${st.id}`, `${sc.uri}:${st.line}`);
      if (e.type === 'stepFinished' && e.snippet) {
        const list = found.get(e.snippet) ?? [];
        list.push(where.get(`${e.scenarioId}|${e.stepId}`) ?? e.scenarioId);
        found.set(e.snippet, list);
      }
    },
  };
  const where = new Map<string, string>();
  const outcome = await runBddx({
    ...(config ? { config } : {}),
    ...(profile ? { profile } : {}),
    ...(paths.length ? { paths } : {}),
    ...(tags ? { tags } : {}),
    ...(name ? { name } : {}),
    dryRun: true,
    strict: false,
    reporters: [collector],
  });
  if (!found.size) {
    process.stdout.write('All steps are defined.\n');
    return outcome.exitCode;
  }
  process.stdout.write(`// ${found.size} undefined step pattern(s)\nimport { Given, When, Then, type DataTable } from '@bddx/runtime';\n\n`);
  for (const [snippet, locations] of found) {
    process.stdout.write(`// used at: ${[...new Set(locations)].join(', ')}\n${snippet}\n\n`);
  }
  return outcome.exitCode;
}
