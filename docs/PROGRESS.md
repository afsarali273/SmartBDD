# Progress log

The single source of truth for "where are we" and the session history. Update it at the end of every work session
(see CLAUDE.md). For a feature-by-feature summary of what is done and what remains, see [STATUS.md](STATUS.md).

## Current state (2026-11-15, session 9)

- **Phases 0–1:** done. **Phase 2:** data core done (composite steps + Phase 2 gate remain).
- **Phase 3:** done (incl. worker processes `--pool process`, `workerStarted` event) except `@requires`, `waitedForMs`.
- **Phase 5 (reporting):** HTML v2 (timeline per worker, dependency graph, history view), run history + flakiness
  score (`history: true`, `bddx history`). DX tools of Phase 5 remain.
- **Phase 4:** done: scenario/group retry, backoff, worker-crash retry, flaky, quarantine, rerun/merge, soft assertions,
  scenario/group/run time budgets, cancellation and graceful Ctrl+C. Plus step repeat/retry.
- **DX:** `bddx validate` statically checks specs, config, plans, ids, step coverage, unused glue, hooks and governed tags.
- **Real-project gate:** `examples/playwright-showcase` passes 119 Playwright UI/API scenarios (504 steps) across 11
  feature files through bddx using four process workers. One command mixes serial and parallel target groups. It is
  optional/live and therefore kept outside root `npm run verify`.
- **Health:** `npm run verify` green (164 tests + examples: basic, orchestration (inline + process), resilience).
- **Working copy:** `/Users/afsarali/Repository/AI_Projects/BDD_Framework`, remote `git@github.com:afsarali273/SmartBDD.git`
  (SSH; the owner pushes from their Mac).
- **Framing (owner):** an automation framework with BDD-style specs, not BDD-purist. Practical features first.

## Next up

1. **Phase 5 DX:** debug mode (`--debug`: inline, 1 worker, no timeouts, pause on failure; `--inspect`), watch mode,
   CI sharding by duration (`--shard i/n`, balanced with history averages, dependency components kept together),
   Cucumber Messages adapter, VS Code extension.
2. **Phase 6:** plugin API; extract the Playwright showcase lifecycle into a reusable integration with automatic
   failure screenshots/traces; HTTP step library, Allure, AI step catalogue + MCP.
3. Leftovers: text composite steps + Phase 2 gate; `@requires:<file>`; event `waitedForMs`; living documentation view.

Parked by the owner for a later phase: **code-linked Markdown specs** (see `docs/design/code-linked-markdown.md`).
Do not start it without the owner.

## Known gaps / caveats

- `.md` specs use Cucumber's Markdown-with-Gherkin (MDG) syntax (`# Feature:`, `## Scenario:`, `* Given`), not Gauge's
  format. Gauge-style Markdown overlaps with the parked code-linked Markdown design.
- Process pool: feature/rule/group hooks run once per process that runs a member; `ctx.feature`/`ctx.groups` stores
  and module-level variables are per process. Cross-process state: `ctx.export`/`ctx.from` or an external system.
- A worker crash mid-scenario loses that process's After* hooks (the scenario fails; the lane respawns).
- Inline JavaScript promises are cooperative: framework waits abort promptly, but user operations should consume
  `ctx.signal`; process-pool cancellation terminates the lane.
- Console reporter prints logs (by `--log-level`) but not attachments (those are in HTML/NDJSON).
- Run-level hook failures are summarised under "Hook failures:" in console output, not per scenario.
- `bddx list` does not load support code, so it cannot flag undefined steps (use `--dry-run`).
- No `attempt` hook level: by design (scenario hooks run per attempt; step hooks have `eachAttempt`).

## Session log

### 2026-11-15: Session 1 (Phase 0 + Phase 1 core)

