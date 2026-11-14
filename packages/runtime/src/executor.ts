/**
 * Serial executor (phase 1).
 *
 * Runs scenarios in the given order, grouped by feature (first-appearance order),
 * firing hooks at run / feature / rule / scenario / step level and emitting events.
 *
 * Phase 3 replaces the outer loop with a scheduler that pulls ready ScenarioInstances
 * from the plan graph and hands them to workers. `runScenario()` is designed to be
 * reused unchanged by those workers: it only needs the scenario, the registry, the
 * bus, and the parent scopes.
 *
 * FAILURE SEMANTICS (keep docs/IMPLEMENTATION.md in sync):
 *  - BeforeAll fails      -> every scenario skipped (reason names the hook); AfterAll still runs; run fails.
 *  - BeforeFeature fails  -> the feature's scenarios skipped; AfterFeature still runs; run fails.
 *  - BeforeRule fails     -> the rule's scenarios skipped; AfterRule still runs; run fails.
 *  - Before (scenario) fails -> later before-hooks skipped unless `alwaysRun`; steps skipped;
 *                            After hooks still run; scenario 'failed'.
 *  - A step fails         -> remaining steps 'skipped'; After hooks run; scenario 'failed'.
 *  - BeforeStep fails     -> that step 'failed' (body not run); AfterStep still runs.
 *  - After/AfterStep fails -> scenario/step becomes 'failed' even if steps passed.
 *  - defer() cleanup throws -> owning scenario/feature becomes 'failed'.
 *  - ctx.pending()        -> step 'pending', remaining steps skipped, scenario 'pending'.
 *  - ctx.skip(reason)     -> step 'skipped', remaining skipped, scenario 'skipped' with reason.
 *  - undefined / ambiguous step -> that status, remaining steps skipped.
 */
import {
  BDDX_VERSION,
  EVENT_SCHEMA_VERSION,
  emptySummary,
  compileTagExpression,
  toErrorInfo,
  worstStatus,
  type ErrorInfo,
  type EventBus,
  type FeatureInfo,
  type HookLevel,
  type ParsedSpec,
  type RuleRef,
  type RunSummary,
  type ScenarioInstance,
  type Status,
  type StepInstance,
} from '@bddx/core';
import { randomUUID } from 'node:crypto';
import { Scope } from './context.js';
import { DataTable, DocString } from './datatable.js';
import type { SupportRegistry } from './registry.js';
import { PendingSignal, SkipSignal, withTimeout } from './signals.js';
import type { CurrentStepInfo, FeatureContext, HookDefinition, RunContext, StepContext } from './types.js';

export interface ExecuteOptions {
  registry: SupportRegistry;
  bus: EventBus;
  /** Parsed specs, only used to emit `specParsed` events. */
  specs?: ParsedSpec[];
  dryRun?: boolean;
  /** Stop starting new scenarios after the first failure. */
  failFast?: boolean;
  /** When true (default) pending/undefined/ambiguous scenarios fail the run. */
  strict?: boolean;
  params?: Record<string, string>;
  workerId?: string;
  runId?: string;
}

export interface ExecuteResult {
  success: boolean;
  summary: RunSummary;
  scenarioStatuses: Map<string, Status>;
}

interface HookOutcome {
  status: Status;
  error?: unknown;
  skipReason?: string;
}

interface Emitters {
  scenarioId?: string;
  stepId?: string;
}

export class Executor {
  private readonly summary = emptySummary();
  private readonly statuses = new Map<string, Status>();
  private readonly params: Readonly<Record<string, string>>;
  private readonly workerId: string;
  private runFailed = false;
  private runError: unknown;
  private stopRequested = false;

  constructor(private readonly opts: ExecuteOptions) {
    this.params = Object.freeze({ ...(opts.params ?? {}) });
    this.workerId = opts.workerId ?? 'main';
  }

