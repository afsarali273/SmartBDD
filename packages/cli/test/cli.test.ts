/**
 * End-to-end tests of the built CLI (packages/cli/dist). Run `npm run build` first;
 * these tests are skipped when the build output is missing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const project = fileURLToPath(new URL('./fixtures/project/', import.meta.url));
const built = existsSync(bin);

const dataProject = fileURLToPath(new URL('./fixtures/data-project/', import.meta.url));
const orchestration = fileURLToPath(new URL('../../../examples/orchestration/', import.meta.url));

function bddx(...args: string[]) {
  return bddxIn(project, ...args);
}

function bddxIn(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe.skipIf(!built)('bddx CLI (built)', () => {
  it('runs the project: exit 1 with failures, @wip excluded by config', () => {
    const r = bddx('run');
    expect(r.code).toBe(1);
    expect(r.out).toContain('✔ passes');
    expect(r.out).toContain('✘ fails');
    expect(r.out).toContain('? undefined');
    expect(r.out).not.toContain('work in progress');
    expect(r.out).toContain('3 scenarios (1 passed, 1 failed, 1 undefined)');
  });

  it('profile + -D params can make it green', () => {
    expect(bddx('--profile', 'green').code).toBe(0);
    const r = bddx('-t', 'not @green', '-D', 'env=prod', '--name', '^fails$');
    expect(r.code).toBe(0);
    expect(r.out).toContain('1 scenario (1 passed)');
  });

  it('selects by file:line', () => {
    const r = bddx('features/mixed.feature:7');
    expect(r.out).toContain('1 scenario (1 failed)');
  });

  it('--dry-run reports undefined steps without executing', () => {
    const r = bddx('--dry-run', '--no-strict');
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Given('something nobody wrote', async (ctx) => {`);
  });

  it('snippets prints code for undefined steps with their locations', () => {
    const r = bddx('snippets');
    expect(r.code).toBe(0);
    expect(r.out).toContain('// 1 undefined step pattern(s)');
    expect(r.out).toContain('// used at: features/mixed.feature:11');
    expect(r.out).toContain(`Given('something nobody wrote', async (ctx) => {`);
  });

  it('list prints ids and tags', () => {
    const r = bddx('list');
    expect(r.code).toBe(0);
    expect(r.out.trim().split('\n')).toEqual([
      'features/mixed.feature::passes\tfeatures/mixed.feature:4\t@green',
      'features/mixed.feature::fails\tfeatures/mixed.feature:7',
      'features/mixed.feature::undefined\tfeatures/mixed.feature:10',
    ]);
  });

  it('writes NDJSON and JUnit via --format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bddx-cli-'));
    bddx('-f', `ndjson:${join(dir, 'e.ndjson')}`, '-f', `junit:${join(dir, 'j.xml')}`);
    const lines = readFileSync(join(dir, 'e.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string });
    expect(lines[0]!.type).toBe('runStarted');
    expect(lines.at(-1)!.type).toBe('runFinished');
    expect(readFileSync(join(dir, 'j.xml'), 'utf8')).toContain('tests="3" failures="2"');
  });

  it('expands @data rows, switches data by profile, and exits 2 on data errors', () => {
    const r = bddxIn(dataProject);
    expect(r.code).toBe(2);
    expect(r.out).toContain('✔ ann has a balance (accounts.csv row 1)');
    expect(r.out).toContain('✔ bob has a balance (accounts.csv row 2)');
    expect(r.out).toContain('Parse errors:');
    expect(r.out).toContain('features/accounts.feature:6 Data file "nope.csv" not found');
    const ci = bddxIn(dataProject, '-p', 'ci', '--name', 'balance');
    expect(ci.out).toContain('✔ ci-bot has a balance (accounts.csv row 1)');
    const list = bddxIn(dataProject, 'list', '--name', 'balance');
    expect(list.out).toContain('features/accounts.feature::user-has-a-balance[accounts.csv#2]');
  });

  it('plan prints groups and dependencies; --explain and mermaid/json formats work', () => {
    const text = bddxIn(orchestration, 'plan');
    expect(text.code).toBe(0);
    expect(text.out).toContain('group checkout: parallel x3, 4 member(s), after setup');
    expect(bddxIn(orchestration, 'plan', '--explain', 'login').out).toContain('needed by:');
    expect(bddxIn(orchestration, 'plan', '--plan-format', 'mermaid').out).toMatch(/^flowchart LR/);
    const json = JSON.parse(bddxIn(orchestration, 'plan', '--plan-format', 'json').out) as { nodes: unknown[]; workers: number };
    expect(json.workers).toBe(4);
    expect(json.nodes).toHaveLength(9);
  });

  it('selecting one scenario pulls in its dependencies unless --no-deps', () => {
    const r = bddxIn(orchestration, 'run', '--name', 'Buy fig', '-w', '2');
    expect(r.code).toBe(0);
    expect(r.out).toContain('✔ Create a test user');
    expect(r.out).toContain('✔ Log in');
    expect(r.out).toContain('3 scenarios (3 passed)');
    const alone = bddxIn(orchestration, 'run', '--name', 'Buy fig', '--no-deps');
    expect(alone.code).toBe(1); // ctx.from('login') fails: login is not in the plan
    expect(alone.out).toContain('no scenario with this id in the plan');
  });

  it('runs the orchestration example green with 4 workers', () => {
    const r = bddxIn(orchestration);
    expect(r.code).toBe(0);
    expect(r.out).toContain('9 scenarios (9 passed)');
  });

  it('usage errors exit 2', () => {
    expect(bddx('--profile', 'nope').code).toBe(2);
    expect(bddx('--bogus').code).toBe(2);
    expect(bddx('-t', '@a and').code).toBe(2);
    expect(bddx('-w', '0').code).toBe(2);
  });
});
