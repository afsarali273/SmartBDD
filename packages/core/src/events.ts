/**
 * bddx event schema (v1).
 *
 * Everything that happens in a run is an event. Reporters, the debugger and
 * history tooling consume ONLY this stream, so it must be complete and stable.
 * Serialised as NDJSON (one JSON object per line).
 *
 * Rules for changing this file:
 *  - Adding optional fields is fine.
 *  - Renaming/removing fields or event types is a breaking change: bump EVENT_SCHEMA_VERSION
 *    and note it in docs/DECISIONS.md.
 *  - A Cucumber Messages adapter (phase 5) will translate this stream; keep it 1:1 mappable.
 */
import type { ErrorInfo, ParseErrorInfo, Status } from './model.js';

export const EVENT_SCHEMA_VERSION = 1;

export type HookLevel = 'run' | 'feature' | 'rule' | 'scenario' | 'step';
export type HookKind = 'before' | 'after';

interface Base {
  /** Milliseconds since epoch. */
  ts: number;
}

export interface RunStarted extends Base {
  type: 'runStarted';
  runId: string;
  schemaVersion: number;
  framework: { name: 'bddx'; version: string };
  runtime: { name: string; version: string };
  dryRun: boolean;
}

export interface SpecParsed extends Base {
  type: 'specParsed';
  uri: string;
  featureName?: string;
  scenarioCount: number;
  errors: ParseErrorInfo[];
}

export interface PlannedScenario {
  id: string;
  name: string;
  uri: string;
  line: number;
  featureName: string;
  ruleName?: string;
  /** Present for Scenario Outline rows. */
  example?: { name: string; index: number; values: Record<string, string> };
  tags: string[];
  steps: Array<{ id: string; keyword: string; text: string; line: number }>;
}

/** Emitted once, after selection, before anything executes. */
export interface PlanReady extends Base {
  type: 'planReady';
  scenarios: PlannedScenario[];
}

export interface FeatureStarted extends Base {
  type: 'featureStarted';
  uri: string;
  name: string;
}

export interface FeatureFinished extends Base {
  type: 'featureFinished';
  uri: string;
  name: string;
  status: Status;
}

export interface HookStarted extends Base {
  type: 'hookStarted';
  hookId: string;
  hookName: string;
  level: HookLevel;
  kind: HookKind;
  scenarioId?: string;
  stepId?: string;
  uri?: string;
}

export interface HookFinished extends Base {
  type: 'hookFinished';
  hookId: string;
  hookName: string;
  level: HookLevel;
  kind: HookKind;
  scenarioId?: string;
  stepId?: string;
  uri?: string;
  status: Status;
  durationMs: number;
  error?: ErrorInfo;
}

export interface ScenarioStarted extends Base {
  type: 'scenarioStarted';
  scenarioId: string;
  attempt: number;
  workerId: string;
}

export interface StepStarted extends Base {
  type: 'stepStarted';
  scenarioId: string;
  stepId: string;
  keyword: string;
  text: string;
  line: number;
}

export interface StepFinished extends Base {
  type: 'stepFinished';
  scenarioId: string;
  stepId: string;
  status: Status;
  durationMs: number;
  error?: ErrorInfo;
  /** Matched definition, when exactly one matched. */
  definition?: { pattern: string; location?: string };
  /** All candidate patterns, when status is 'ambiguous'. */
  candidates?: string[];
  /** Ready-to-paste code, when status is 'undefined'. */
  snippet?: string;
}

export interface Attachment extends Base {
  type: 'attachment';
  scenarioId?: string;
  stepId?: string;
  name?: string;
  mediaType: string;
  /** 'identity' = body is plain text; 'base64' = binary. */
  encoding: 'identity' | 'base64';
  body: string;
}

export interface Log extends Base {
  type: 'log';
  scenarioId?: string;
  stepId?: string;
  message: string;
}

export interface ScenarioFinished extends Base {
  type: 'scenarioFinished';
  scenarioId: string;
  attempt: number;
  status: Status;
  durationMs: number;
  error?: ErrorInfo;
  /** Why it was skipped, e.g. 'beforeFeature hook "seed db" failed'. */
  reason?: string;
}

export interface RunSummary {
  scenarios: Record<Status, number> & { total: number };
  steps: Record<Status, number> & { total: number };
  durationMs: number;
}

export interface RunFinished extends Base {
  type: 'runFinished';
  success: boolean;
  summary: RunSummary;
  error?: ErrorInfo;
}

export type BddxEvent =
  | RunStarted
  | SpecParsed
  | PlanReady
  | FeatureStarted
  | FeatureFinished
  | HookStarted
  | HookFinished
  | ScenarioStarted
  | StepStarted
  | StepFinished
  | Attachment
  | Log
  | ScenarioFinished
  | RunFinished;

export type BddxEventType = BddxEvent['type'];

/** Distributive Omit so `Omit<BddxEvent, 'ts'>` keeps the union discriminated. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EventInput = DistributiveOmit<BddxEvent, 'ts'>;

export type EventListener = (event: BddxEvent) => void | Promise<void>;

/**
 * Minimal ordered event bus.
 * Listeners are called synchronously in registration order. A listener may return a
 * promise (e.g. a file write); `flush()` waits for all of them. A throwing listener
 * never breaks the run: its error is collected and reported by `flush()`.
 */
export class EventBus {
  private listeners: EventListener[] = [];
  private pending: Promise<unknown>[] = [];
  private listenerErrors: unknown[] = [];
  readonly history: BddxEvent[] | undefined;

  constructor(options: { keepHistory?: boolean } = {}) {
    this.history = options.keepHistory ? [] : undefined;
  }

  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(input: EventInput): BddxEvent {
    const event = { ts: Date.now(), ...input } as BddxEvent;
    this.history?.push(event);
    for (const l of this.listeners) {
      try {
        const r = l(event);
        if (r && typeof (r as Promise<void>).then === 'function') {
          this.pending.push((r as Promise<void>).catch((e) => this.listenerErrors.push(e)));
        }
      } catch (e) {
        this.listenerErrors.push(e);
      }
    }
    return event;
  }

  async flush(): Promise<unknown[]> {
    while (this.pending.length) {
      const batch = this.pending;
      this.pending = [];
      await Promise.all(batch);
    }
    return this.listenerErrors;
  }
}

export function emptySummary(): RunSummary {
  const counts = () => ({ passed: 0, failed: 0, skipped: 0, pending: 0, undefined: 0, ambiguous: 0, total: 0 });
  return { scenarios: counts(), steps: counts(), durationMs: 0 };
}
