# bddx

A BDD automation framework that keeps Gherkin's readability and adds TestNG-style orchestration:
groups, dependencies, mixed parallel/serial execution and layered retries.
TypeScript first, Java next. ("bddx" is a working name.)

> **Status:** Phase 0 complete, Phase 1 mostly complete. See [docs/PROGRESS.md](docs/PROGRESS.md).

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
```

Paths accept files, folders, globs and `file.feature:LINE`. Exit codes: 0 passed, 1 failed, 2 usage/config/parse error.

## Repository layout

| Path | What |
| --- | --- |
| `packages/core` | Spec model, Gherkin compiler, tags, selection, event schema |
| `packages/runtime` | Step registry, hooks, scoped context, executor, global API |
| `packages/reporters` | console, NDJSON, JUnit XML |
| `packages/cli` | `bddx` command, config loading, file discovery |
| `conformance` | Language-neutral features + expected results (Java must pass these too) |
| `examples/basic` | Small runnable project |
| `docs` | Implementation notes, progress log, decisions, roadmap |

## Documentation

- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md): how it works, module by module
- [docs/PROGRESS.md](docs/PROGRESS.md): what is done, what is next, how to resume
- [docs/DECISIONS.md](docs/DECISIONS.md): architecture decision records
- [docs/ROADMAP.md](docs/ROADMAP.md): all phases with concrete tasks
