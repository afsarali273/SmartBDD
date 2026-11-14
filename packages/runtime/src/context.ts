/**
 * Scoped state.
 *
 * Scopes (outermost first): run (= the process: seeded from the parent with worker processes) > group > feature > scenario.
 *
 * Each scope owns:
 *  - a Store: a typed key/value map that lives exactly as long as the scope
 *  - a cleanup stack: functions registered with defer(), run LIFO when the scope ends,
 *    even if the scope failed. Cleanup errors are collected, never swallowed.
 */
export class Store {
  private readonly map = new Map<string, unknown>();

  get<T = unknown>(key: string): T {
    if (!this.map.has(key)) {
      throw new Error(`No value stored under "${key}". Stored keys: [${[...this.map.keys()].join(', ')}]`);
    }
    return this.map.get(key) as T;
  }

  find<T = unknown>(key: string): T | undefined {
    return this.map.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): T {
    this.map.set(key, value);
    return value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  /** Get the value, creating it on first access. */
  getOrSet<T>(key: string, create: () => T): T {
    if (!this.map.has(key)) this.map.set(key, create());
    return this.map.get(key) as T;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  toJSON(): Record<string, unknown> {
    return Object.fromEntries(this.map);
  }
}

export type Cleanup = () => unknown | Promise<unknown>;

export type ScopeLevel = 'run' | 'group' | 'feature' | 'scenario';

export class Scope {
  readonly store = new Store();
  private readonly cleanups: Cleanup[] = [];

  constructor(readonly level: ScopeLevel) {}

  defer(fn: Cleanup): void {
    this.cleanups.push(fn);
  }

  /** Run cleanups LIFO. Returns the errors thrown by cleanups (empty when all succeeded). */
  async close(): Promise<unknown[]> {
    const errors: unknown[] = [];
    while (this.cleanups.length) {
      const fn = this.cleanups.pop()!;
      try {
        await fn();
      } catch (e) {
        errors.push(e);
      }
    }
    return errors;
  }
}
