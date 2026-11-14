/**
 * Step-level tags (inline, at the END of a step's text):
 *
 *   When I click "Load more" @repeat:3
 *   Given I create user "user-{{i}}" @repeat:100 @concurrency:10
 *   Then the order status is "SHIPPED" @retry:5 @delay:2s @backoff:2
 *   And the export exists @timeout:30s
 *
 * Only these keys are recognised; any other trailing "@word" stays part of the step text.
 * They are removed from `StepInstance.text` before matching and stored in `StepInstance.run`.
 *
 * Scenario-level defaults for every step (tags on Scenario/Feature/Rule/Examples):
 *   @stepRetry:<n>  @stepDelay:<duration>  @stepTimeout:<duration>
 */
import type { Tag } from './model.js';
import { parseTag } from './tags.js';

export const STEP_TAG_KEYS = ['repeat', 'retry', 'delay', 'backoff', 'timeout', 'concurrency'] as const;
export type StepTagKey = (typeof STEP_TAG_KEYS)[number];

export interface StepRunOptions {
  /** Run the step N times (stops at the first failure). */
  repeat?: number;
  /** Extra attempts until the step passes (retry:3 = up to 4 runs). */
  retry?: number;
  /** Pause between repetitions / attempts. */
  delayMs?: number;
  /** Multiply the delay after each retry (>= 1). */
  backoff?: number;
  /** Timeout per attempt / repetition. */
  timeoutMs?: number;
  /** Repetitions running at the same time (repeat only). Default 1. */
  concurrency?: number;
}

/** '500ms' | '2s' | '1.5s' | '2m' | '250' (ms). Throws on anything else. */
export function parseDuration(value: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value.trim());
  if (!m) throw new Error(`"${value}" is not a duration (use e.g. 500ms, 2s, 1m)`);
  const n = Number(m[1]);
  return Math.round(m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n);
}

function int(key: string, value: string | undefined, min: number): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n < min) throw new Error(`@${key} needs a whole number >= ${min} (got "${value ?? ''}")`);
  return n;
}

const TRAILING = /\s+@([A-Za-z][A-Za-z0-9_]*)(?::(\S+))?\s*$/;

export interface ExtractedStepTags {
  text: string;
  tags: Tag[];
  run: StepRunOptions;
  errors: string[];
}

/** Strip recognised trailing step tags from `text` and validate them. */
export function extractStepTags(text: string): ExtractedStepTags {
  let rest = text;
  const tags: Tag[] = [];
  for (;;) {
    const m = TRAILING.exec(rest);
    if (!m || !(STEP_TAG_KEYS as readonly string[]).includes(m[1]!)) break;
    tags.unshift(parseTag(`@${m[1]}${m[2] !== undefined ? `:${m[2]}` : ''}`));
    rest = rest.slice(0, m.index);
  }
  const run: StepRunOptions = {};
  const errors: string[] = [];
  for (const t of tags) {
    try {
      switch (t.key as StepTagKey) {
        case 'repeat':
          run.repeat = int('repeat', t.value, 1);
          break;
        case 'retry':
          run.retry = int('retry', t.value, 0);
          break;
        case 'delay':
          run.delayMs = parseDuration(t.value ?? '');
          break;
        case 'timeout':
          run.timeoutMs = parseDuration(t.value ?? '');
          if (run.timeoutMs <= 0) throw new Error('@timeout must be > 0');
          break;
        case 'backoff': {
          const b = Number(t.value);
          if (!Number.isFinite(b) || b < 1) throw new Error(`@backoff needs a number >= 1 (got "${t.value ?? ''}")`);
          run.backoff = b;
          break;
        }
        case 'concurrency':
          run.concurrency = int('concurrency', t.value, 1);
          break;
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (run.repeat !== undefined && run.retry !== undefined) errors.push('Use either @repeat or @retry on a step, not both');
  if (run.concurrency !== undefined && run.repeat === undefined) errors.push('@concurrency only applies together with @repeat');
  if (run.backoff !== undefined && run.retry === undefined) errors.push('@backoff only applies together with @retry');
  return { text: rest, tags, run, errors };
}

/** Scenario-level step defaults from tags (@stepRetry, @stepDelay, @stepTimeout). */
export function scenarioStepDefaults(tags: readonly Tag[]): { run: StepRunOptions; errors: string[] } {
  const run: StepRunOptions = {};
  const errors: string[] = [];
  for (const t of tags) {
    try {
      if (t.key === 'stepRetry') run.retry = int('stepRetry', t.value, 0);
      else if (t.key === 'stepDelay') run.delayMs = parseDuration(t.value ?? '');
      else if (t.key === 'stepTimeout') run.timeoutMs = parseDuration(t.value ?? '');
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { run, errors };
}