Built and verified in the assistant's cloud workspace (also verified from a clean copy: `npm install && npm run verify`).
Delivered to the user as `bddx-session1.zip` (source only: no `node_modules`, `dist`, `reports`) to extract into
their `BDD_Framework` folder, because the session could not write to their computer directly.

- Scaffolding: npm workspaces, `tsconfig.base.json` + per-package project references, vitest with source aliases,
  `tsconfig.test.json` for type-checking tests.
- core: model, Gherkin compile with AST index, stable ids, tags, selection, event schema v1, EventBus.
- runtime: SupportRegistry (lazy expression compile, scoped steps, ambiguity, snippets), global API,
  Executor (run/feature/rule/scenario/step hooks, failure semantics table, dry run, fail-fast, strict),
  Store/Scope with defer, DataTable/DocString, timeouts.
- reporters: console (pretty/progress), ndjson, junit; `createReporter` spec parsing.
- cli: config loading through tsx, profiles, discovery with `file:line`, `run` and `list`, exit codes.
- conformance: README with step vocabulary, 5 features + expected JSON, TS runner.
- examples/basic: basket feature with background, outline (2 Examples blocks), rule, custom parameter type, hooks.
- Docs: README, CLAUDE.md, IMPLEMENTATION.md, DECISIONS.md (ADR-001…009), ROADMAP.md, this file.

### 2026-11-15: Session 1b (moved into the user's folder)

- User extracted the zip into `BDD_Framework`. Restored `.gitignore` (lost in extraction), ran `npm install`
  and `npm run verify` on the user's Mac: 47 tests pass, example passes.
- From now on all work happens directly in this folder (see CLAUDE.md "Where to work").

### 2026-11-15: Session 2 (Phase 1 finished, Phase 2 data core)

Worked directly in the user's folder via device shell.
- Git repo created; first commit `aad9aef`; remote switched to SSH; user pushed.
- runtime: `decorators.ts` (class steps + DI), `api.ts` functions double as decorators (ADR-010). Found and fixed a
  hang: exporting `then` made the package thenable. `vitest.config.ts` gained a TC39-decorator pre-compile plugin.
- reporters: `cucumber-json` (+ `json` alias); events: additive `keyword`, `description`, `feature{…}`,
  `example.source/sourceRow` on `PlannedScenario`.
- cli: `bddx snippets`; `dataDir` option; parse via `parseSpecAsync` with a file data loader (also in `list`).
- core: `data/` (CSV parser, loader, providers), `parseSpecAsync`, AST injection (ADR-011), template-name ids (ADR-013).
- deps: `yaml`, `exceljs` in core; root override uuid ^11.1.1 (ADR-012); lockfile regenerated; `npm audit` clean.
- tests: decorators (5), cucumber-json (1), snippets + data CLI (2), data (9), conformance `data.feature`.
- example: `checkout.feature` (class steps), `pricing-data.feature` (CSV + XLSX + qa profile), `data/make-xlsx.mjs`.

### 2026-11-15: Session 2b (own architecture: ports + adapters, TestNG lifecycle names)

- Commit `d66f13d` (Phase 1 complete + Phase 2 data core).
- Ports & adapters (ADR-014): `core/src/ports.ts` (`SpecParser`, `TagExpressionEngine`), `core/src/spec-parsers.ts`
  (registry by suffix, `parseSpecFile`, `specFileGlobSuffix`), `core/src/adapters/cucumber-gherkin.ts` (moved from
  `gherkin.ts`), `core/src/adapters/cucumber-tag-expressions.ts`, `runtime/src/ports.ts` (`StepExpressionEngine`),
  `runtime/src/adapters/cucumber-expressions.ts`; `SupportRegistry({ engine })`. CLI uses `parseSpecFile`.
- Hooks: `BeforeSuite`/`AfterSuite` aliases; hook decorators on static methods for every level (`staticHookDecorator`).
- Owner's code-linked Markdown idea captured in `docs/design/code-linked-markdown.md` (parked); Gauge-style Markdown
  item removed from Phase 2.

