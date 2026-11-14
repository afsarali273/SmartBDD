import {
  CucumberExpression,
  CucumberExpressionGenerator,
  ParameterType,
  ParameterTypeRegistry,
  RegularExpression,
  type Expression,
} from '@cucumber/cucumber-expressions';
import { compileTagExpression, createIdGenerator, type HookKind, type HookLevel, type StepInstance, type TagPredicate } from '@bddx/core';
import type {
  AnyHookFn,
  FeatureHookFn,
  HookDefinition,
  HookOptions,
  RunHookFn,
  ScenarioHookFn,
  StepFn,
  StepOptions,
} from './types.js';

export interface StepDefinition {
  id: string;
  pattern: string | RegExp;
  fn: StepFn;
  tags?: string;
  timeoutMs?: number;
  location?: string;
  seq: number;
}

export interface ParameterTypeOptions<T> {
  name: string;
  regexp: RegExp | string | readonly (RegExp | string)[];
  transformer?: (...match: string[]) => T | PromiseLike<T>;
  useForSnippets?: boolean;
  preferForRegexpMatch?: boolean;
}

export type MatchResult =
  | { kind: 'match'; definition: StepDefinition; values: unknown[] }
  | { kind: 'undefined' }
  | { kind: 'ambiguous'; candidates: StepDefinition[] };

interface CompiledStep {
  def: StepDefinition;
  expression: Expression;
  scope?: TagPredicate;
}

/**
 * Holds everything users register from support code: steps, hooks, parameter types.
 *
 * Expressions are compiled lazily (on first match / `finalize()`), so parameter types
 * may be defined after the steps that use them, in any file load order.
 */
export class SupportRegistry {
  readonly parameterTypes = new ParameterTypeRegistry();
  private readonly steps: StepDefinition[] = [];
  private readonly hooks: HookDefinition[] = [];
  private compiled: CompiledStep[] | undefined;
  private seq = 0;
  private nextStepId = createIdGenerator('step-def-');
  private nextHookId = createIdGenerator('hook-');
  defaultTimeoutMs = 30_000;

  defineStep(pattern: string | RegExp, fn: StepFn, options: StepOptions = {}, location?: string): StepDefinition {
    if (typeof fn !== 'function') throw new Error(`Step "${String(pattern)}" needs a function`);
    const def: StepDefinition = { id: this.nextStepId(), pattern, fn, seq: this.seq++ };
    if (options.tags) def.tags = options.tags;
    if (options.timeoutMs !== undefined) def.timeoutMs = options.timeoutMs;
    if (location) def.location = location;
    this.steps.push(def);
    this.compiled = undefined;
    return def;
  }

  defineHook(level: 'run', kind: HookKind, options: HookOptions, fn: RunHookFn, location?: string): HookDefinition;
  defineHook(level: 'feature' | 'rule', kind: HookKind, options: HookOptions, fn: FeatureHookFn, location?: string): HookDefinition;
  defineHook(level: 'scenario' | 'step', kind: HookKind, options: HookOptions, fn: ScenarioHookFn, location?: string): HookDefinition;
  defineHook(level: HookLevel, kind: HookKind, options: HookOptions, fn: AnyHookFn, location?: string): HookDefinition;
  defineHook(level: HookLevel, kind: HookKind, options: HookOptions, fn: AnyHookFn, location?: string): HookDefinition {
    if (typeof fn !== 'function') throw new Error(`${kind} ${level} hook needs a function`);
    const id = this.nextHookId();
    const hook: HookDefinition = {
      id,
      name: options.name ?? `${kind}${level[0]!.toUpperCase()}${level.slice(1)}${location ? ` (${location})` : ` #${id}`}`,
      level,
      kind,
      order: options.order ?? 0,
      alwaysRun: options.alwaysRun ?? false,
      fn,
      seq: this.seq++,
    };
    if (options.tags) {
      compileTagExpression(options.tags); // validate early
      hook.tags = options.tags;
    }
    if (options.timeoutMs !== undefined) hook.timeoutMs = options.timeoutMs;
    if (location) hook.location = location;
    this.hooks.push(hook);
    return hook;
  }

  defineParameterType<T>(opts: ParameterTypeOptions<T>): void {
    this.parameterTypes.defineParameterType(
      new ParameterType<T>(
        opts.name,
        opts.regexp as never,
        null,
        opts.transformer ?? ((s: string) => s as unknown as T),
        opts.useForSnippets ?? true,
        opts.preferForRegexpMatch ?? false,
      ),
    );
    this.compiled = undefined;
  }

