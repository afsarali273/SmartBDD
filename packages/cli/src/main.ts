import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BDDX_VERSION, parseSpec, selectScenarios } from '@bddx/core';
import { DEFAULTS, loadConfig, UsageError } from './config.js';
import { discoverSpecs, registerTypeScriptLoader, runBddx } from './run.js';

const HELP = `bddx ${BDDX_VERSION}

Usage:
  bddx [run] [paths...] [options]    Run scenarios (paths may be files, folders, globs, file:line)
  bddx list  [paths...] [options]    List selected scenarios with ids and tags, without running

Options:
  -c, --config <file>     Config file (default: bddx.config.{ts,mts,js,mjs,json} in cwd)
  -p, --profile <name>    Use a profile from the config
  -t, --tags <expr>       Tag expression, e.g. "@smoke and not @wip"
      --name <regex>      Only scenarios whose name matches
  -f, --format <spec>     Add a reporter: console | progress | junit[:file] | ndjson[:file]  (repeatable)
  -D, --define k=v        Set ctx.params.k (repeatable)
      --dry-run           Match steps and report undefined ones, run nothing
      --fail-fast         Stop after the first failed scenario
      --no-strict         Pending/undefined steps do not fail the run
      --timeout <ms>      Default step/hook timeout
  -h, --help              Show help
  -v, --version           Show version

Exit codes: 0 passed, 1 failed, 2 usage/config/parse error.
`;

export async function main(argv: string[]): Promise<number> {
  const noStrict = argv.includes('--no-strict');
  const args = argv.filter((a) => a !== '--no-strict');
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
  if (positionals[0] === 'run' || positionals[0] === 'list') {
    command = positionals[0];
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

    const outcome = await runBddx({
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
  for (const uri of files) {
    const spec = parseSpec(await readFile(resolve(loaded.rootDir, uri), 'utf8'), uri);
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
