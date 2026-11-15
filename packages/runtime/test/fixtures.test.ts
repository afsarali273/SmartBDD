import { afterEach, describe, expect, it } from 'vitest';
import { EventBus, buildPlan, parseSpec, type PlanOptions } from '@bddx/core';
import {
  CONTEXT,
  Executor,
  Given,
  Steps,
  SupportRegistry,
  defineFixture,
  getGlobalRegistry,
  inject,
  resetGlobalRegistry,
  type StepContext,
} from '@bddx/runtime';
import { destructuredNames } from '../src/fixtures.js';

afterEach(() => void resetGlobalRegistry());

async function run(r: SupportRegistry, src: string, plan: PlanOptions = {}, extra: Record<string, unknown> = {}) {
  const scenarios = parseSpec(src, 'f.feature').scenarios;
  const p = buildPlan(scenarios, scenarios, plan);
  expect(p.errors).toEqual([]);
  const bus = new EventBus({ keepHistory: true });
  const result = await new Executor({ registry: r, bus, plan: p, ...extra }).execute(scenarios);
  const failures = bus.history!.flatMap((e) => (e.type === 'stepFinished' && e.error ? [e.error.message] : e.type === 'hookFinished' && e.error ? [e.error.message] : []));
  return { result, events: bus.history!, failures };
}

const tick = (ms = 5) => new Promise((res) => setTimeout(res, ms));

describe('destructuredNames', () => {
  it('reads the first parameter of arrows, functions, methods and async variants', () => {
    expect(destructuredNames(async ({ page, login: l, x = 1 }: any, _a: string) => [page, l, x])).toEqual(['page', 'login', 'x']);
    expect(destructuredNames(function ({ a, b }: any) { return a + b; })).toEqual(['a', 'b']);
    expect(destructuredNames(({ a, ...rest }: any) => [a, rest])).toEqual(['a']);
    expect(destructuredNames(({ a = { b: 1, c: 2 }, d }: any) => [a, d])).toEqual(['a', 'd']);
    expect(destructuredNames((ctx: unknown) => ctx)).toEqual([]);
    expect(destructuredNames(((ctx: unknown) => ctx) as never)).toEqual([]);
    expect(destructuredNames(() => 1)).toEqual([]);
  });
});

