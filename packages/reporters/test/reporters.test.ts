import { describe, expect, it } from 'vitest';
import { EventBus, parseSpec } from '@bddx/core';
import { Executor, SupportRegistry, type StepContext } from '@bddx/runtime';
import { consoleReporter, createReporter, junitReporter } from '@bddx/reporters';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FEATURE = `Feature: Login & <stuff>
  Scenario: good
    Given ok
  Scenario: bad
    Given ok
    When it breaks
  Scenario: missing
    Given I click "Save" 3 times
`;

async function runWith(...reporters: ReturnType<typeof consoleReporter>[]) {
  const r = new SupportRegistry();
  r.defineStep('ok', () => {});
  r.defineStep('it breaks', (_c: StepContext) => {
    throw new Error('expected <200> got "500"');
  });
  const bus = new EventBus();
  for (const rep of reporters) bus.on((e) => rep.onEvent(e));
  await new Executor({ registry: r, bus }).execute(parseSpec(FEATURE, 'login.feature').scenarios);
  await bus.flush();
  for (const rep of reporters) await rep.close?.();
}

describe('console reporter', () => {
  it('prints scenarios, failing steps, failures, snippets and a summary', async () => {
    let out = '';
    await runWith(consoleReporter({ colors: false, write: (t: string) => void (out += t) }));
    expect(out).toContain('✔ good');
    expect(out).toContain('✘ bad');
    expect(out).toContain('✘ When it breaks');
    expect(out).toContain('Failures:');
    expect(out).toContain(`Given('I click {string} {int} times', async (ctx, string: string, int: number) => {`);
    expect(out).toContain('3 scenarios (1 passed, 1 failed, 1 undefined)');
    expect(out).toContain('FAILED');
  });

  it('progress style prints one char per scenario', async () => {
    let out = '';
    await runWith(consoleReporter({ colors: false, style: 'progress', write: (t: string) => void (out += t) }));
    expect(out.startsWith('.✘?')).toBe(true);
  });
});

describe('junit reporter', () => {
  it('writes escaped XML with failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bddx-junit-'));
    const file = join(dir, 'out', 'junit.xml');
    await runWith(junitReporter({ outputFile: file }));
    const xml = readFileSync(file, 'utf8');
    expect(xml).toContain('<testsuites name="bddx" tests="3" failures="2" skipped="0"');
    expect(xml).toContain('name="Login &amp; &lt;stuff&gt;"');
    expect(xml).toContain('<failure type="failed" message="expected &lt;200&gt; got &quot;500&quot;">');
    expect(xml).toContain('<failure type="undefined"');
  });
});

describe('createReporter', () => {
  it('parses name:file shorthand and rejects unknown names', () => {
    expect(createReporter('junit:x.xml').name).toBe('junit');
    expect(createReporter(['ndjson', { outputFile: 'a.ndjson' }]).name).toBe('ndjson');
    expect(() => createReporter('nope')).toThrow(/Unknown reporter "nope"/);
  });
});

describe('cucumber-json reporter', () => {
  it('writes features > elements > steps with statuses and nanosecond durations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bddx-cj-'));
    const file = join(dir, 'cucumber.json');
    const { cucumberJsonReporter } = await import('@bddx/reporters');
    await runWith(cucumberJsonReporter({ outputFile: file }));
    const json = JSON.parse(readFileSync(file, 'utf8')) as Array<{
      name: string;
      uri: string;
      elements: Array<{ name: string; keyword: string; steps: Array<{ keyword: string; name: string; result: { status: string; duration: number; error_message?: string } }> }>;
    }>;
    expect(json).toHaveLength(1);
    expect(json[0]!.name).toBe('Login & <stuff>');
    expect(json[0]!.elements.map((e) => e.name)).toEqual(['good', 'bad', 'missing']);
    expect(json[0]!.elements[0]!.keyword).toBe('Scenario');
    const bad = json[0]!.elements[1]!.steps;
    expect(bad.map((s) => s.result.status)).toEqual(['passed', 'failed']);
    expect(bad[1]!.result.error_message).toContain('expected <200>');
    expect(json[0]!.elements[2]!.steps[0]!.result.status).toBe('undefined');
    expect(typeof bad[0]!.result.duration).toBe('number');
  });
});

