/**
 * Executor: runs a Plan (Phase 3) — features, rules, groups, scenarios, steps, hooks — and emits events.
 *
 * Execution order comes from the Scheduler (scheduler.ts): dependencies, priorities, locks, group modes and
 * `workers` decide what runs when. Feature / rule / group scopes are OPENED lazily by their first scenario
 * (Before* hooks run then) and CLOSED when their last scenario finishes or is skipped (After* hooks), using
 * reference counts, so they work with any order and with concurrency.
 *
 * Without an explicit plan, `execute()` builds one from the scenarios' tags with workers = 1, which keeps the
 * Phase 1 behaviour (serial, features together, file order).
 *
 * FAILURE SEMANTICS (keep docs/IMPLEMENTATION.md in sync):
 *  - BeforeAll fails      -> every scenario skipped (reason names the hook); AfterAll still runs; run fails.
 *  - BeforeGroup fails    -> the group's scenarios skipped; AfterGroup still runs; run fails.
 *  - BeforeFeature fails  -> the feature's scenarios skipped; AfterFeature still runs; run fails.
 *  - BeforeRule fails     -> the rule's scenarios skipped; AfterRule still runs; run fails.
 *  - Hard dependency did not pass -> scenario skipped "dependency failed: <id> (<status>)". Soft: runs anyway.
 *  - Before (scenario) fails -> later before-hooks skipped unless `alwaysRun`; steps skipped;
 *                            After hooks still run; scenario 'failed'.
 *  - A step fails         -> remaining steps 'skipped'; After hooks run; scenario 'failed'.
 *  - BeforeStep fails     -> that step 'failed' (body not run); AfterStep still runs.
 *  - After/AfterStep fails -> scenario/step becomes 'failed' even if steps passed.
 *  - defer() cleanup throws -> owning scenario/feature/group becomes 'failed'.
 *  - ctx.pending()        -> step 'pending', remaining steps skipped, scenario 'pending'.
 *  - ctx.skip(reason)     -> step 'skipped', remaining skipped, scenario 'skipped' with reason.
 *  - undefined / ambiguous step -> that status, remaining steps skipped.
 */
import {
  BDDX_VERSION,
  EVENT_SCHEMA_VERSION,
  buildPlan,
  compileTagExpression,
  emptySummary,
  toErrorInfo,
  worstStatus,
  type ErrorInfo,
  type EventBus,
  type FeatureInfo,
  type HookLevel,
  type ParsedSpec,
  type Plan,
  type PlanNode,
  type RuleRef,
  type RunSummary,
  type ScenarioInstance,
  type Status,
  type StepInstance,
} from '@bddx/core';
import { randomUUID } from 'node:crypto';
import { Scope, Store } from './context.js';
import { DataTable, DocString } from './datatable.js';
import type { SupportRegistry } from './registry.js';
import { schedule } from './scheduler.js';
import { createLogger, setFallbackLogger, withLogger } from './logger.js';
import { PendingSignal, SkipSignal, withTimeout } from './signals.js';
import type { CurrentStepInfo, FeatureContext, GroupContext, HookDefinition, RunContext, StepContext } from './types.js';

export interface ExecuteOptions {
  registry: SupportRegistry;
  bus: EventBus;
  /** Execution plan (groups, dependencies, workers). Default: built from scenario tags, workers = 1. */
  plan?: Plan;
  /** Parsed specs, only used to emit `specParsed` events. */
  specs?: ParsedSpec[];
  dryRun?: boolean;
  /** Stop starting new scenarios after the first failure. */
  failFast?: boolean;
  /** When true (default) pending/undefined/ambiguous scenarios fail the run. */
  strict?: boolean;
  params?: Record<string, string>;
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

/** A lazily opened, reference-counted scope (feature, rule or group). */
interface OpenScope {
  scope: Scope;
  opened: Promise<string | undefined>; // resolves to a fatal reason when its Before* hooks failed
  remaining: number;
  hookFailed: boolean;
  members: string[];
}

export class Executor {
  private readonly summary = emptySummary();
  private readonly statuses = new Map<string, Status>();
  private readonly params: Readonly<Record<string, string>>;
  private runFailed = false;
  private runError: unknown;
  private stopReason: string | undefined;
  private readonly exportsById = new Map<string, Record<string, unknown>>();
  // populated per run
  private runScope = new Scope('run');
  private plan!: Plan;
  private readonly features = new Map<string, OpenScope>();
  private readonly rules = new Map<string, OpenScope>();
  private readonly groups = new Map<string, OpenScope>();
  private readonly remaining = { features: new Map<string, number>(), rules: new Map<string, number>(), groups: new Map<string, number>() };

