import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus, parseSpec, type Status } from '@bddx/core';
import { Executor, SupportRegistry } from '@bddx/runtime';
import { registerConformanceSteps } from './steps.js';

const dir = fileURLToPath(new URL('../features/', import.meta.url));

interface Expected {
  scenarios?: Record<string, Status>;
  steps?: Record<string, Status[]>;
  trace?: string[];
  success?: boolean;
}

const features = readdirSync(dir).filter((f) => f.endsWith('.feature'));

describe('conformance', () => {
  for (const file of features) {
    it(file, async () => {
      const expectedFile = join(dir, file.replace(/\.feature$/, '.expected.json'));
      expect(existsSync(expectedFile), `missing ${expectedFile}`).toBe(true);
      const expected = JSON.parse(readFileSync(expectedFile, 'utf8')) as Expected;
      const spec = parseSpec(readFileSync(join(dir, file), 'utf8'), file);
      expect(spec.errors).toEqual([]);

      const trace: string[] = [];
      const registry = new SupportRegistry();
      registerConformanceSteps(registry, trace);
      const bus = new EventBus({ keepHistory: true });
      const result = await new Executor({ registry, bus }).execute(spec.scenarios);

      if (expected.scenarios) expect(Object.fromEntries(result.scenarioStatuses)).toEqual(expected.scenarios);
      if (expected.steps) {
        const actual: Record<string, Status[]> = {};
        for (const e of bus.history!) {
          if (e.type === 'stepFinished' && expected.steps[e.scenarioId]) (actual[e.scenarioId] ??= []).push(e.status);
        }
        expect(actual).toEqual(expected.steps);
      }
      if (expected.trace) expect(trace).toEqual(expected.trace);
      if (expected.success !== undefined) expect(result.success).toBe(expected.success);
    });
  }
});