describe('console reporter log levels', () => {
  const logEvents = (consoleOpts: Record<string, unknown>) => {
    let out = '';
    const rep = consoleReporter({ colors: false, write: (t: string) => void (out += t), ...consoleOpts });
    rep.onEvent({ ts: 0, type: 'planReady', scenarios: [{ id: 's', name: 'S', uri: 'x.feature', line: 1, featureName: 'F', tags: [], steps: [] }] });
    rep.onEvent({ ts: 0, type: 'log', level: 'info', source: 'user', message: 'run-level info' });
    rep.onEvent({ ts: 0, type: 'log', level: 'debug', source: 'user', message: 'dbg', scenarioId: 's', data: { k: 1 } });
    rep.onEvent({ ts: 0, type: 'log', level: 'warn', source: 'user', message: 'careful', scenarioId: 's' });
    rep.onEvent({ ts: 0, type: 'log', level: 'debug', source: 'bddx', message: 'start s on w1', scenarioId: 's' });
    rep.onEvent({ ts: 0, type: 'scenarioFinished', scenarioId: 's', attempt: 1, status: 'passed', durationMs: 1 });
    return out;
  };
  it('defaults to info and prints scenario logs under the scenario', () => {
    const out = logEvents({});
    expect(out).toContain('✔ S');
    expect(out).toContain('      [warn] careful');
    expect(out).toContain('[info] run-level info');
    expect(out).not.toContain('dbg');
    expect(out).not.toContain('start s on w1');
  });
  it('warn hides info', () => {
    expect(logEvents({ logLevel: 'warn' })).not.toContain('run-level info');
  });
  it('debug shows everything, framework logs tagged bddx:debug, data inline', () => {
    const out = logEvents({ logLevel: 'debug' });
    expect(out).toContain('[info] run-level info');
    expect(out).toContain('[debug] dbg {"k":1}');
    expect(out).toContain('[bddx:debug] start s on w1');
  });
  it('silent hides logs', () => {
    expect(logEvents({ logLevel: 'silent' })).not.toContain('careful');
  });
});

describe('logs and images in file reports', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

  async function richRun(...reporters: ReturnType<typeof consoleReporter>[]) {
    const r = new SupportRegistry();
    r.defineStep('ok <x>', () => {});
    r.defineStep('shop', (c: StepContext) => {
      c.log.info('cart <ready>', { items: 2 });
      c.log.debug('internal');
      c.log.image('cart page', PNG, { name: 'cart.png' });
      c.log.warn('slow ]]> response', PNG);
      c.attach('{"a":1}', 'application/json', 'payload');
    });
    r.defineStep('boom', () => {
      throw new Error('kaput & <gone>');
    });
    r.defineHook('scenario', 'before', {}, (c) => c.log.info(`hook for ${c.scenario.name}`));
    const bus = new EventBus();
    for (const rep of reporters) bus.on((e) => rep.onEvent(e));
    const src = 'Feature: Rich\n  Scenario: buy\n    Given shop\n  Scenario: broken\n    Given boom\n';
    await new Executor({ registry: r, bus }).execute(parseSpec(src, 'rich.feature').scenarios);
    await bus.flush();
    for (const rep of reporters) await rep.close?.();
  }

  it('HTML: self-contained page with logs (levels), log images, attachments, errors, escaping', async () => {
    const { htmlReporter } = await import('@bddx/reporters');
    const dir = mkdtempSync(join(tmpdir(), 'bddx-html-'));
    const file = join(dir, 'r.html');
    await richRun(htmlReporter({ outputFile: file, title: 'My <Run>' }));
    const html = readFileSync(file, 'utf8');
    expect(html).toContain('<title>My &lt;Run&gt;</title>');
    expect(html).toContain('FAILED');
    expect(html).toContain('<span class="msg">cart &lt;ready&gt;</span>');
    expect(html).toContain('class="log lv-debug"');
    expect(html).toContain('class="log lv-warn"');
    expect(html).toMatch(/class="logimg"[^>]*><img[^>]*alt="cart.png" src="data:image\/png;base64,/);
    expect(html).toContain('📎 payload');
    expect(html).toContain('kaput &amp; &lt;gone&gt;');
    expect(html).toContain('hook for buy'); // scenario-level (hook) log
    expect(html).not.toMatch(/<script[^>]+src=/); // no external assets
  });

  it('JUnit: logs in system-out / system-err, CDATA-safe, step names prefixed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bddx-junit2-'));
    const file = join(dir, 'j.xml');
    await richRun(junitReporter({ outputFile: file }));
    const xml = readFileSync(file, 'utf8');
    expect(xml).toContain('<system-out><![CDATA[[info] hook for buy\nGiven shop: [info] cart <ready> {"items":2}\nGiven shop: [info] cart page [image: cart.png, 29 B]]]></system-out>');
    expect(xml).toContain('<system-err><![CDATA[Given shop: [warn] slow ]]]]><![CDATA[> response [image: image/png, 29 B]]]></system-err>');
    expect(xml).not.toContain('[debug] internal'); // debug below default 'info'
  });

  it('Cucumber JSON: step output lines, log images as embeddings, hook logs in before', async () => {
    const { cucumberJsonReporter } = await import('@bddx/reporters');
    const dir = mkdtempSync(join(tmpdir(), 'bddx-cj2-'));
    const file = join(dir, 'c.json');
    await richRun(cucumberJsonReporter({ outputFile: file, logLevel: 'debug' }));
    const [feature] = JSON.parse(readFileSync(file, 'utf8')) as Array<{
      elements: Array<{ before?: Array<{ output: string[] }>; steps: Array<{ output?: string[]; embeddings?: Array<{ mime_type: string; name?: string }> }> }>;
    }>;
    const buy = feature!.elements[0]!;
    expect(buy.before![0]!.output).toEqual(['[info] hook for buy']);
    expect(buy.steps[0]!.output).toEqual([
      '[info] cart <ready> {"items":2}',
      '[debug] internal',
      '[info] cart page [image: cart.png, 29 B]',
      '[warn] slow ]]> response [image: image/png, 29 B]',
    ]);
    expect(buy.steps[0]!.embeddings!.map((e) => `${e.mime_type}:${e.name}`)).toEqual([
      'application/json:payload',
      'image/png:cart.png',
      'image/png:slow ]]> response',
    ]);
  });
});