  constructor(private readonly opts: ExecuteOptions) {
    this.params = Object.freeze({ ...(opts.params ?? {}) });
  }

  async execute(scenarios: readonly ScenarioInstance[]): Promise<ExecuteResult> {
    const { bus, registry } = this.opts;
    const started = Date.now();
    registry.finalize();
    const plan = this.opts.plan ?? buildPlan(scenarios, scenarios, { workers: 1, withDeps: false });
    if (plan.errors.length) {
      throw new Error(`Invalid plan:\n${plan.errors.map((e) => `  ${e.uri ? `${e.uri}:${e.line} ` : ''}${e.message}`).join('\n')}`);
    }
    this.plan = plan;

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
      workers: plan.workers,
      groups: [...plan.groups.values()].map((g) => ({
        name: g.name,
        mode: g.mode,
        ...(g.workers !== undefined ? { workers: g.workers } : {}),
        dependsOn: g.dependsOn,
        members: g.members,
      })),
      scenarios: plan.nodes.map((n) => plannedScenario(n)),
    });

    // reference counts for lazily opened scopes
    for (const n of plan.nodes) {
      const s = n.scenario;
      inc(this.remaining.features, s.uri);
      if (s.rule) inc(this.remaining.rules, ruleKey(s));
      for (const g of this.realGroups(n)) inc(this.remaining.groups, g);
    }

    const runCtx = this.makeRunContext(this.runScope, {});
    setFallbackLogger(runCtx.log);
    this.debug(
      `plan: ${plan.nodes.length} scenario(s), workers=${plan.workers}, groups=[${[...plan.groups.keys()].join(', ')}]` +
        `${plan.nodes.some((n) => n.pulledInBy) ? `, ${plan.nodes.filter((n) => n.pulledInBy).length} pulled in as dependencies` : ''}`,
    );
    if (!this.opts.dryRun) {
      const outcome = await this.runHooks('run', 'before', runCtx, () => true, {});
      if (outcome.status === 'failed') {
        this.stopReason = `BeforeAll hook "${outcome.hookName}" failed`;
        this.runFailed = true;
        this.runError ??= outcome.error;
      }
    }

    await schedule(
      plan,
      {
        runNode: (node, workerId) => this.runNode(node, workerId),
        skipNode: async (node, reason) => {
          this.debug(`skip ${node.id}: ${reason}`, { scenarioId: node.id });
          this.skipScenario(node.scenario, reason, 'scheduler');
          await this.release(node);
        },
        stopReason: () => this.stopReason,
      },
      { ignoreDependencyResults: !!this.opts.dryRun },
    );

    if (!this.opts.dryRun) {
      const after = await this.runHooks('run', 'after', runCtx, () => true, {});
      if (after.status === 'failed') {
        this.runFailed = true;
        this.runError ??= after.error;
      }
      const cleanupErrors = await this.runScope.close();
      if (cleanupErrors.length) {
        this.runFailed = true;
        this.runError ??= cleanupErrors[0];
      }
    }

    setFallbackLogger(undefined);
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

  // ---------------------------------------------------------------- one plan node

  /** Framework diagnostics: `log` events with source 'bddx', level 'debug' (shown with --log-level debug). */
  private debug(message: string, ids: Emitters = {}): void {
    this.opts.bus.emit({ type: 'log', level: 'debug', source: 'bddx', message, ...(ids.scenarioId ? { scenarioId: ids.scenarioId } : {}) });
  }

