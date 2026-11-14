import { defineConfig } from '@bddx/cli';

/**
 * Orchestration demo (Phase 3):
 *   setup     serial, runs first (everyone depends on it)
 *   checkout  parallel, max 3 at once, after setup
 *   payments  serial, holds the payments-db lock, after setup
 *   reports   after checkout AND payments, runs even if they failed (soft)
 */
export default defineConfig({
  features: 'features/**/*.feature',
  steps: 'steps/**/*.ts',
  workers: 4,
  groups: {
    setup: { mode: 'serial', priority: -10 },
    checkout: { mode: 'parallel', workers: 3, dependsOn: ['setup'], match: '@checkout' },
    payments: { mode: 'serial', dependsOn: ['setup'], locks: ['payments-db'] },
    reports: { dependsOn: ['checkout', 'payments'], onDependencyFailure: 'run' },
  },
  reporters: ['console', ['ndjson', { outputFile: 'reports/events.ndjson' }]],
});
