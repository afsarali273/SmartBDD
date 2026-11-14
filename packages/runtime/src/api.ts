/**
 * The public, global registration API used in step files:
 *
 *   import { Given, When, Then, Before, defineParameterType } from '@bddx/runtime';
 *
 *   Given('I have {int} cukes', async (ctx, count: number) => {
 *     ctx.state.set('cukes', count);
 *   });
 *
 * Every function writes to the global SupportRegistry (see registry.ts).
 */
import { callerLocation, getGlobalRegistry, type ParameterTypeOptions } from './registry.js';
import type {
  FeatureHookFn,
  HookOptions,
  RunHookFn,
  ScenarioHookFn,
  StepFn,
  StepOptions,
} from './types.js';
import type { HookKind, HookLevel } from '@bddx/core';

type StepRegistrar = {
  (pattern: string | RegExp, fn: StepFn): void;
  (pattern: string | RegExp, options: StepOptions, fn: StepFn): void;
};

function makeStepRegistrar(): StepRegistrar {
  return ((pattern: string | RegExp, a: StepOptions | StepFn, b?: StepFn) => {
    const [options, fn] = typeof a === 'function' ? [{}, a] : [a, b!];
    getGlobalRegistry().defineStep(pattern, fn, options, callerLocation());
  }) as StepRegistrar;
}

/** Given / When / Then / Step are interchangeable for matching (like Cucumber). */
export const Given = makeStepRegistrar();
export const When = makeStepRegistrar();
export const Then = makeStepRegistrar();
export const Step = makeStepRegistrar();

type HookArg = HookOptions | string | undefined;

function normalise(opts: HookArg): HookOptions {
  if (opts === undefined) return {};
  return typeof opts === 'string' ? { tags: opts } : opts;
}

function makeHook<F>(level: HookLevel, kind: HookKind) {
  function register(fn: F): void;
  function register(options: HookOptions | string, fn: F): void;
  function register(a: F | HookOptions | string, b?: F): void {
    const [opts, fn] = typeof a === 'function' ? [undefined, a as F] : [a as HookArg, b as F];
    getGlobalRegistry().defineHook(level, kind, normalise(opts), fn as never, callerLocation());
  }
  return register;
}

/** Once per run, before anything else. */
export const BeforeAll = makeHook<RunHookFn>('run', 'before');
/** Once per run, after everything (always runs). */
export const AfterAll = makeHook<RunHookFn>('run', 'after');
/** Before the first scenario of each feature. `tags` filters on FEATURE tags. */
export const BeforeFeature = makeHook<FeatureHookFn>('feature', 'before');
export const AfterFeature = makeHook<FeatureHookFn>('feature', 'after');
/** Before the first scenario of each Rule. `tags` filters on rule tags. */
export const BeforeRule = makeHook<FeatureHookFn>('rule', 'before');
export const AfterRule = makeHook<FeatureHookFn>('rule', 'after');
/** Before every scenario (every attempt). `tags` filters on scenario tags. */
export const Before = makeHook<ScenarioHookFn>('scenario', 'before');
export const After = makeHook<ScenarioHookFn>('scenario', 'after');
/** Around every step. */
export const BeforeStep = makeHook<ScenarioHookFn>('step', 'before');
export const AfterStep = makeHook<ScenarioHookFn>('step', 'after');

/** Aliases that match the plan's naming. */
export const BeforeScenario = Before;
export const AfterScenario = After;

export function defineParameterType<T>(options: ParameterTypeOptions<T>): void {
  getGlobalRegistry().defineParameterType(options);
}

/** Default timeout (ms) for steps and hooks without their own `timeoutMs`. 0 disables. */
export function setDefaultTimeout(ms: number): void {
  getGlobalRegistry().defaultTimeoutMs = ms;
}
