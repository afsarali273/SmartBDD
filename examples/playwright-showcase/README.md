# bddx + Playwright showcase

This is a standalone TypeScript automation project. **bddx is the only test runner**; Playwright supplies Chromium and
the HTTP client. The suite targets [The Internet](https://the-internet.herokuapp.com/), [SauceDemo](https://www.saucedemo.com/)
and [TodoMVC](https://demo.playwright.dev/todomvc/) for UI coverage, plus [JSONPlaceholder](https://jsonplaceholder.typicode.com/)
and [DummyJSON](https://dummyjson.com/) for API coverage.

## What runs

- 119 scenarios and 504 BDD steps: 65 UI scenarios, 48 API scenarios, 6 health/retry scenarios, across 11 feature files.
- Four process workers. A single `bddx run` mixes serial and parallel groups: `sauceDemo` and `dummyJson` are serial;
  `theInternet`, `jsonPlaceholder`, and `todoMvc` are parallel; all wait for the serial `health` group.
- One Chromium browser and API request context per worker; one isolated browser context and page per UI scenario.
- HTML, JUnit and NDJSON reports under `reports/`.

The public APIs fake writes rather than persisting them, so POST/PUT/PATCH/DELETE scenarios are safe to repeat and run
in parallel.

The execution plan is intentionally mixed:

| Group | Mode | Members | Purpose |
| --- | --- | ---: | --- |
| `health` | serial | 6 | Gate all public targets and demonstrate retry |
| `theInternet` | parallel ×2 | 30 | Existing UI coverage |
| `jsonPlaceholder` | parallel ×3 | 33 | Existing API coverage |
| `sauceDemo` | serial | 20 | Authentication, inventory and cart |
| `todoMvc` | parallel ×2 | 15 | Independent browser contexts and filtering |
| `dummyJson` | serial | 15 | Product and user API coverage |

## Install and run

Build bddx once from the repository root, then install this project's local dependencies and Chromium:

```bash
cd ../..
npm install
npm run build

cd examples/playwright-showcase
npm install
npx playwright install chromium
npm run verify
```

Useful commands:

```bash
npm run validate       # static bddx validation; executes no scenarios
npm run plan           # inspect groups and dependencies
npm test               # complete process-pool suite
npm run test:ui        # UI plus pulled-in health prerequisites
npm run test:api       # API plus pulled-in health prerequisites
npm run test:smoke
npm run test:inline    # same suite in one Node process
```

Override targets or browser visibility without editing the config:

```bash
npm test -- -D uiBaseUrl=https://example.test -D apiBaseUrl=https://api.example.test
npm test -- -D headless=false --set workers=1
```

## Framework coverage

| Capability | Where it is demonstrated |
| --- | --- |
| Gherkin Background, Rule, Scenario Outline | all 11 feature files |
| External CSV data | `data/post-ids.csv` via `@data` |
| Data tables and doc strings | API POST and PUT scenarios |
| Stable ids and scenario dependencies | health scenarios and `@dependsOn` |
| Groups, priorities, worker caps and group dependencies | `bddx.config.ts` |
| Mixed serial + parallel execution in one command | `health`, `sauceDemo`, `dummyJson` vs `theInternet`, `jsonPlaceholder`, `todoMvc` |
| Process pool and worker lifecycle | `pool: 'process'`, `BeforeWorker`/`AfterWorker` |
| Browser per worker, page per scenario | `src/support/hooks.ts` |
| Class steps and context injection | `InternetUiSteps` in `src/steps/ui.steps.ts` |
| Custom parameter type | `{apiResource}` in `src/steps/api.steps.ts` |
| Scoped stores and exports | hooks, response state, and health exports |
| Run/group/feature/scenario/step hooks | `src/support/hooks.ts` |
| Scenario retry and flaky reporting | controlled transient scenario in `health.feature` |
| Concurrent step repeat | API probe with `@repeat` and `@concurrency` |
| Soft assertions | API object data-table matching |
| Time budgets, retry backoff and worker-crash retry | `bddx.config.ts` |
| Logging and attachments | health logs, API response JSON, captured UI screenshot |
| Profiles and tag selection | `ci`, `ui`, `api`, and `smoke` profiles |
| HTML, JUnit and NDJSON reporting | `bddx.config.ts` reporters |

`reports/`, `node_modules/`, and browser downloads are not committed.