  private async runNode(node: PlanNode, workerId: string): Promise<Status> {
    const s = node.scenario;
    const waited = node.deps.length ? ` after ${node.deps.map((d) => `${d.target}${d.soft ? '~' : ''}`).join(', ')}` : '';
    this.debug(`start ${node.id} on ${workerId}${waited}${node.locks.length ? ` holding ${node.locks.join(', ')}` : ''}`, { scenarioId: node.id });
    try {
      const groupStores: Record<string, Store> = {};
      for (const g of this.realGroups(node)) {
        const og = this.openGroup(g);
        const fatal = await og.opened;
        if (fatal) return this.skipScenario(s, fatal, workerId);
        groupStores[g] = og.scope.store;
      }
      const of = this.openFeature(s);
      const ffatal = await of.opened;
      if (ffatal) return this.skipScenario(s, ffatal, workerId);
      if (s.rule) {
        const rfatal = await this.openRule(s, of.scope).opened;
        if (rfatal) return this.skipScenario(s, rfatal, workerId);
      }
      const status = await this.runScenario(s, this.runScope, of.scope, 1, workerId, groupStores);
      if (status === 'failed' && this.opts.failFast) this.stopReason ??= 'fail-fast: an earlier scenario failed';
      return status;
    } finally {
      await this.release(node);
    }
  }

  /** Decrement scope counters; close scopes whose last member is done (rule, feature, then groups). */
  private async release(node: PlanNode): Promise<void> {
    const s = node.scenario;
    if (s.rule && dec(this.remaining.rules, ruleKey(s)) === 0) await this.closeRule(s);
    if (dec(this.remaining.features, s.uri) === 0) await this.closeFeature(s.feature);
    for (const g of this.realGroups(node)) if (dec(this.remaining.groups, g) === 0) await this.closeGroup(g);
  }

  /** Groups with hooks, stores and events (the implicit `default` group only affects scheduling). */
  private realGroups(node: PlanNode): string[] {
    return node.groups.filter((g) => !this.plan.groups.get(g)?.implicit);
  }

  // ---------------------------------------------------------------- lazily opened scopes

  private openFeature(s: ScenarioInstance): OpenScope {
    let f = this.features.get(s.uri);
    if (f) return f;
    const scope = new Scope('feature');
    const entry: OpenScope = { scope, remaining: 0, hookFailed: false, members: [], opened: Promise.resolve(undefined) };
    this.features.set(s.uri, entry);
    entry.opened = (async () => {
      this.opts.bus.emit({ type: 'featureStarted', uri: s.uri, name: s.feature.name });
      if (this.opts.dryRun) return undefined;
      const ctx = this.makeFeatureContext(this.runScope, scope, s.feature, undefined, {});
      const before = await this.runHooks('feature', 'before', ctx, tagFilter(s.feature.tags.map((t) => t.name)), { uri: s.uri });
      if (before.status === 'failed') {
        entry.hookFailed = true;
        return `BeforeFeature hook "${before.hookName}" failed`;
      }
      return undefined;
    })();
    return entry;
  }

  private async closeFeature(feature: FeatureInfo): Promise<void> {
    const f = this.features.get(feature.uri);
    if (!f) return; // never opened (all its scenarios were skipped before starting)
    await f.opened;
    if (!this.opts.dryRun) {
      const ctx = this.makeFeatureContext(this.runScope, f.scope, feature, undefined, {});
      const after = await this.runHooks('feature', 'after', ctx, tagFilter(feature.tags.map((t) => t.name)), { uri: feature.uri });
      if (after.status === 'failed') f.hookFailed = true;
      const cleanupErrors = await f.scope.close();
      if (cleanupErrors.length) {
        f.hookFailed = true;
        this.emitHookLikeError('feature', 'after', 'feature cleanup (defer)', cleanupErrors[0], { uri: feature.uri });
      }
    }
    if (f.hookFailed) this.runFailed = true;
    const members = this.plan.nodes.filter((n) => n.scenario.uri === feature.uri).map((n) => this.statuses.get(n.id) ?? 'skipped');
    this.opts.bus.emit({
      type: 'featureFinished',
      uri: feature.uri,
      name: feature.name,
      status: f.hookFailed ? 'failed' : worstStatus(members),
    });
  }