### 2026-11-15: Session 3 (Phase 3: orchestration)

- Commit `74ff469` (ports & adapters).
- core: `plan/` — `types.ts` (vocabulary), `planner.ts` (`buildPlan`, closure, validation, cycles, `explainNode`),
  `render.ts` (text, mermaid, JSON). Selection matched by id, not object identity (bug found by tests).
- runtime: `scheduler.ts`; `executor.ts` top half rewritten around the plan: lazily opened, ref-counted feature/rule/group
  scopes; `BeforeGroup/AfterGroup`; `ctx.groups`, `ctx.export`, `ctx.from`; workerId = slot `w1..wN`.
- events: `groupStarted/Finished`, `planReady.workers/groups`, orchestration fields on `PlannedScenario`; HookLevel `group`.
- cli: `prepareRun()` shared by run/plan; `bddx plan` (`--plan-format`, `--explain`); `-w/--workers`, `--no-deps`; config
  `workers`, `groups`; all configured specs parsed so cross-file deps resolve.
- tests: planner (5), orchestration (12, timing-based; ran 3× stable), CLI plan/deps/orchestration (3), conformance
  `dependencies.feature` (expected.json gained `config`).
- example: `examples/orchestration` (4 groups, exports, group hooks, exclusive report), npm scripts
  `example:orchestration`, `plan:orchestration`; `verify` runs both examples.

### 2026-11-15: Session 3b (config overrides, defaultMode, logging)

- Owner asked: run parallel + sequential in one command (already true via groups), config from CLI, proper log levels.
- cli: `-s/--set path=value` (`applySetOverrides`, `OPTION_KEYS`), `--log-level`, config `defaultMode`, `logLevel`;
  `[bddx:debug]` CLI diagnostics on stderr; console reporters receive the log level (`withLogLevel`).
- core: `LogLevel`, `LOG_LEVELS`, `logLevelEnabled`; `log` event gains `level`, `source`, `data`; planner `defaultMode`
  and implicit `default` group (`PlanGroup.implicit`).
- runtime: `logger.ts` (`createLogger`, global `log`, `withLogger` via AsyncLocalStorage); steps/hooks run inside it;
  executor framework debug logs; implicit groups excluded from hooks/stores/events.
- reporters: console buffers scenario logs under the result line, `logLevel` threshold (default warn), data inline.
- example: orchestration steps log at info/debug/warn incl. a helper using global `log`.
- tests: logging (3), console levels (3), defaultMode (3 planner + 1 scheduler), CLI `--set`/`--log-level` (2) +
  `applySetOverrides` unit (1); two older tests now ignore framework logs. 102 total.

### 2026-11-15: Session 3c (logs in reports, images, HTML report)

- Owner: logs must be in reports and console, with screenshots/images.
- core: log event `attachment`. runtime: `ctx.log.image`, bytes-as-data → image, `sniffMediaType`, global `log.image`.
- reporters: `logs.ts` (`LogIndex` with framework filter, `formatLogLine`), new `html.ts` reporter (`html`), JUnit
  `<system-out>/<system-err>` (CDATA-safe), Cucumber JSON step `output` + log-image embeddings + `before` hook output,
  console default level info + image marker.
- examples: both configs write `reports/report.html`; orchestration logs generated PNG "screenshots"
  (`steps/fake-screenshot.ts`, no browser needed).
- Verified the HTML visually (headless Chrome screenshots: images inline, level filter, framework toggle).
- tests: +5 (107).

### 2026-11-15: Session 3d (step-level repeat/retry)

- Owner: framing = automation framework with BDD-style specs (practical over BDD-purist); calling scenarios parked.
- core: `step-tags.ts` (`extractStepTags`, `scenarioStepDefaults`, `parseDuration`), `StepInstance.tags/run`, parser
  errors for bad tags; events `stepAttemptFinished`, `stepFinished.mode/attempts`, `log.attempt`.
