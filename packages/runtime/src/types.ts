import type { FeatureInfo, HookKind, HookLevel, RuleRef } from '@bddx/core';
import type { Cleanup, Store } from './context.js';

export interface ScenarioInfo {
  id: string;
  name: string;
  uri: string;
  line: number;
  featureName: string;
  ruleName?: string;
  /** Tag names as written, e.g. ['@smoke', '@owner:payments']. */
  tags: string[];
  /** Key/value view of tags. */
  meta: Record<string, string>;
  /** Outline row values, when the scenario came from Examples. */
  example?: Record<string, string>;
  /** 1 for the first attempt; increases with retries (phase 4). */
  attempt: number;
}

export interface CurrentStepInfo {
  id: string;
  keyword: string;
  text: string;
  line: number;
}

/** Context for run-level hooks (BeforeAll / AfterAll). */
export interface RunContext {
  /** Run-scoped store, shared by everything in this process. */
  run: Store;
  /** User data from config `params` and CLI `-D key=value`. */
  params: Readonly<Record<string, string>>;
  log(message: string): void;
  attach(body: string | Uint8Array, mediaType?: string, name?: string): void;
  /** Register cleanup for the current scope (LIFO, runs even after failures). */
  defer(fn: Cleanup): void;
}

/** Context for feature- and rule-level hooks. */
export interface FeatureContext extends RunContext {
  /** Feature-scoped store, cleared after the feature. */
  feature: Store;
  featureInfo: FeatureInfo;
  rule?: RuleRef;
}

/** Context for steps and scenario/step hooks. Always the FIRST argument of a step function. */
export interface StepContext extends FeatureContext {
  scenario: ScenarioInfo;
  /** Scenario-scoped store (the "world"). Fresh for every scenario and every attempt. */
  state: Store;
  /** The current step (only inside steps and step hooks). */
  step?: CurrentStepInfo;
  /** Mark the current step pending. */
  pending(reason?: string): never;
  /** Skip the rest of the scenario. */
  skip(reason?: string): never;
}

export type StepFn = (ctx: StepContext, ...args: any[]) => unknown | Promise<unknown>;

export interface StepOptions {
  /** Tag expression: the definition only matches in scenarios whose tags satisfy it. */
  tags?: string;
  timeoutMs?: number;
}

export interface HookOptions {
  name?: string;
  /** Tag expression filter (scenario/step hooks: scenario tags; feature hooks: feature tags; rule hooks: rule tags). */
  tags?: string;
  /** Lower runs first for before-hooks; after-hooks run in reverse order. Default 0. */
  order?: number;
  /** Before-hooks only: run even when an earlier before-hook at this level failed. */
  alwaysRun?: boolean;
  timeoutMs?: number;
}

export type RunHookFn = (ctx: RunContext) => unknown | Promise<unknown>;
export type FeatureHookFn = (ctx: FeatureContext) => unknown | Promise<unknown>;
export type ScenarioHookFn = (ctx: StepContext) => unknown | Promise<unknown>;

export type AnyHookFn = RunHookFn | FeatureHookFn | ScenarioHookFn;

export interface HookDefinition {
  id: string;
  name: string;
  level: HookLevel;
  kind: HookKind;
  tags?: string;
  order: number;
  alwaysRun: boolean;
  timeoutMs?: number;
  fn: AnyHookFn;
  location?: string;
  /** Registration sequence, used as tie-breaker. */
  seq: number;
}
