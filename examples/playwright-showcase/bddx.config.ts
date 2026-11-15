import { defineConfig } from '@bddx/cli';

export default defineConfig({
  features: 'features/**/*.feature',
  steps: ['src/support/hooks.ts', 'src/steps/**/*.ts'],
  dataDir: 'data',
  workers: 4,
  pool: 'process',
  stepTimeoutMs: 15_000,
  scenarioTimeout: '45s',
  runTimeout: '5m',
  logLevel: 'info',
  params: {
    uiBaseUrl: 'https://the-internet.herokuapp.com',
    apiBaseUrl: 'https://jsonplaceholder.typicode.com',
    sauceBaseUrl: 'https://www.saucedemo.com',
    todoBaseUrl: 'https://demo.playwright.dev/todomvc',
    dummyApiBaseUrl: 'https://dummyjson.com',
    headless: 'true',
  },
  retry: {
    scenario: 1,
    delay: '250ms',
    backoff: 2,
    workerCrash: 1,
    on: ['TimeoutError', '/ECONNRESET/', '/fetch failed/', '/socket hang up/', '/controlled transient/'],
  },
  groups: {
    health: { match: '@health', mode: 'serial', priority: -100, timeout: '1m' },
    theInternet: { match: '@the-internet', mode: 'parallel', workers: 2, dependsOn: ['health'], timeout: '3m' },
    jsonPlaceholder: { match: '@jsonplaceholder', mode: 'parallel', workers: 3, dependsOn: ['health'], timeout: '2m' },
    sauceDemo: {
      match: '@saucedemo',
      mode: 'serial',
      dependsOn: ['health'],
      locks: ['saucedemo-standard-user'],
      timeout: '3m',
    },
    todoMvc: { match: '@todomvc', mode: 'parallel', workers: 2, dependsOn: ['health'], timeout: '2m' },
    dummyJson: { match: '@dummyjson', mode: 'serial', dependsOn: ['health'], timeout: '2m' },
  },
  validation: {
    allowedTagKeys: [
      'api', 'capture', 'dummyjson', 'health', 'jsonplaceholder', 'owner', 'saucedemo', 'smoke',
      'the-internet', 'todomvc', 'ui',
    ],
  },
  reporters: [
    'console',
    ['html', { outputFile: 'reports/report.html', title: 'bddx + Playwright showcase' }],
    ['junit', { outputFile: 'reports/junit.xml', suiteName: 'bddx-playwright-showcase' }],
    ['ndjson', { outputFile: 'reports/events.ndjson' }],
  ],
  profiles: {
    ci: {
      reporters: ['progress', 'junit:reports/junit.xml', 'ndjson:reports/events.ndjson'],
      logLevel: 'warn',
      failFast: true,
    },
    ui: { tags: '@ui' },
    api: { tags: '@api' },
    smoke: { tags: '@smoke' },
  },
});