  /** Compile all expressions now. Throws on the first invalid expression with its location. */
  finalize(): void {
    if (this.compiled) return;
    this.compiled = this.steps.map((def) => {
      let expression: Expression;
      try {
        expression =
          typeof def.pattern === 'string'
            ? new CucumberExpression(def.pattern, this.parameterTypes)
            : new RegularExpression(def.pattern, this.parameterTypes);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid step pattern "${String(def.pattern)}"${def.location ? ` at ${def.location}` : ''}: ${msg}`);
      }
      const c: CompiledStep = { def, expression };
      if (def.tags) c.scope = compileTagExpression(def.tags);
      return c;
    });
  }

  /**
   * Find the definition for a step.
   * Scoping rule: definitions whose `tags` scope matches the scenario beat unscoped ones;
   * definitions whose scope does NOT match are ignored. Two winners = ambiguous.
   */
  async match(text: string, scenarioTags: readonly string[]): Promise<MatchResult> {
    this.finalize();
    const hits: Array<{ c: CompiledStep; args: NonNullable<ReturnType<Expression['match']>> }> = [];
    for (const c of this.compiled!) {
      if (c.scope && !c.scope(scenarioTags)) continue;
      const args = c.expression.match(text);
      if (args) hits.push({ c, args });
    }
    if (hits.length === 0) return { kind: 'undefined' };
    const scoped = hits.filter((h) => h.c.scope);
    const winners = scoped.length ? scoped : hits;
    if (winners.length > 1) return { kind: 'ambiguous', candidates: winners.map((w) => w.c.def) };
    const { c, args } = winners[0]!;
    const values = await Promise.all(args.map((a) => a.getValue(null)));
    return { kind: 'match', definition: c.def, values };
  }

  hooksFor(level: HookLevel, kind: HookKind): HookDefinition[] {
    const list = this.hooks.filter((h) => h.level === level && h.kind === kind);
    // before: order asc, then registration order. after: exact reverse.
    list.sort((a, b) => a.order - b.order || a.seq - b.seq);
    return kind === 'after' ? list.reverse() : list;
  }

  get stepDefinitions(): readonly StepDefinition[] {
    return this.steps;
  }

  get hookDefinitions(): readonly HookDefinition[] {
    return this.hooks;
  }

  /** Ready-to-paste TypeScript for an undefined step. */
  snippetFor(step: Pick<StepInstance, 'text' | 'keywordType' | 'argument'>): string {
    const generator = new CucumberExpressionGenerator(() => this.parameterTypes.parameterTypes);
    const [best] = generator.generateExpressions(step.text);
    const keyword = step.keywordType === 'action' ? 'When' : step.keywordType === 'outcome' ? 'Then' : 'Given';
    const pattern = best ? best.source : step.text;
    const params: string[] = ['ctx'];
    if (best) {
      best.parameterNames.forEach((name, i) => {
        const t = best.parameterTypes[i]?.name;
        const ts = t === 'int' || t === 'float' || t === 'double' || t === 'bigdecimal' ? 'number' : 'string';
        params.push(`${name}: ${ts}`);
      });
    }
    if (step.argument?.kind === 'dataTable') params.push('table: DataTable');
    if (step.argument?.kind === 'docString') params.push('docString: string');
    const quoted = `'${pattern.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    return `${keyword}(${quoted}, async (${params.join(', ')}) => {\n  ctx.pending();\n});`;
  }
}

const GLOBAL_KEY = Symbol.for('bddx.registry.v1');
type GlobalWithRegistry = typeof globalThis & { [GLOBAL_KEY]?: SupportRegistry };

/**
 * The process-wide registry that the global API (Given/When/Then/Before…) writes to.
 * Stored on globalThis so two copies of this package (e.g. CLI + project) still share it.
 */
export function getGlobalRegistry(): SupportRegistry {
  const g = globalThis as GlobalWithRegistry;
  return (g[GLOBAL_KEY] ??= new SupportRegistry());
}

/** Replace the global registry with an empty one (tests, watch mode). */
export function resetGlobalRegistry(): SupportRegistry {
  const g = globalThis as GlobalWithRegistry;
  g[GLOBAL_KEY] = new SupportRegistry();
  return g[GLOBAL_KEY];
}

/** Best-effort "file:line" of the user code that called a registration function. */
export function callerLocation(): string | undefined {
  const stack = new Error().stack?.split('\n').slice(1) ?? [];
  for (const frame of stack) {
    if (/[\\/](runtime)[\\/](src|dist)[\\/]/.test(frame) || frame.includes('node:internal')) continue;
    const m = /\(?((?:file:\/\/)?[^()\s]+):(\d+):\d+\)?\s*$/.exec(frame);
    if (m) return `${m[1]!.replace(/^file:\/\//, '')}:${m[2]}`;
  }
  return undefined;
}
