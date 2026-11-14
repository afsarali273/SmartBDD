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
- [ ] Text-defined composite steps (`.steps.md` or `.concept` files)
- [ ] Call a scenario from a step: `Given I run scenario "X" from "y.feature"`
- [ ] Gate: same feature runs from inline Examples, CSV and XLSX with identical results

## Cross-cutting: own architecture, swappable third-party parts

- [x] Ports (`core/src/ports.ts`, `runtime/src/ports.ts`): `SpecParser`, `TagExpressionEngine`, `StepExpressionEngine`
- [x] Cucumber libraries isolated in `adapters/` (only files allowed to import them); spec parser registry by suffix
- [x] TestNG-style hook names (`BeforeSuite`/`AfterSuite`) and hook decorators on static methods at every level

## Phase 3: Orchestration (the differentiator) — in progress

- [x] `defaultMode` / `groups.default` for ungrouped scenarios (implicit group: scheduling only)
- [x] `--set path=value` overrides for any config option
- [x] Levelled logging (`ctx.log.*`, global `log` via AsyncLocalStorage, `--log-level`, framework diagnostics)
- [x] Logs with images (`ctx.log.image`, bytes as data); logs in HTML / JUnit / Cucumber JSON reports
- [x] Step-level `@repeat` / `@retry` / `@delay` / `@backoff` / `@timeout` / `@concurrency` (owner's request; pulled
      forward from Phase 4), `{{i}}`/`{{n}}`, `eachAttempt` step hooks, definition `retry` + `concurrent:false`

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

- [x] Planner (`core/src/plan`): DAG of instances + groups; validates cycles, unknown ids/groups, bad priority/workers
- [x] `bddx plan` (`--plan-format text|json|mermaid`)
- [x] `bddx plan --explain <id>`
- [x] Dependencies of selected scenarios are pulled in by default (`--no-deps` to disable); deps resolved across all spec files
- [x] Scheduler (`runtime/src/scheduler.ts`): ready queue by priority, workers, group modes/caps, locks, exclusive (in-process async)
- [ ] Worker processes (child_process fork), IPC of events, worker hooks + worker store (NEXT)
- [x] Group hooks (BeforeGroup/AfterGroup) + group store (`ctx.groups[name]`); feature/rule/group scopes ref-counted
- [x] Hard vs soft dependencies; skip reason `dependency failed: <id> (<status>)`; group `onDependencyFailure`
- [x] Exports between scenarios (`ctx.export`, `ctx.from(id).get`), structured-clone copies (ready for processes)
- [x] Events: `groupStarted/Finished`, planReady `workers`/`groups`, PlannedScenario `groups/dependsOn/locks/priority/exclusive/pulledInBy`
- [ ] Events: `workerStarted`, `waitedForMs` (with worker processes)
- [x] Conformance: `dependencies.feature` (hard/soft/priority); timing rules covered by runtime tests
- [ ] `@requires:<file.feature>` spec-level preconditions
- [ ] HTML/console view of the executed graph (timeline per worker) — Phase 5
- [x] Gate: groups, dependencies and locks demo passes (`examples/orchestration`, `npm run example:orchestration`)

## Phase 4: Resilience

- [x] Step retry (done early: `@retry:N` on steps, `@stepRetry` per scenario, definition `retry`)
- [ ] Retry levels: scenario (`@retry` on scenarios — note: on a Scenario line, distinct from step tags), group (`groups.x.retry`), run (`--rerun-failed`)
- [ ] Policies: attempts, fixed/exponential delay, `retryOn` (error class / message / tag), `RetryAnalyzer` interface
- [ ] `attempt` hook level (BeforeAttempt/AfterAttempt)
- [ ] Flaky status (pass after fail), quarantine tag
- [ ] Rerun-failed from an NDJSON file + report merge
- [ ] Soft assertions helper
- [ ] Group/scenario timeouts

## Phase 5: Reporting + DX

- [x] HTML report v1 (single file): summary, groups, filters, steps, logs with images, attachments, errors (`html` reporter)
- [ ] HTML report v2: execution graph, timeline per worker, attempts, history
- [ ] Living documentation view (folder tree = requirements; README.md per folder)
- [ ] History store + flakiness score
- [ ] Cucumber Messages adapter (ADR-007)
- [ ] Interactive debug mode (pause on failure, inspect context)
- [ ] VS Code extension + language server (step completion, go to definition)
- [ ] Watch mode, CI sharding by duration

## Parked: code-linked Markdown specs (owner's idea, later phase)

Free-form Markdown documents whose references (symbol links, file:line links, inline calls) bind directly to step code
in TS/Java; the annotated document is the report. Design note: [design/code-linked-markdown.md](design/code-linked-markdown.md).

- [ ] Settle binding syntax and file selection (open questions in the design note)
- [ ] Registry: index step definitions by symbol (class.method / function) in addition to pattern
- [ ] `SpecParser` for Markdown with bindings
- [ ] `bddx validate` + `bddx bind --fix` (rewrite line links to symbols)
- [ ] Markdown report renderer with inline statuses

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