  private openRule(s: ScenarioInstance, featureScope: Scope): OpenScope {
    const key = ruleKey(s);
    let r = this.rules.get(key);
    if (r) return r;
    const entry: OpenScope = { scope: featureScope, remaining: 0, hookFailed: false, members: [], opened: Promise.resolve(undefined) };
    this.rules.set(key, entry);
    entry.opened = (async () => {
      if (this.opts.dryRun) return undefined;
      const ctx = this.makeFeatureContext(this.runScope, featureScope, s.feature, s.rule, {});
      const before = await this.runHooks('rule', 'before', ctx, tagFilter(ruleTags(s.rule!)), { uri: s.uri });
      if (before.status === 'failed') {
        entry.hookFailed = true;
        this.runFailed = true;
        return `BeforeRule hook "${before.hookName}" failed`;
      }
      return undefined;
    })();
    return entry;
  }

  private async closeRule(s: ScenarioInstance): Promise<void> {
    const r = this.rules.get(ruleKey(s));
    if (!r) return;
    await r.opened;
    if (this.opts.dryRun) return; // AfterRule runs even when BeforeRule failed
    const ctx = this.makeFeatureContext(this.runScope, r.scope, s.feature, s.rule, {});
    const after = await this.runHooks('rule', 'after', ctx, tagFilter(ruleTags(s.rule!)), { uri: s.uri });
    if (after.status === 'failed') this.runFailed = true;
  }

  private openGroup(name: string): OpenScope {
    let g = this.groups.get(name);
    if (g) return g;
    const scope = new Scope('group');
    const entry: OpenScope = { scope, remaining: 0, hookFailed: false, members: [], opened: Promise.resolve(undefined) };
    this.groups.set(name, entry);
    entry.opened = (async () => {
      this.opts.bus.emit({ type: 'groupStarted', group: name });
      if (this.opts.dryRun) return undefined;
      const ctx = this.makeGroupContext(scope, name);
      const before = await this.runHooks('group', 'before', ctx, groupFilter(name), {});
      if (before.status === 'failed') {
        entry.hookFailed = true;
        return `BeforeGroup hook "${before.hookName}" failed (group ${name})`;
      }
      return undefined;
    })();
    return entry;
  }

  private async closeGroup(name: string): Promise<void> {
    const g = this.groups.get(name);
    if (!g) return;
    await g.opened;
    if (!this.opts.dryRun) {
      const after = await this.runHooks('group', 'after', this.makeGroupContext(g.scope, name), groupFilter(name), {});
      if (after.status === 'failed') g.hookFailed = true;
      const cleanupErrors = await g.scope.close();
      if (cleanupErrors.length) {
        g.hookFailed = true;
        this.emitHookLikeError('group', 'after', `group ${name} cleanup (defer)`, cleanupErrors[0], {});
      }
    }
    if (g.hookFailed) this.runFailed = true;
    const members = (this.plan.groups.get(name)?.members ?? []).map((id) => this.statuses.get(id) ?? 'skipped');
    this.opts.bus.emit({ type: 'groupFinished', group: name, status: g.hookFailed ? 'failed' : worstStatus(members) });
  }

// ---------------------------------------------------------------- scenarios

