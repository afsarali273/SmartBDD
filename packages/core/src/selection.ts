import type { ScenarioInstance } from './model.js';
import { compileTagExpression } from './tags.js';

/**
 * Which scenarios to run. All criteria are ANDed.
 * (Phase 3 adds `--with-deps`: selected scenarios pull in their dependencies.)
 */
export interface SelectionCriteria {
  /** Cucumber tag expression. */
  tags?: string;
  /** Regex (string) matched against the scenario name. */
  name?: string;
  /**
   * Line filters per uri: `features/a.feature:12` style. A scenario matches when one
   * of the lines is its own line, an example row line, or falls inside its step range.
   */
  lines?: Record<string, number[]>;
  /** Explicit scenario ids. */
  ids?: string[];
}

export function selectScenarios(all: readonly ScenarioInstance[], criteria: SelectionCriteria): ScenarioInstance[] {
  const tagPred = compileTagExpression(criteria.tags);
  const nameRe = criteria.name ? new RegExp(criteria.name) : undefined;
  const ids = criteria.ids ? new Set(criteria.ids) : undefined;
  return all.filter((s) => {
    if (!tagPred(s.tags.map((t) => t.name))) return false;
    if (nameRe && !nameRe.test(s.name)) return false;
    if (ids && !ids.has(s.id)) return false;
    if (criteria.lines) {
      const wanted = criteria.lines[s.uri];
      if (wanted && !wanted.some((l) => matchesLine(s, l))) return false;
    }
    return true;
  });
}

function matchesLine(s: ScenarioInstance, line: number): boolean {
  if (s.line === line) return true;
  if (s.example?.line === line) return true;
  // Scenario keyword line for an outline row: allow selecting all rows by the outline line.
  const own = s.steps.filter((st) => !st.fromBackground);
  if (!s.example && own.length) {
    const first = Math.min(s.line, ...own.map((x) => x.line));
    const last = Math.max(...own.map((x) => x.line));
    if (line >= first && line <= last) return true;
  }
  return false;
}

/** Parse `path/to/file.feature:12:20` into `{ path, lines }`. */
export function parsePathWithLines(arg: string): { path: string; lines: number[] } {
  const m = /^(.*?)((?::\d+)+)$/.exec(arg);
  if (!m) return { path: arg, lines: [] };
  return {
    path: m[1]!,
    lines: m[2]!
      .split(':')
      .filter(Boolean)
      .map((n) => Number(n)),
  };
}
