# bddx

A BDD automation framework that keeps Gherkin's readability and adds TestNG-style orchestration:
groups, dependencies, mixed parallel/serial execution and layered retries.
TypeScript first, Java next. ("bddx" is a working name.)

> **Status:** Phases 0–1 and 4 complete; Phase 2 data core and Phase 3 orchestration (in-process) done. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Quick start

```bash
npm install
npm run build          # compile all packages (tsc -b)
npm test               # unit + conformance + CLI end-to-end tests (vitest)
npm run example        # run examples/basic through the real CLI
npm run verify         # typecheck + test + example, what CI should run
```

Requires Node.js 20.10 or newer.

## Writing tests

```gherkin
# features/basket.feature
Feature: Shopping basket
  @smoke @id:add-single
  Scenario: Add a single product
    When I add 2 "apple"
    Then the basket total is 1.00
```

```ts
// steps/basket.steps.ts
import { Given, When, Then, Before, defineParameterType } from '@bddx/runtime';

defineParameterType({ name: 'money', regexp: /\d+\.\d{2}/, transformer: (s) => Math.round(Number(s) * 100) });

Before((ctx) => ctx.state.set('basket', []));

When('I add {int} {string}', (ctx, qty: number, product: string) => {
  ctx.state.get<string[]>('basket').push(...Array(qty).fill(product));
});

Then('the basket total is {money}', (ctx, cents: number) => { /* assert */ });
```

Class-based steps with dependency injection:

```ts
import { CONTEXT, Given, Steps, Then, type StepContext } from '@bddx/runtime';

class Wallet {                       // any class can be injected; one instance per scenario
  static inject = [CONTEXT] as const;
  constructor(private ctx: StepContext) {}
  cents = 0;
}

@Steps()
class WalletSteps {
  static inject = [Wallet] as const;
  constructor(private wallet: Wallet) {}

  @Given('a wallet with {int} cents')
  fund(cents: number) { this.wallet.cents = cents; }
}
```

Data-driven scenarios from files (CSV, TSV, JSON, YAML, XLSX):

```gherkin
@data:users.csv?role=admin
Scenario: <name> can log in
  When I log in as "<name>"

Scenario Outline: credit limit for <who>
  Then <who> may spend <limit>

  @data:limits.xlsx#Admins?rows=1-10 @dataField:who=name
  Examples:
    | who | limit |
```

Orchestration: groups, dependencies, locks, priorities, parallel workers:

```gherkin
@id:login @group:setup
Scenario: Log in
  When I log in as "ann"            # ctx.export('token', …)

@checkout @dependsOn:login
Scenario Outline: Buy <product>     # ctx.from('login').get('token')
  ...

@lock:payments-db @priority:1
Scenario: Card payment
```

```ts
export default defineConfig({
  workers: 4,
  groups: {
    setup:    { mode: 'serial', priority: -10 },
    checkout: { mode: 'parallel', workers: 3, dependsOn: ['setup'], match: '@checkout' },
    reports:  { dependsOn: ['checkout'], onDependencyFailure: 'run' },
  },
});
```

Ungrouped scenarios run unconstrained by default; `defaultMode: 'serial'` makes them run one at a time (alongside groups).

Any config value can be overridden from the CLI without editing files:

```bash
bddx run -p ci --set workers=8 --set groups.checkout.mode=serial --set 'groups.api.dependsOn=["setup"]'
```

Logging with levels, attributed to the running scenario (also from helpers via the global `log`):

```ts
import { log } from '@bddx/runtime';
ctx.log.info('paying', { amount });   // in steps/hooks
log.warn('gateway slow');             // anywhere, e.g. page objects / API clients
```

Screenshots and images ride on log lines: `ctx.log.image('after login', await page.screenshot())`, or pass bytes as data
(`log.warn('layout broken', png)`).

The console shows `info` and above by default; `--log-level debug` also shows framework scheduling diagnostics.
Logs (and their images) appear in every report: the HTML report (`html` reporter: one self-contained file with filters,
steps, logs, screenshots, attachments), JUnit `<system-out>`/`<system-err>`, Cucumber JSON step `output`/`embeddings`,
and NDJSON (everything).

Step-level repeat and retry (tags at the end of a step):

```gherkin
Given I create user "user-{{i}}" with email "user{{i}}@example.com" @repeat:100 @concurrency:10
Then the export job is done @retry:5 @delay:1s @backoff:2
And the page shows "Saved" @timeout:10s
```

`@repeat` runs a step N times (`{{i}}`/`{{n}}` = iteration/total); `@retry` re-runs it until it passes. `@concurrency` is
for API/data steps only; browser steps declare `{ concurrent: false }`. BeforeStep/AfterStep run once per step, or per
attempt with `{ eachAttempt: true }`.

Resilience:

```gherkin
@retry:2                      # re-run the whole scenario until it passes (flaky passes are reported)
Scenario: Pay through a flaky API

@quarantine                   # known bug: runs and reports, never fails the build
Scenario: Exact totals (BUG-123)

@timeout:2m                   # time budget for the whole scenario
Scenario: Long import
```

```ts
retry: { scenario: 1, delay: '1s', on: ['TimeoutError', '/ECONNRESET/'] },
groups: { setup: { retry: 1, retryMembers: 'all' } },   // re-run a whole group (hooks included)
```

```ts
ctx.soft.check(receipt.total > 0, 'total is positive');  // soft assertions: all failures reported at step end
```

```bash
bddx run -f ndjson:reports/run1.ndjson                       # CI run
bddx run --rerun-failed reports/run1.ndjson -f ndjson:reports/run2.ndjson
bddx report reports/run1.ndjson reports/run2.ndjson -f html:reports/report.html -f junit:reports/junit.xml
```

`bddx plan` prints the graph (`--plan-format mermaid` for a diagram, `--explain <id>` for one scenario).

```ts
// bddx.config.ts
import { defineConfig } from '@bddx/cli';
export default defineConfig({
  features: 'features/**/*.feature',
  steps: 'steps/**/*.ts',
  reporters: ['console', 'junit:reports/junit.xml'],
  profiles: { ci: { reporters: ['progress', 'junit:reports/junit.xml'], failFast: true } },
});
```

## CLI

```
bddx [run] [paths...]  -t "@smoke and not @wip"  -p ci  -D env=qa  -f ndjson:reports/e.ndjson  --dry-run
bddx list  [paths...]  # ids + tags of selected scenarios
bddx snippets         # code for every undefined step
bddx plan [--explain <id>] [--plan-format text|json|mermaid]   # execution graph, runs nothing
bddx run -w 4 --no-deps   # 4 parallel workers; do not pull in dependencies
```

Paths accept files, folders, globs and `file.feature:LINE`. Exit codes: 0 passed, 1 failed, 2 usage/config/parse error.

## Repository layout

| Path | What |
| --- | --- |
| `packages/core` | Spec model, Gherkin compiler, tags, selection, event schema |
| `packages/runtime` | Step registry, hooks, scoped context, executor, global API |
| `packages/reporters` | console, HTML, NDJSON, JUnit XML, Cucumber JSON |
| `packages/cli` | `bddx` command, config loading, file discovery |
| `conformance` | Language-neutral features + expected results (Java must pass these too) |
| `examples/basic` | Small runnable project |
| `docs` | Implementation notes, progress log, decisions, roadmap |

## Documentation

- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md): how it works, module by module
- [docs/PROGRESS.md](docs/PROGRESS.md): what is done, what is next, how to resume
- [docs/DECISIONS.md](docs/DECISIONS.md): architecture decision records
- [docs/ROADMAP.md](docs/ROADMAP.md): all phases with concrete tasks