- runtime: attempt loop in `runStep` (retry with delay/backoff, repeat with `{{i}}`/`{{n}}` and `runRepeat`
  concurrency), `attemptContext`, `eachAttempt` hooks, definition `retry` and `concurrent:false` guard,
  `ctx.step.attempt/of/mode`.
- reporters: `attemptsNote`; console/HTML/JUnit show attempts; HTML per-attempt list.
- example: `examples/basic/features/bulk-and-polling.feature` (100 users ×10 concurrency, polling with retry).
- conformance: `step-repeat-retry.feature` + 2 vocabulary steps. Tests: +14 (121).

### 2026-11-15: Session 4 (Phase 4: resilience)

- core: events `willRetry/flaky/quarantined` on scenarioFinished, `groupRetrying`, group start/finish `attempt`, summary
  `flaky/quarantined/retried`; planner `PlanNode.retry/quarantined` (`@retry`, `@noRetry`, `@quarantine`, group
  `scenarioRetry`), `PlanGroup.retry/retryMembers`; `events-merge.ts` (`parseNdjson`, `finalResults`, `idsToRerun`,
  `mergeEventStreams`).
- runtime: `runNode` retry loop, `shouldRetry` (attempts, `retry.on`, analyzer), `settleGroup` (group retry: re-open
  scopes, requeue), summary from final attempts, soft assertions (`ctx.soft`), scenario time budget; scheduler retry-group
  settling; `setRetryAnalyzer`, `RetryOptions`.
- cli: config `retry`, `scenarioTimeout`; `-r/--retry`, `--fail-on-flaky`, `--rerun-failed <file>`; `bddx report`.
- reporters: console retry/flaky/quarantine display; JUnit `<flakyFailure>` + quarantined → skipped; HTML badges,
  earlier attempts, group retries, trimmed stack traces.
- examples/resilience (+ `npm run example:resilience`, in `verify`); fixture `rerun-project`; conformance
  `scenario-retry.feature` (+1 vocabulary step). Tests now 137.

### 2026-11-15: Session 5 (worker processes)

- runtime: `pool.ts` (protocol, `ProcessPool`, `serveWorker`, `planFingerprint`, `WorkerCrashedError`/`WorkerInitError`);
  Executor coordinator mode (`pool` option: `runRemote`, `releaseRemote`, run-store seed) and worker mode
  (`remoteWorker`: `initWorker`, `runAssigned`, `closeScopes`, `shutdownWorker`); hook level `worker`
  (`BeforeWorker`/`AfterWorker`, inline = once); groupStarted/Finished carry `attempt` on group retries.
- cli: config `pool`, `--pool inline|process`, `worker.ts` entry, `prepareWorker`, SIGINT kills workers.
- examples/orchestration: fake backend moved from memory to a temp file (BeforeAll → run store) so it runs in both
  pools; `npm run example:orchestration:process` in verify.
- tests: `runtime/test/pool.test.ts` (fake in-process pool: protocol, hooks, exports, retries, crash, BeforeWorker
  failure, inline worker hooks); CLI e2e `fixtures/pool-project` (real processes, crash, init failure, parity). 148 tests.

### 2026-11-15: Session 5b (documentation pass)

- New `docs/STATUS.md`: one-page summary of everything done (feature inventory, hook lifecycle table, tag/config/CLI
  reference) and everything remaining (next phases, leftovers, known limitations, parked items, idea sources).
- Brought README, CLAUDE.md, ROADMAP, IMPLEMENTATION (package tables: plan/, step-tags, events-merge, scheduler, pool,
  logger, worker.ts) and this file in line with the code; CLI help lists the `html` reporter.

### 2026-11-15: Session 6 (`bddx validate` + resilience completion)