  async execute(scenarios: readonly ScenarioInstance[]): Promise<ExecuteResult> {
    const { bus, registry } = this.opts;
    const started = Date.now();
    registry.finalize();

    bus.emit({
      type: 'runStarted',
      runId: this.opts.runId ?? randomUUID(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      framework: { name: 'bddx', version: BDDX_VERSION },
      runtime: { name: 'node', version: process.version },
      dryRun: !!this.opts.dryRun,
    });
    for (const spec of this.opts.specs ?? []) {
      bus.emit({
        type: 'specParsed',
        uri: spec.uri,
        ...(spec.feature ? { featureName: spec.feature.name } : {}),
        scenarioCount: spec.scenarios.length,
        errors: spec.errors,
      });
    }
    bus.emit({
      type: 'planReady',
      scenarios: scenarios.map((s) => ({
        id: s.id,
        keyword: s.keyword,
        name: s.name,
        description: s.description,
        feature: {
          name: s.feature.name,
          description: s.feature.description,
          line: s.feature.line,
          tags: s.feature.tags.map((t) => t.name),
          language: s.feature.language,
        },
        uri: s.uri,
        line: s.line,
        featureName: s.feature.name,
        ...(s.rule ? { ruleName: s.rule.name } : {}),
        ...(s.example
          ? {
              example: {
                name: s.example.name,
                index: s.example.index,
                values: s.example.values,
                ...(s.example.source ? { source: s.example.source, sourceRow: s.example.sourceRow! } : {}),
              },
            }
          : {}),
        tags: s.tags.map((t) => t.name),
        steps: s.steps.map((st) => ({ id: st.id, keyword: st.keyword, text: st.text, line: st.line })),
      })),
    });

    const runScope = new Scope('run');
    const runCtx = this.makeRunContext(runScope, {});
    let runFatal: string | undefined;

    if (!this.opts.dryRun) {
      const outcome = await this.runHooks('run', 'before', runCtx, () => true, {});
      if (outcome.status === 'failed') {
        runFatal = `BeforeAll hook "${outcome.hookName}" failed`;
        this.runFailed = true;
        this.runError ??= outcome.error;
      }
    }

    for (const [featureScenarios, feature] of groupByFeature(scenarios)) {
      if (runFatal || this.stopRequested) {
        for (const s of featureScenarios) this.skipScenario(s, runFatal ?? 'fail-fast: an earlier scenario failed');
        continue;
      }
      await this.runFeature(feature, featureScenarios, runScope);
    }

    if (!this.opts.dryRun) {
      const after = await this.runHooks('run', 'after', runCtx, () => true, {});
      if (after.status === 'failed') {
        this.runFailed = true;
        this.runError ??= after.error;
      }
      const cleanupErrors = await runScope.close();
      if (cleanupErrors.length) {
        this.runFailed = true;
        this.runError ??= cleanupErrors[0];
      }
    }

    this.summary.durationMs = Date.now() - started;
    const sc = this.summary.scenarios;
    const strict = this.opts.strict ?? true;
    const bad = sc.failed + (strict ? sc.pending + sc.undefined + sc.ambiguous : 0);
    const success = !this.runFailed && bad === 0;
    bus.emit({
      type: 'runFinished',
      success,
      summary: this.summary,
      ...(this.runError !== undefined ? { error: toErrorInfo(this.runError) } : {}),
    });
    return { success, summary: this.summary, scenarioStatuses: this.statuses };
  }

  // ---------------------------------------------------------------- features & rules

  private async runFeature(feature: FeatureInfo, scenarios: ScenarioInstance[], runScope: Scope): Promise<void> {
    const { bus } = this.opts;
    const featureScope = new Scope('feature');
    const featureTags = feature.tags.map((t) => t.name);
    const fctx = this.makeFeatureContext(runScope, featureScope, feature, undefined, {});
    bus.emit({ type: 'featureStarted', uri: feature.uri, name: feature.name });

    let featureFatal: string | undefined;
    let featureHookFailed = false;
    const dry = !!this.opts.dryRun;

    if (!dry) {
      const before = await this.runHooks('feature', 'before', fctx, tagFilter(featureTags), { uri: feature.uri });
      if (before.status === 'failed') {
        featureFatal = `BeforeFeature hook "${before.hookName}" failed`;
        featureHookFailed = true;
      }
    }

    let currentRule: RuleRef | undefined;
    let ruleFatal: string | undefined;

    const closeRule = async () => {
      if (!currentRule || dry || featureFatal) return;
      const rctx = this.makeFeatureContext(runScope, featureScope, feature, currentRule, {});
      const after = await this.runHooks('rule', 'after', rctx, tagFilter(ruleTags(currentRule)), { uri: feature.uri });
      if (after.status === 'failed') featureHookFailed = true;
    };

    for (const scenario of scenarios) {
      if (scenario.rule?.id !== currentRule?.id) {
        await closeRule();
        currentRule = scenario.rule;
        ruleFatal = undefined;
        if (currentRule && !dry && !featureFatal) {
          const rctx = this.makeFeatureContext(runScope, featureScope, feature, currentRule, {});
          const before = await this.runHooks('rule', 'before', rctx, tagFilter(ruleTags(currentRule)), { uri: feature.uri });
          if (before.status === 'failed') {
            ruleFatal = `BeforeRule hook "${before.hookName}" failed`;
            featureHookFailed = true;
          }
        }
      }
      if (featureFatal || ruleFatal) {
        this.skipScenario(scenario, (featureFatal ?? ruleFatal)!);
        continue;
      }
      if (this.stopRequested) {
        this.skipScenario(scenario, 'fail-fast: an earlier scenario failed');
        continue;
      }
      const status = await this.runScenario(scenario, runScope, featureScope);
      if (status === 'failed' && this.opts.failFast) this.stopRequested = true;
    }
    await closeRule();

    if (!dry) {
      const after = await this.runHooks('feature', 'after', fctx, tagFilter(featureTags), { uri: feature.uri });
      if (after.status === 'failed') featureHookFailed = true;
      const cleanupErrors = await featureScope.close();
      if (cleanupErrors.length) {
        featureHookFailed = true;
        this.emitHookLikeError('feature', 'after', 'feature cleanup (defer)', cleanupErrors[0], { uri: feature.uri });
      }
    }
    if (featureHookFailed) this.runFailed = true;

    const status = featureHookFailed
      ? 'failed'
      : worstStatus(scenarios.map((s) => this.statuses.get(s.id) ?? 'skipped'));
    bus.emit({ type: 'featureFinished', uri: feature.uri, name: feature.name, status });
  }

  // ---------------------------------------------------------------- scenarios

  /** Run one scenario (one attempt). Returns its final status. */
  async runScenario(scenario: ScenarioInstance, runScope: Scope, featureScope: Scope, attempt = 1): Promise<Status> {
    const { bus } = this.opts;
    const started = Date.now();
    const scope = new Scope('scenario');
    const tagNames = scenario.tags.map((t) => t.name);
    const ids: Emitters = { scenarioId: scenario.id };
    bus.emit({ type: 'scenarioStarted', scenarioId: scenario.id, attempt, workerId: this.workerId });

    const ctx = this.makeStepContext(runScope, featureScope, scope, scenario, attempt, ids);
    const statuses: Status[] = [];
    let error: unknown;
    let skipReason: string | undefined;
    let blocked = false;
    const dry = !!this.opts.dryRun;

    if (!dry) {
      const before = await this.runHooks('scenario', 'before', ctx, tagFilter(tagNames), ids);
      if (before.status !== 'passed') {
        statuses.push(before.status);
        blocked = true;
        error ??= before.error;
        skipReason ??= before.skipReason;
      }
    }

    for (const step of scenario.steps) {
      const result = await this.runStep(step, scenario, ctx, tagNames, blocked || dry);
      statuses.push(result.status);
      if (result.status !== 'passed' && !blocked) {
        blocked = true;
        error ??= result.error;
        skipReason ??= result.skipReason;
      }
    }
    ctx.step = undefined;
    delete ids.stepId;

    if (!dry) {
      const after = await this.runHooks('scenario', 'after', ctx, tagFilter(tagNames), ids);
      if (after.status === 'failed') {
        statuses.push('failed');
        error ??= after.error;
      }
      const cleanupErrors = await scope.close();
      if (cleanupErrors.length) {
        statuses.push('failed');
        error ??= cleanupErrors[0];
        this.emitHookLikeError('scenario', 'after', 'scenario cleanup (defer)', cleanupErrors[0], ids);
      }
    }

    // Dry run: every matched step is reported 'skipped', so the scenario is 'skipped' unless something is undefined/ambiguous.
    const status = worstStatus(statuses);
    this.finishScenario(scenario, attempt, status, Date.now() - started, error, status === 'skipped' ? skipReason : undefined);
    return status;
  }

  private async runStep(
    step: StepInstance,
    scenario: ScenarioInstance,
    ctx: StepContext,
    tagNames: string[],
    blocked: boolean,
  ): Promise<{ status: Status; error?: unknown; skipReason?: string }> {
    const { bus, registry } = this.opts;
    const started = Date.now();
    const info: CurrentStepInfo = { id: step.id, keyword: step.keyword, text: step.text, line: step.line };
    ctx.step = info;
    const ids: Emitters = { scenarioId: scenario.id, stepId: step.id };
    this.currentIds(ctx).stepId = step.id;
    bus.emit({ type: 'stepStarted', scenarioId: scenario.id, stepId: step.id, keyword: step.keyword, text: step.text, line: step.line });

    const match = await registry.match(step.text, tagNames).catch((e: unknown) => ({ kind: 'error' as const, error: e }));
    const finish = (status: Status, extra: { error?: unknown; definition?: { pattern: string; location?: string }; candidates?: string[]; snippet?: string; skipReason?: string } = {}) => {
      this.summary.steps[status] += 1;
      this.summary.steps.total += 1;
      bus.emit({
        type: 'stepFinished',
        scenarioId: scenario.id,
        stepId: step.id,
        status,
        durationMs: Date.now() - started,
        ...(extra.error !== undefined ? { error: toErrorInfo(extra.error) } : {}),
        ...(extra.definition ? { definition: extra.definition } : {}),
        ...(extra.candidates ? { candidates: extra.candidates } : {}),
        ...(extra.snippet ? { snippet: extra.snippet } : {}),
      });
      return { status, ...(extra.error !== undefined ? { error: extra.error } : {}), ...(extra.skipReason ? { skipReason: extra.skipReason } : {}) };
    };

    if (match.kind === 'error') return finish('failed', { error: match.error });
    if (match.kind === 'undefined') return finish('undefined', { snippet: registry.snippetFor(step) });
    if (match.kind === 'ambiguous') {
      return finish('ambiguous', {
        candidates: match.candidates.map((c) => `${String(c.pattern)}${c.location ? ` (${c.location})` : ''}`),
        error: new Error(
          `Ambiguous step "${step.text}" matches ${match.candidates.length} definitions:\n` +
            match.candidates.map((c) => `  - ${String(c.pattern)}${c.location ? ` at ${c.location}` : ''}`).join('\n'),
        ),
      });
    }
    const definition = { pattern: String(match.definition.pattern), ...(match.definition.location ? { location: match.definition.location } : {}) };
    if (blocked) return finish('skipped', { definition });

    // before-step hooks
    const before = await this.runHooks('step', 'before', ctx, tagFilter(tagNames), ids);
    let status: Status = 'passed';
    let error: unknown;
    let skipReason: string | undefined;
    if (before.status !== 'passed') {
      status = before.status;
      error = before.error;
      skipReason = before.skipReason;
    } else {
      const args: unknown[] = [...match.values];
      if (step.argument?.kind === 'dataTable') args.push(new DataTable(step.argument.rows));
      if (step.argument?.kind === 'docString') args.push(new DocString(step.argument.content, step.argument.mediaType));
      const timeout = match.definition.timeoutMs ?? registry.defaultTimeoutMs;
      try {
        const ret = await withTimeout(`Step "${step.text}"`, timeout, () => match.definition.fn(ctx, ...args));
        if (ret === 'pending') status = 'pending';
      } catch (e) {
        ({ status, skipReason } = classify(e));
        error = e;
      }
    }
    const after = await this.runHooks('step', 'after', ctx, tagFilter(tagNames), ids);
    if (after.status === 'failed' && status === 'passed') {
      status = 'failed';
      error = after.error;
    }
    return finish(status, { definition, ...(error !== undefined && status !== 'skipped' ? { error } : {}), ...(skipReason ? { skipReason } : {}) });
  }

  private skipScenario(scenario: ScenarioInstance, reason: string): void {
    this.opts.bus.emit({ type: 'scenarioStarted', scenarioId: scenario.id, attempt: 1, workerId: this.workerId });
    this.finishScenario(scenario, 1, 'skipped', 0, undefined, reason);
  }

  private finishScenario(scenario: ScenarioInstance, attempt: number, status: Status, durationMs: number, error?: unknown, reason?: string) {
    this.statuses.set(scenario.id, status);
    this.summary.scenarios[status] += 1;
    this.summary.scenarios.total += 1;
    this.opts.bus.emit({
      type: 'scenarioFinished',
      scenarioId: scenario.id,
      attempt,
      status,
      durationMs,
      ...(error !== undefined && status !== 'skipped' ? { error: toErrorInfo(error) } : {}),
      ...(reason ? { reason } : {}),
    });
  }

  // ---------------------------------------------------------------- hooks

  /**
   * Run every hook of (level, kind) whose tag filter passes.
   * Before-hooks stop at the first failure (except `alwaysRun` ones); after-hooks always all run.
   */
  private async runHooks(
    level: HookLevel,
    kind: 'before' | 'after',
    ctx: RunContext,
    filter: (hook: HookDefinition) => boolean,
    ids: Emitters & { uri?: string },
  ): Promise<HookOutcome & { hookName?: string }> {
    const { bus, registry } = this.opts;
    let result: HookOutcome & { hookName?: string } = { status: 'passed' };
    for (const hook of registry.hooksFor(level, kind)) {
      if (!filter(hook)) continue;
      if (kind === 'before' && result.status !== 'passed' && !hook.alwaysRun) continue;
      const started = Date.now();
      const base = {
        hookId: hook.id,
        hookName: hook.name,
        level,
        kind,
        ...(ids.scenarioId ? { scenarioId: ids.scenarioId } : {}),
        ...(ids.stepId ? { stepId: ids.stepId } : {}),
        ...(ids.uri ? { uri: ids.uri } : {}),
      };
      bus.emit({ type: 'hookStarted', ...base });
      let status: Status = 'passed';
      let error: unknown;
      let skipReason: string | undefined;
      try {
        await withTimeout(`Hook "${hook.name}"`, hook.timeoutMs ?? registry.defaultTimeoutMs, () => (hook.fn as (c: RunContext) => unknown)(ctx));
      } catch (e) {
        ({ status, skipReason } = classify(e));
        error = e;
      }
      bus.emit({
        type: 'hookFinished',
        ...base,
        status,
        durationMs: Date.now() - started,
        ...(error !== undefined && status === 'failed' ? { error: toErrorInfo(error) } : {}),
      });
      if (status !== 'passed' && result.status === 'passed') {
        result = { status, hookName: hook.name, ...(error !== undefined ? { error } : {}), ...(skipReason ? { skipReason } : {}) };
      }
    }
    return result;
  }

  private emitHookLikeError(level: HookLevel, kind: 'before' | 'after', name: string, error: unknown, ids: Emitters & { uri?: string }) {
    const base = {
      hookId: `cleanup-${level}`,
      hookName: name,
      level,
      kind,
      ...(ids.scenarioId ? { scenarioId: ids.scenarioId } : {}),
      ...(ids.uri ? { uri: ids.uri } : {}),
    };
    this.opts.bus.emit({ type: 'hookStarted', ...base });
    this.opts.bus.emit({ type: 'hookFinished', ...base, status: 'failed', durationMs: 0, error: toErrorInfo(error) });
  }

  // ---------------------------------------------------------------- contexts

  private readonly idsByCtx = new WeakMap<object, Emitters>();

  private currentIds(ctx: object): Emitters {
    return this.idsByCtx.get(ctx) ?? {};
  }

  private makeRunContext(scope: Scope, ids: Emitters): RunContext {
    const bus = this.opts.bus;
    const ctx: RunContext = {
      run: scope.store,
      params: this.params,
      log: (message) => {
        const cur = this.currentIds(ctx);
        bus.emit({ type: 'log', message, ...(cur.scenarioId ? { scenarioId: cur.scenarioId } : {}), ...(cur.stepId ? { stepId: cur.stepId } : {}) });
      },
      attach: (body, mediaType = 'text/plain', name) => {
        const cur = this.currentIds(ctx);
        const binary = typeof body !== 'string';
        bus.emit({
          type: 'attachment',
          mediaType,
          encoding: binary ? 'base64' : 'identity',
          body: binary ? Buffer.from(body).toString('base64') : body,
          ...(name ? { name } : {}),
          ...(cur.scenarioId ? { scenarioId: cur.scenarioId } : {}),
          ...(cur.stepId ? { stepId: cur.stepId } : {}),
        });
      },
      defer: (fn) => scope.defer(fn),
    };
    this.idsByCtx.set(ctx, ids);
    return ctx;
  }

  private makeFeatureContext(runScope: Scope, featureScope: Scope, feature: FeatureInfo, rule: RuleRef | undefined, ids: Emitters): FeatureContext {
    const base = this.makeRunContext(runScope, ids);
    const ctx: FeatureContext = Object.assign(base, {
      feature: featureScope.store,
      featureInfo: feature,
      defer: (fn: () => unknown) => featureScope.defer(fn),
      ...(rule ? { rule } : {}),
    });
    this.idsByCtx.set(ctx, ids);
    return ctx;
  }

  private makeStepContext(runScope: Scope, featureScope: Scope, scope: Scope, s: ScenarioInstance, attempt: number, ids: Emitters): StepContext {
    const base = this.makeFeatureContext(runScope, featureScope, s.feature, s.rule, ids);
    const ctx: StepContext = Object.assign(base, {
      scenario: {
        id: s.id,
        name: s.name,
        uri: s.uri,
        line: s.line,
        featureName: s.feature.name,
        ...(s.rule ? { ruleName: s.rule.name } : {}),
        tags: s.tags.map((t) => t.name),
        meta: { ...s.meta },
        ...(s.example ? { example: { ...s.example.values } } : {}),
        attempt,
      },
      state: scope.store,
      defer: (fn: () => unknown) => scope.defer(fn),
      pending: (reason?: string): never => {
        throw new PendingSignal(reason);
      },
      skip: (reason?: string): never => {
        throw new SkipSignal(reason);
      },
    });
    this.idsByCtx.set(ctx, ids);
    return ctx;
  }
}

// ------------------------------------------------------------------ helpers

function classify(e: unknown): { status: Status; skipReason?: string } {
  if (e instanceof PendingSignal) return { status: 'pending' };
  if (e instanceof SkipSignal) return { status: 'skipped', skipReason: e.reason };
  return { status: 'failed' };
}

function tagFilter(tagNames: readonly string[]) {
  return (hook: HookDefinition) => !hook.tags || compileTagExpression(hook.tags)(tagNames);
}

function ruleTags(rule: RuleRef): string[] {
  return rule.tags.map((t) => t.name);
}

/** Keep plan order, but run each feature's scenarios together (first-appearance order). */
function groupByFeature(scenarios: readonly ScenarioInstance[]): Array<[ScenarioInstance[], FeatureInfo]> {
  const groups = new Map<string, [ScenarioInstance[], FeatureInfo]>();
  for (const s of scenarios) {
    const g = groups.get(s.uri);
    if (g) g[0].push(s);
    else groups.set(s.uri, [[s], s.feature]);
  }
  return [...groups.values()];
}

/** Convenience wrapper: `await execute(scenarios, { registry, bus })`. */
export function execute(scenarios: readonly ScenarioInstance[], options: ExecuteOptions): Promise<ExecuteResult> {
  return new Executor(options).execute(scenarios);
}

export type { ErrorInfo };
