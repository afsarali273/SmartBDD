# Progress log

The single source of truth for "where are we". Update it at the end of every work session (see CLAUDE.md).

## Current state (2026-11-15, session 3)

- **Phases 0–1:** done. **Phase 2:** data core done; text composite steps, call-a-scenario, Phase 2 gate remain.
- **Phase 3:** planner, `bddx plan`/`--explain`, dependency closure, in-process scheduler (workers, priorities, locks,
  serial/parallel/exclusive groups, group caps), group hooks/stores, hard/soft deps, exports, orchestration example. Gate passed.
  Also: `defaultMode`, `--set` overrides, levelled logging with images, HTML report v1, logs in JUnit/Cucumber JSON,
  step-level `@repeat`/`@retry` (+ delay/backoff/timeout/concurrency). Remaining: worker processes, `@requires`, timeline view.
- **Health:** `npm run verify` green on the user's Mac (121 tests + both examples).
- **Working copy:** `/Users/afsarali/Repository/AI_Projects/BDD_Framework`, remote `git@github.com:afsarali273/SmartBDD.git`
  (SSH; the owner pushes from their Mac).

## Next up

1. **Worker processes** (Phase 3): `runtime/src/workers/` — fork N children (`child_process.fork` of a worker entry in
   the CLI package), each loads config + support code once; parent keeps the plan + scheduler and sends `runNode`
   requests `{scenarioId}`; children stream events back over IPC; parent re-emits them. Exports travel with the
   result. Worker hooks (`BeforeWorker/AfterWorker`) + worker store. Feature/group scopes: decide per-worker vs
   global (likely: Before/AfterFeature per worker that runs members — document clearly; group hooks in parent?).
   Write an ADR before coding. Keep `workers` in-process mode as `--pool=threads|inline` default inline.
2. **Phase 4: retries** (scenario / group / rerun-failed), flaky status, quarantine — design is in ROADMAP. Step retry is done.
3. Phase 2 leftovers: text composite steps, Phase 2 gate. (Calling scenarios: parked by the owner.)
4. `@requires:<file.feature>` preconditions.

Parked by the owner for a later phase: **code-linked Markdown specs** (see `docs/design/code-linked-markdown.md`).
Do not start it without the owner.

## Known gaps / caveats

- `.md` specs use Cucumber's Markdown-with-Gherkin (MDG) syntax (`# Feature:`, `## Scenario:`, `* Given`), not Gauge's
  format. Gauge-style Markdown is a Phase 2 item.
- Hook levels `worker`, `group`, `attempt` do not exist yet (phases 3–4).
- Console reporter does not print attachments or logs (they are in NDJSON).
- Run-level hook failures are summarised under "Hook failures:" in console output, not per scenario.
- `bddx list` does not load support code, so it cannot flag undefined steps (use `--dry-run`).
- Working copy: `/Users/afsarali/Repository/AI_Projects/BDD_Framework` (all future work goes here directly).

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