- cli: new `bddx validate` / `validateProject()` with structured errors and warnings for parse/config/plan problems,
  duplicate ids, undefined/ambiguous steps, unused definitions, unmatched hooks and optional tag governance;
  `--fail-on-warnings`. Matching does not run parameter transformers.
- runtime/core: `ctx.signal`, external cancellation, abort-aware hooks/steps/delays, group-attempt budgets, run budget,
  graceful Ctrl+C (exit 130), scenario retry backoff, worker-crash retry on a fresh process; new config
  `groups.x.timeout`, `runTimeout`, `retry.backoff`, `retry.workerCrash` and CLI flags.
- tests: validation fixture, inline and process time budgets, programmatic cancellation, Ctrl+C, retry backoff and
  worker crash recovery. 157 tests pass; ADR-022 records the semantics.

### 2026-11-15: Session 7 (real Playwright UI/API project)

- added standalone `examples/playwright-showcase` TypeScript project using local bddx packages and Playwright 1.65.1;
  bddx remains the runner, while Playwright provides Chromium and its API request context.
- 66 scenarios / 289 steps: 30 UI scenarios against The Internet, 33 API scenarios against JSONPlaceholder, two
  prerequisite health scenarios and one deterministic scenario-retry demonstration.
- exercises process workers, worker/group/feature/scenario/step hooks, browser-per-worker/page-per-scenario lifecycle,
  groups/dependencies/exports, outlines, CSV `@data`, tables, doc strings, custom parameter types, class DI, soft
  assertions, repeat concurrency, retry/flaky reporting, budgets, logging, screenshots/JSON attachments and reports.
- verification: standalone TypeScript compile and `bddx validate --fail-on-warnings` are clean; complete live run passed
  all 66 scenarios (one deliberately flaky pass on attempt 2). Root unit/conformance/example verification remains
  separate so offline CI is deterministic. ADR-023 records target and isolation choices.

### 2026-11-15: Session 8 (mixed serial/parallel expansion)

- added six feature files and 53 new scenarios: SauceDemo authentication/inventory (20, serial), TodoMVC lifecycle/
  filtering (15, parallel), DummyJSON products/users (15, serial), plus three additional target-health rows.
- expanded the single plan to six named groups: serial `health`, `sauceDemo`, `dummyJson`; parallel `theInternet`,
  `jsonPlaceholder`, `todoMvc`, with group dependencies and worker caps visible in `bddx plan`.
- live verification: `bddx validate` reports 119 scenarios / 504 steps / 87 definitions with zero errors or warnings;
  complete process-pool run passes all 119 scenarios and 504 steps, including the intentional retry/flaky scenario.
- corrected public-target selector timing and documented the expanded matrix in the showcase README, status, roadmap and
  implementation notes.

### 2026-11-15: Session 9 (Phase 5 reporting: HTML v2 + run history)

- Owner chose Phase 5 reporting for this session (overriding the session-8 note). Committed sessions 6–8 work first
  (`0cc28ae`). The local `node_modules` had macOS-only rolldown/esbuild binaries; Linux arm64 binaries were unpacked
  next to them (no package.json/lock change) so the cloud VM can run vitest/tsx.
- core: `history.ts` (`HistoryRecorder`, `loadHistory`, `saveHistory`, `scenarioHistory`, `rankScenarios`); event
  `workerStarted`.
- reporters: `html-views.ts` (timeline per worker lane with retried attempts, worker start-up and group rows;
  dependency graph; history view with pass-rate bars, flakiest table, trend dots, flaky score); html.ts wiring + anchors.
- runtime: ProcessPool emits `workerStarted`. cli: config `history`, record after each run (not dry runs), previous runs
  passed to html reporters, `bddx history [--top n]`. `.bddx/` gitignored.
- tests: core history (score, recorder, keep/load), reporters v2 views, CLI e2e (history + workerStarted). 164 tests.
- Not committed by this session: `examples/playwright-showcase/src/pages/` (created concurrently by another session).
