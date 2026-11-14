# Roadmap and task checklist

Tick items as they land (`[x]`). Each phase ends with its gate. The design rationale lives in the
"Next-Gen BDD Framework — Research & Build Plan" doc; syntax proposals for later phases are copied here so this
file is self-contained.

## Phase 0: Foundations ✅

- [x] npm workspaces monorepo: core, runtime, reporters, cli
- [x] Internal model (`ScenarioInstance` etc.)
- [x] Gherkin parsing via `@cucumber/gherkin`, mapped to the model with lines, rules, examples, background flags
- [x] Stable scenario ids
- [x] Key/value tags + tag expressions + selection (tags, name, file:line, ids)
- [x] Event schema v1 + EventBus
- [x] Conformance suite skeleton (5 features)
- [ ] Gate: parse every Cucumber Compatibility Kit feature → *deferred: add CCK `.feature` files to `conformance/cck/` and a parse-only test*

## Phase 1: Core runner (TypeScript)

- [x] Cucumber Expressions + regex steps, custom parameter types
- [x] Scoped steps (`{ tags }`), ambiguity detection
- [x] Hooks: run, feature, rule, scenario, step (order, tags, alwaysRun, timeouts)
- [x] Scoped stores (run/feature/scenario) + `defer()` cleanup
- [x] Pending / skip / timeout handling
- [x] Console (pretty, progress), NDJSON, JUnit reporters
- [x] CLI: run, list, --dry-run with snippets, -t, --name, file:line, -p, -D, -f, --fail-fast, --no-strict
- [x] Config file (ts/js/json) with profiles
- [x] Example project
- [x] Class-based steps with decorators (`@Steps()` + `@Given`…) + DI container (`static inject`, per-scenario instances, `dispose()`)
- [x] Cucumber JSON reporter (`cucumber-json` / `json`)
- [x] `bddx snippets` command
- [ ] Gate: a real project runs end to end, serially

## Phase 2: Data-driven specs (in progress)

- [x] `DataLoader` / `DataProvider` interfaces in core (`createFileDataLoader`, extra providers by extension)
- [x] `@data:<file>[#selector][?col=val&rows=1-3,7]` on Scenario/Outline (adds Examples) or Examples (fills body)
- [x] Loaders: CSV, TSV (built-in RFC 4180 parser), JSON (dotted selector), YAML, XLSX (exceljs, sheet selector)
- [x] `@dataField:<placeholder>=<column>` mapping (feature/rule/scenario/examples)
- [x] `dataDir` config + per-profile override (`<dataDir>/<profile>/<file>`)
- [x] Stable ids for data rows: `<base>[<source>#<row>]`, base from the TEMPLATE name
- [x] Data errors = parse errors on the tag line (missing file/column, bad filter, no rows); scenario dropped, exit 2
- [ ] Data providers for SQL queries and HTTP endpoints (plugin API, phase 6)
- [ ] Gauge-style Markdown spec format (headings = scenarios, `*` = steps, tables) as a second parser
- [ ] Text-defined composite steps (`.steps.md` or `.concept` files)
- [ ] Call a scenario from a step: `Given I run scenario "X" from "y.feature"`
- [ ] Gate: same feature runs from inline Examples, CSV and XLSX with identical results

## Phase 3: Orchestration (the differentiator)

Proposed config:

```ts
groups: {
  setup:    { mode: 'serial', priority: 0 },
  checkout: { mode: 'parallel', workers: 4, dependsOn: ['setup'] },
  payments: { mode: 'serial', dependsOn: ['setup'], locks: ['payments-db'] },
  reports:  { mode: 'serial', dependsOn: ['checkout', 'payments'], onDependencyFailure: 'run' },
}
```

Tags: `@group:<name>`, `@id:<id>`, `@dependsOn:<id|group:name>[:soft]`, `@lock:<name>`, `@priority:<n>`, `@requires:<file.feature>`, `@exclusive`.

- [ ] Planner: build a DAG of instances and groups; validate (cycles, unknown ids, impossible locks) with readable errors
- [ ] `bddx plan` command: print the graph (text + JSON + mermaid)
- [ ] `--explain <id>`: why it runs / waits / is skipped
- [ ] `--with-deps` (default on): selecting a scenario pulls in its dependencies
- [ ] Scheduler: ready-queue by priority, honours group mode, worker caps, locks
- [ ] Worker processes (child_process fork), IPC of events, worker hooks + worker store
- [ ] Group hooks (BeforeGroup/AfterGroup) + group store
- [ ] Hard vs soft dependencies; skip reason `dependency failed: <id>`
- [ ] Exports between scenarios (`ctx.export(k,v)`, `ctx.from(id).get(k)`), serialised across processes
- [ ] Event schema additions: `workerStarted`, `groupStarted/Finished`, scenario `groupIds`, `waitedForMs`
- [ ] Conformance: features covering every dependency/lock/group rule
- [ ] Gate: groups, dependencies and locks demo passes

## Phase 4: Resilience

- [ ] Retry levels: step (`@retryStep(n, delay)`), scenario (`@retry(n)`), group (`groups.x.retry`), run (`--rerun-failed`)
- [ ] Policies: attempts, fixed/exponential delay, `retryOn` (error class / message / tag), `RetryAnalyzer` interface
- [ ] `attempt` hook level (BeforeAttempt/AfterAttempt)
- [ ] Flaky status (pass after fail), quarantine tag
- [ ] Rerun-failed from an NDJSON file + report merge
- [ ] Soft assertions helper
- [ ] Group/scenario timeouts

## Phase 5: Reporting + DX

- [ ] HTML report (single file): execution graph, timeline per worker, attempts, attachments
- [ ] Living documentation view (folder tree = requirements; README.md per folder)
- [ ] History store + flakiness score
- [ ] Cucumber Messages adapter (ADR-007)
- [ ] Interactive debug mode (pause on failure, inspect context)
- [ ] VS Code extension + language server (step completion, go to definition)
- [ ] Watch mode, CI sharding by duration

## Phase 6: Ecosystem

- [ ] Plugin API (data loaders, reporters, parameter types, retry analyzers, plan modifiers)
- [ ] Playwright integration (browser/page per scenario, traces as attachments)
- [ ] HTTP step library (Karate-style JSON matching)
- [ ] Allure reporter
- [ ] Step catalogue export (JSON) + MCP server for AI assistants
- [ ] TypeScript v1.0 release

## Phase 7: Java port

- [ ] JUnit Platform `TestEngine`, annotations (`@Given`, `@Before`…), Maven + Gradle plugins
- [ ] Same config schema (JSON/YAML), same event schema, same reports
- [ ] Passes `conformance/` unchanged
