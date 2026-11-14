import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BddxEvent, ErrorInfo, PlannedScenario, ScenarioFinished, StepFinished } from '@bddx/core';
import type { Reporter, ReporterOptions } from './types.js';

/**
 * JUnit XML for CI systems. One <testsuite> per feature, one <testcase> per scenario.
 * failed / undefined / ambiguous -> <failure>; skipped / pending -> <skipped>.
 */
export function junitReporter(raw: ReporterOptions = {}): Reporter {
  const outputFile = String(raw['outputFile'] ?? 'reports/junit.xml');
  const suiteName = String(raw['suiteName'] ?? 'bddx');
  const plan: PlannedScenario[] = [];
  const results = new Map<string, ScenarioFinished>();
  const failingStep = new Map<string, StepFinished>();
  let xml = '';

  return {
    name: 'junit',
    onEvent(e: BddxEvent) {
      if (e.type === 'planReady') plan.push(...e.scenarios);
      if (e.type === 'stepFinished' && e.status !== 'passed' && e.status !== 'skipped' && !failingStep.has(e.scenarioId)) {
        failingStep.set(e.scenarioId, e);
      }
      if (e.type === 'scenarioFinished') results.set(e.scenarioId, e);
      if (e.type === 'runFinished') xml = render(suiteName, plan, results, failingStep, e.summary.durationMs);
    },
    async close() {
      if (!xml) return;
      mkdirSync(dirname(outputFile), { recursive: true });
      writeFileSync(outputFile, xml, 'utf8');
    },
  };
}

export function render(
  suiteName: string,
  plan: PlannedScenario[],
  results: Map<string, ScenarioFinished>,
  failingStep: Map<string, StepFinished>,
  durationMs: number,
): string {
  const byFeature = new Map<string, PlannedScenario[]>();
  for (const s of plan) {
    const list = byFeature.get(s.uri) ?? [];
    list.push(s);
    byFeature.set(s.uri, list);
  }
  let tests = 0;
  let failures = 0;
  let skipped = 0;
  const suites: string[] = [];
  for (const [uri, scenarios] of byFeature) {
    let sFail = 0;
    let sSkip = 0;
    let sTime = 0;
    const cases = scenarios.map((s) => {
      const r = results.get(s.id);
      const status = r?.status ?? 'skipped';
      const time = (r?.durationMs ?? 0) / 1000;
      sTime += time;
      let body = '';
      if (status === 'failed' || status === 'undefined' || status === 'ambiguous') {
        sFail++;
        const step = failingStep.get(s.id);
        const err: ErrorInfo | undefined = r?.error ?? step?.error;
        const message = err?.message ?? (status === 'undefined' ? `Undefined step` : status);
        const detail = [step ? `Step: ${step.stepId}` : '', err?.stack ?? '', step?.snippet ?? ''].filter(Boolean).join('\n');
        body = `\n      <failure type="${status}" message="${esc(firstLine(message))}">${esc(detail || message)}</failure>\n    `;
      } else if (status === 'skipped' || status === 'pending') {
        sSkip++;
        body = `\n      <skipped message="${esc(r?.reason ?? status)}"/>\n    `;
      }
      return `    <testcase name="${esc(s.name)}" classname="${esc(s.featureName)}" file="${esc(uri)}" line="${s.line}" time="${time.toFixed(3)}">${body}</testcase>`;
    });
    tests += scenarios.length;
    failures += sFail;
    skipped += sSkip;
    suites.push(
      `  <testsuite name="${esc(scenarios[0]!.featureName)}" file="${esc(uri)}" tests="${scenarios.length}" failures="${sFail}" skipped="${sSkip}" errors="0" time="${sTime.toFixed(3)}">\n${cases.join('\n')}\n  </testsuite>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${esc(suiteName)}" tests="${tests}" failures="${failures}" skipped="${skipped}" errors="0" time="${(durationMs / 1000).toFixed(3)}">\n${suites.join('\n')}\n</testsuites>\n`;
}

function firstLine(s: string): string {
  return s.split('\n')[0] ?? '';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