describe('fixtures', () => {
  it('are created lazily, once per scenario, with dependencies, and torn down in reverse order', async () => {
    const r = new SupportRegistry();
    const log: string[] = [];
    r.defineFixture('db', async () => (await tick(), log.push('db up'), { n: 0 }), { teardown: () => void log.push('db down') });
    r.defineFixture('repo', ({ db }: any) => (log.push('repo up'), { db }), { teardown: () => void log.push('repo down') });
    r.defineFixture('unused', () => log.push('unused up'));
    r.defineStep('a repo', ({ repo }: any) => void (repo.db.n++, log.push(`step ${repo.db.n}`)));
    r.defineStep('again', ({ repo, db }: any) => void (expect(repo.db).toBe(db), db.n++, log.push(`again ${db.n}`)));
    r.defineStep('nothing', () => void log.push('nothing'));
    const { result } = await run(r, 'Feature: F\n  Scenario: one\n    Given a repo\n    And again\n  Scenario: two\n    Given nothing\n');
    expect(result.success).toBe(true);
    expect(log).toEqual(['db up', 'repo up', 'step 1', 'again 2', 'repo down', 'db down', 'nothing']);
  });

  it('a scenario retry gets fresh scenario fixtures; worker fixtures are created once', async () => {
    const r = new SupportRegistry();
    let browsers = 0;
    let pages = 0;
    const closed: string[] = [];
    r.defineFixture('browser', async () => (await tick(), ++browsers), { scope: 'worker', teardown: (b) => void closed.push(`browser ${b}`) });
    r.defineFixture('page', async ({ browser }: any) => `page ${browser}.${++pages}`, { teardown: (p) => void closed.push(p as string) });
    let attempt = 0;
    r.defineStep('flaky', ({ page }: any) => {
      expect(page).toBe(`page 1.${pages}`);
      if (++attempt === 1) throw new Error('first attempt fails');
    });
    const { result } = await run(r, 'Feature: F\n  Scenario: s\n    Given flaky\n  Scenario: t\n    Given flaky\n', {}, { retry: { scenario: 1 } });
    expect(result.success).toBe(true);
    expect(browsers).toBe(1);
    expect(pages).toBe(3);
    expect(closed).toEqual(['page 1.1', 'page 1.2', 'page 1.3', 'browser 1']);
  });

  it('concurrent scenarios share one worker fixture (single creation even when requested at the same time)', async () => {
    const r = new SupportRegistry();
    let created = 0;
    r.defineFixture('server', async () => (await tick(20), ++created), { scope: 'worker' });
    r.defineFixture('client', async ({ server }: any) => ({ server, id: Math.random() }));
    const ids = new Set<number>();
    r.defineStep('use it', async ({ client }: any) => {
      expect(client.server).toBe(1);
      ids.add(client.id);
      await tick(10);
    });
    const src = `Feature: F\n${[1, 2, 3, 4, 5, 6].map((i) => `  Scenario: s${i}\n    Given use it\n`).join('')}`;
    const { result } = await run(r, src, { workers: 4 });
    expect(result.success).toBe(true);
    expect(created).toBe(1);
    expect(ids.size).toBe(6);
  });

  it('serial groups, dependencies and group hooks work with fixtures unchanged', async () => {
    const r = new SupportRegistry();
    const order: string[] = [];
    r.defineFixture('account', ({ scenario }: any) => `acct-${scenario.name}`);
    r.defineStep('record', ({ account }: any) => void order.push(account));
    r.defineHook('group', 'before', {}, (() => void order.push('group start')) as never);
    const src = `Feature: F
  @group:g @id:a
  Scenario: a
    Given record
  @group:g @id:b
  Scenario: b
    Given record
  @dependsOn:a
  Scenario: c
    Given record
`;
    const { result } = await run(r, src, { workers: 3, groups: { g: { mode: 'serial' } } });
    expect(result.success).toBe(true);
    expect(order[0]).toBe('group start');
    expect(order.indexOf('acct-c')).toBeGreaterThan(order.indexOf('acct-a'));
    expect(new Set(order).size).toBe(order.length);
  });

  it('hooks can destructure fixtures; teardown sees the scenario status', async () => {
    const r = new SupportRegistry();
    const seen: string[] = [];
    r.defineFixture('page', () => ({ shots: 0 }), { teardown: (_p, info) => void seen.push(`teardown ${info.status}`) });
    r.defineHook('scenario', 'after', {}, (({ page }: any) => void seen.push(`after ${typeof page}`)) as never);
    r.defineStep('boom', ({ page }: any) => {
      void page;
      throw new Error('boom');
    });
    r.defineStep('fine', () => {});
    await run(r, 'Feature: F\n  Scenario: a\n    Given boom\n  Scenario: b\n    Given fine\n');
    // scenario b never used page: the After hook asked for it, so it is created there and passes
    expect(seen).toEqual(['after object', 'teardown failed', 'after object', 'teardown passed']);
  });

  it('ctx.<name> works for sync fixtures and explains how to request async ones; ctx.fixture() resolves them', async () => {
    const r = new SupportRegistry();
    r.defineFixture('sync', () => 41);
    r.defineFixture('later', async () => (await tick(), 'L'));
    r.defineStep('sync read', (ctx: any) => expect(ctx.sync + 1).toBe(42));
    r.defineStep('async read', (ctx: any) => ctx.later);
    r.defineStep('awaited read', async (ctx: StepContext) => expect(await ctx.fixture('later')).toBe('L'));
    const { failures } = await run(r, 'Feature: F\n  Scenario: a\n    Given sync read\n    And awaited read\n  Scenario: b\n    Given async read\n');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('Fixture "later" is asynchronous');
    expect(failures[0]).toContain('({ later }) =>');
  });

  it('reports unknown fixtures, cycles, worker fixtures needing scenario ones, reserved and duplicate names', async () => {
    const r = new SupportRegistry();
    expect(() => r.defineFixture('state', () => 1)).toThrow(/reserved/);
    expect(() => r.defineFixture('bad-name', () => 1)).toThrow(/identifier/);
    r.defineFixture('a', ({ b }: any) => b);
    r.defineFixture('b', ({ a }: any) => a);
    expect(() => r.defineFixture('a', () => 1)).toThrow(/defined twice/);
    r.defineFixture('scen', () => 1);
    r.defineFixture('wrk', ({ scen }: any) => scen, { scope: 'worker' });
    r.defineStep('cycle', ({ a }: any) => a);
    r.defineStep('cross', ({ wrk }: any) => wrk);
    r.defineStep('missing', async (ctx: StepContext) => ctx.fixture('nope'));
    const { failures } = await run(r, 'Feature: F\n  Scenario: a\n    Given cycle\n  Scenario: b\n    Given cross\n  Scenario: c\n    Given missing\n');
    expect(failures[0]).toMatch(/Fixture cycle: a -> b -> a/);
    expect(failures[1]).toMatch(/"scen" is scenario-scoped/);
    expect(failures[2]).toMatch(/Unknown fixture "nope".*Defined fixtures: \[a, b, scen, wrk\]/);
  });

  it('a failing teardown fails the scenario; a failing worker teardown fails the run', async () => {
    const r = new SupportRegistry();
    r.defineFixture('x', () => 1, { teardown: () => Promise.reject(new Error('close failed')) });
    r.defineStep('use x', ({ x }: any) => x);
    const { result, events } = await run(r, 'Feature: F\n  Scenario: a\n    Given use x\n');
    expect(result.success).toBe(false);
    expect(events.some((e) => e.type === 'hookFinished' && e.hookName === 'fixture teardown' && e.error?.message === 'close failed')).toBe(true);

    const w = new SupportRegistry();
    w.defineFixture('y', () => 1, { scope: 'worker', teardown: () => Promise.reject(new Error('worker close failed')) });
    w.defineStep('use y', ({ y }: any) => y);
    expect((await run(w, 'Feature: F\n  Scenario: a\n    Given use y\n')).result.success).toBe(false);
  });
});