describe('stack trimming', () => {
  it('drops bddx-internal and node-internal frames, keeps user frames', async () => {
    const { trimStack } = await import('../src/html.js');
    const stack = [
      'Error: boom',
      '    at Object.fn (/proj/steps/a.steps.ts:3:9)',
      '    at file:///x/node_modules/@bddx/runtime/dist/executor.js:5:1',
      '    at /repo/packages/runtime/src/executor.ts:10:2',
      '    at AsyncLocalStorage.run (node:internal/async_local_storage/async_hooks:91:14)',
    ].join('\n');
    expect(trimStack(stack)).toBe('Error: boom\n    at Object.fn (/proj/steps/a.steps.ts:3:9)');
  });
});

describe('HTML report v2 views', () => {
  it('timeline lanes, dependency graph, history with trend and flaky score', async () => {
    const { buildPlan } = await import('@bddx/core');
    const { htmlReporter } = await import('@bddx/reporters');
    const r = new SupportRegistry();
    let calls = 0;
    r.defineStep('ok', () => new Promise((res) => setTimeout(res, 5)));
    r.defineStep('flaky', () => {
      if (++calls === 1) throw new Error('first time');
    });
    const spec = parseSpec(
      `Feature: V2
  @id:setup
  Scenario: Setup
    Given ok
  @dependsOn:setup @retry:1
  Scenario: Uses setup
    Given flaky
  @dependsOn:setup:soft
  Scenario: Soft user
    Given ok
`,
      'v2.feature',
    );
    const plan = buildPlan(spec.scenarios, spec.scenarios, { workers: 2 });
    const previous = [false, true].map((pass, n) => ({
      v: 1 as const,
      runId: `old-${n}`,
      startedAt: n + 1,
      durationMs: 5,
      success: pass,
      workers: 1,
      scenarios: { [spec.scenarios[1]!.id]: { s: pass ? ('passed' as const) : ('failed' as const), d: 3, n: 'Uses setup' } },
    }));
    const dir = mkdtempSync(join(tmpdir(), 'bddx-html2-'));
    const file = join(dir, 'r.html');
    const rep = htmlReporter({ outputFile: file, history: previous });
    const bus = new EventBus();
    bus.on((e) => rep.onEvent(e));
    await new Executor({ registry: r, bus, plan }).execute(spec.scenarios);
    await rep.close?.();
    const html = readFileSync(file, 'utf8');
    expect(html).toContain('<summary>Timeline</summary>');
    expect(html).toMatch(/class="tl-lane">w1</);
    expect(html).toContain('tb-retried'); // failed attempt that was retried
    expect(html).toContain('<summary>Dependencies</summary>');
    expect(html).toContain('class="g-edge soft"');
    expect(html).toContain('<summary>History</summary>');
    expect(html).toContain('flaky score'); // failed → passed → flaky this run
    expect(html).toMatch(/<i class="h-fail"[^>]*><\/i><i class="h-pass"[^>]*><\/i><i class="h-flaky"/);
    expect(html).toMatch(/href="#sc-1"/); // timeline/graph link to the scenario card
    expect(html).toContain('id="sc-1"');
  });

  it('no history section without previous runs; no graph without dependencies', async () => {
    const { htmlReporter } = await import('@bddx/reporters');
    const dir = mkdtempSync(join(tmpdir(), 'bddx-html3-'));
    const file = join(dir, 'r.html');
    await runWith(htmlReporter({ outputFile: file }));
    const html = readFileSync(file, 'utf8');
    expect(html).toContain('<summary>Timeline</summary>');
    expect(html).not.toContain('<summary>Dependencies</summary>');
    expect(html).not.toContain('<summary>History</summary>');
  });
});