  /** Run one scenario (one attempt). Returns its final status. */
  async runScenario(
    scenario: ScenarioInstance,
    runScope: Scope,
    featureScope: Scope,
    attempt = 1,
    workerId = 'w1',
    groupStores: Record<string, Store> = {},
  ): Promise<Status> {
    const { bus } = this.opts;
    const started = Date.now();
    const scope = new Scope('scenario');
    const tagNames = scenario.tags.map((t) => t.name);
    const ids: Emitters = { scenarioId: scenario.id };
    bus.emit({ type: 'scenarioStarted', scenarioId: scenario.id, attempt, workerId });

    const ctx = this.makeStepContext(runScope, featureScope, scope, scenario, attempt, ids, groupStores);
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
        const ret = await withTimeout(`Step "${step.text}"`, timeout, () => withLogger(ctx.log, () => match.definition.fn(ctx, ...args)));
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

  private skipScenario(scenario: ScenarioInstance, reason: string, workerId: string): Status {
    this.opts.bus.emit({ type: 'scenarioStarted', scenarioId: scenario.id, attempt: 1, workerId });
    this.finishScenario(scenario, 1, 'skipped', 0, undefined, reason);
    return 'skipped';
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
        await withTimeout(`Hook "${hook.name}"`, hook.timeoutMs ?? registry.defaultTimeoutMs, () =>
          withLogger(ctx.log, () => (hook.fn as (c: RunContext) => unknown)(ctx)),
        );
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
      log: createLogger((level, message, data) => {
        const cur = this.currentIds(ctx);
        bus.emit({
          type: 'log',
          level,
          source: 'user',
          message,
          ...(data !== undefined ? { data } : {}),
          ...(cur.scenarioId ? { scenarioId: cur.scenarioId } : {}),
          ...(cur.stepId ? { stepId: cur.stepId } : {}),
        });
      }),
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

  private makeGroupContext(scope: Scope, name: string): GroupContext {
    const base = this.makeRunContext(this.runScope, {});
    const ctx: GroupContext = Object.assign(base, {
      group: scope.store,
      groupName: name,
      defer: (fn: () => unknown) => scope.defer(fn),
    });
    return ctx;
  }

  private makeStepContext(
    runScope: Scope,
    featureScope: Scope,
    scope: Scope,
    s: ScenarioInstance,
    attempt: number,
    ids: Emitters,
    groupStores: Record<string, Store> = {},
  ): StepContext {
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
      groups: Object.freeze({ ...groupStores }),
      export: (key: string, value: unknown) => {
        let copy: unknown;
        try {
          copy = structuredClone(value);
        } catch {
          throw new Error(`ctx.export("${key}"): value must be serialisable (structured clone): plain data only`);
        }
        const bucket = this.exportsById.get(s.id) ?? {};
        bucket[key] = copy;
        this.exportsById.set(s.id, bucket);
      },
      from: (id: string) => {
        if (!this.statuses.has(id)) {
          const known = this.plan.byId.has(id);
          throw new Error(
            known
              ? `ctx.from("${id}"): that scenario has not finished yet. Add @dependsOn:${id} to wait for it.`
              : `ctx.from("${id}"): no scenario with this id in the plan`,
          );
        }
        const bucket = this.exportsById.get(id) ?? {};
        return {
          get: <T = unknown>(key: string): T => {
            if (!(key in bucket)) throw new Error(`Scenario "${id}" did not export "${key}". Exported: [${Object.keys(bucket).join(', ')}]`);
            return structuredClone(bucket[key]) as T;
          },
          has: (key: string) => key in bucket,
          keys: () => Object.keys(bucket),
        };
      },
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

function inc(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1);
}

function dec(m: Map<string, number>, k: string): number {
  const v = (m.get(k) ?? 0) - 1;
  m.set(k, v);
  return v;
}

function ruleKey(s: ScenarioInstance): string {
  return `${s.uri}#${s.rule?.id ?? ''}`;
}

/** Group hooks: no `tags` = every group; otherwise the expression sees `@group:<name>` and `@<name>`. */
function groupFilter(name: string) {
  return (hook: HookDefinition) => !hook.tags || compileTagExpression(hook.tags)([`@group:${name}`, `@${name}`]);
}

function plannedScenario(n: PlanNode) {
  const s = n.scenario;
  return {
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
    groups: n.groups,
    dependsOn: n.deps.map((d) => ({ id: d.target, soft: d.soft })),
    locks: n.locks,
    priority: n.priority,
    exclusive: n.exclusive,
    ...(n.pulledInBy ? { pulledInBy: n.pulledInBy } : {}),
  };
}

/** Convenience wrapper: `await execute(scenarios, { registry, bus })`. */
export function execute(scenarios: readonly ScenarioInstance[], options: ExecuteOptions): Promise<ExecuteResult> {
  return new Executor(options).execute(scenarios);
}

export type { ErrorInfo };
