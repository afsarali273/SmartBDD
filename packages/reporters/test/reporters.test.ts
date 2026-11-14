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