describe('inject()', () => {
  it('injects classes, fixtures (also async ones) and the context into @Steps() classes and page objects', async () => {
    const log: string[] = [];
    defineFixture('page', async ({ scenario }) => (await tick(), { url: '', name: scenario.name }), { teardown: () => void log.push('page closed') });

    class LoginPage {
      private page = inject<{ url: string; name: string }>('page');
      open(path: string) {
        this.page.url = path;
        return this.page;
      }
    }

    @Steps()
    class LoginSteps {
      private login = inject(LoginPage);
      private ctx = inject(CONTEXT);
      @Given('I open {string}')
      open(path: string) {
        const p = this.login.open(path);
        log.push(`${this.ctx.scenario.name}:${p.url}`);
      }
    }
    void LoginSteps;

    const { result, failures } = await run(getGlobalRegistry(), 'Feature: F\n  Scenario: s1\n    Given I open "/a"\n  Scenario: s2\n    Given I open "/b"\n', { workers: 2 });
    expect(failures).toEqual([]);
    expect(result.success).toBe(true);
    expect(log.sort()).toEqual(['page closed', 'page closed', 's1:/a', 's2:/b']);
  });

  it('outside a bddx-created class it explains where it can be used', () => {
    expect(() => inject('page')).toThrow(/field initializer or constructor/);
  });
});
