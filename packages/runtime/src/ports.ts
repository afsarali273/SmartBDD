/**
 * PORT: step expression engine. Turns a step pattern ("I add {int} {string}" or a RegExp) into
 * a matcher, owns custom parameter types, and suggests patterns for undefined steps.
 * Default adapter: ./adapters/cucumber-expressions.ts. No other runtime file imports the library.
 */

export interface ParameterTypeOptions<T> {
  name: string;
  regexp: RegExp | string | readonly (RegExp | string)[];
  transformer?: (...match: string[]) => T | PromiseLike<T>;
  useForSnippets?: boolean;
  preferForRegexpMatch?: boolean;
}

export interface CompiledStepPattern {
  readonly source: string;
  /** null = no match. Otherwise a thunk producing the (possibly async-transformed) argument values. */
  match(text: string): { values(): Promise<unknown[]> } | null;
}

export interface StepSuggestion {
  pattern: string;
  parameters: Array<{ name: string; type: 'number' | 'string' }>;
}

export interface StepExpressionEngine {
  readonly name: string;
  defineParameterType<T>(options: ParameterTypeOptions<T>): void;
  /** Throws a readable error for invalid patterns or unknown parameter types. */
  compile(pattern: string | RegExp): CompiledStepPattern;
  /** Best pattern for an undefined step's text (for snippets). */
  suggest(text: string): StepSuggestion | undefined;
}
