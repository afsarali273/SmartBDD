/**
 * ADAPTER: Cucumber Expressions ({int}, {string}, {word}, custom types) + regular expressions,
 * via @cucumber/cucumber-expressions. The ONLY runtime file importing it.
 */
import {
  CucumberExpression,
  CucumberExpressionGenerator,
  ParameterType,
  ParameterTypeRegistry,
  RegularExpression,
  type Expression,
} from '@cucumber/cucumber-expressions';
import type { ParameterTypeOptions, StepExpressionEngine } from '../ports.js';

const NUMERIC = new Set(['int', 'float', 'double', 'bigdecimal', 'byte', 'short', 'long', 'biginteger']);

export function createCucumberExpressionEngine(): StepExpressionEngine {
  const registry = new ParameterTypeRegistry();
  return {
    name: 'cucumber-expressions',
    defineParameterType<T>(opts: ParameterTypeOptions<T>) {
      registry.defineParameterType(
        new ParameterType<T>(
          opts.name,
          opts.regexp as never,
          null,
          opts.transformer ?? ((s: string) => s as unknown as T),
          opts.useForSnippets ?? true,
          opts.preferForRegexpMatch ?? false,
        ),
      );
    },
    compile(pattern) {
      const expression: Expression =
        typeof pattern === 'string' ? new CucumberExpression(pattern, registry) : new RegularExpression(pattern, registry);
      return {
        source: String(pattern),
        match(text) {
          const args = expression.match(text);
          if (!args) return null;
          return { values: () => Promise.all(args.map((a) => a.getValue(null))) };
        },
      };
    },
    suggest(text) {
      const [best] = new CucumberExpressionGenerator(() => registry.parameterTypes).generateExpressions(text);
      if (!best) return undefined;
      return {
        pattern: best.source,
        parameters: best.parameterNames.map((name, i) => ({
          name,
          type: NUMERIC.has(best.parameterTypes[i]?.name ?? '') ? 'number' : 'string',
        })),
      };
    },
  };
}
