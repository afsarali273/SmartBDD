# Implementation guide

How bddx works today, module by module. Keep this in sync with the code; it is the first thing a new
contributor (human or AI) reads after PROGRESS.md.

Last updated: 2026-11-15 (Phases 0–1 done, Phase 2 data core done, Phase 3 planner + in-process scheduler done).

## 1. Big picture

```
 specs ──► SpecParser ──► ScenarioInstance[] ──► selectScenarios ──► buildPlan (groups, deps, locks)
                                                                          │
 steps/*.ts ──(import)──► global API ──► SupportRegistry                  ▼
                                               └────────► Executor ◄── schedule(plan) ──► EventBus ──► reporters
```

- **Everything becomes `ScenarioInstance`s first.** One instance = one executable test (an outline row is
  its own instance). Later phases will expand `@data:` tags the same way.
- **Everything observable is an event.** Reporters never look at runtime internals.
- **The CLI is a thin shell** around `runBddx()` (packages/cli/src/run.ts), which is also the programmatic API.

The **Planner** (`core/src/plan`) turns the selection into a validated graph; the **Scheduler**
(`runtime/src/scheduler.ts`) decides what runs when; the **Executor** runs nodes and owns scopes/hooks/events.
`Executor.runScenario()` is the unit future worker processes will call, so keep it free of global state.

## 2. Own core, swappable third-party parts (ports & adapters)

bddx's runner, hooks, context, DI, data, ids, events, reports and CLI are its own code. Third-party libraries are used
only for three narrow jobs, each behind an interface bddx owns:

| Port (interface) | Defined in | Default adapter | Library |
| --- | --- | --- | --- |
| `SpecParser` (file → `ScenarioInstance[]`) | `core/src/ports.ts` | `core/src/adapters/cucumber-gherkin.ts` | `@cucumber/gherkin`, `@cucumber/messages` |
| `TagExpressionEngine` | `core/src/ports.ts` | `core/src/adapters/cucumber-tag-expressions.ts` | `@cucumber/tag-expressions` |
| `StepExpressionEngine` (pattern → matcher, parameter types, snippets) | `runtime/src/ports.ts` | `runtime/src/adapters/cucumber-expressions.ts` | `@cucumber/cucumber-expressions` |

Rule: only files under `adapters/` may import these libraries (`grep -rn "@cucumber/" packages/*/src | grep -v adapters/`
must print nothing). New spec formats register with `registerSpecParser()` and are chosen by the longest matching file
suffix (`specParserFor`); the CLI's folder globs come from `specFileGlobSuffix()`. Swap tag engine with
`setTagExpressionEngine()`, step engine with `new SupportRegistry({ engine })`.

## 2b. Packages

### 2.1 `@bddx/core` (no internal deps)

| File | Responsibility |
| --- | --- |
| `model.ts` | The internal model: `ScenarioInstance`, `StepInstance`, `Tag`, `FeatureInfo`, `RuleRef`, `ExampleRef`, `Status`, `worstStatus()`, `toErrorInfo()` |
| `ports.ts`, `spec-parsers.ts` | Interfaces + spec parser registry (`parseSpecFile`) |
| `adapters/cucumber-gherkin.ts` | `parseSpec(source, uri, {language, format})` (sync) and `parseSpecAsync(…, {dataLoader})` (with `@data` expansion), using `@cucumber/gherkin`. Never throw on syntax/data errors; return `errors[]` with lines |
| `data/loader.ts` | `@data` support: `parseDataRef`, `createFileDataLoader` (path resolution, providers by extension, `applyQuery` filters), built-in CSV/TSV/JSON/YAML/XLSX providers |
| `data/csv.ts` | RFC 4180 CSV parser |
| `tags.ts` | `parseTag()` (key/value split), `tagsToMeta()`, `compileTagExpression()` (wraps `@cucumber/tag-expressions`) |
| `selection.ts` | `selectScenarios(all, {tags, name, lines, ids})`, `parsePathWithLines('a.feature:12')` |
| `events.ts` | Event schema v1 (`BddxEvent` union), `EventBus`, `emptySummary()` |
| `ids.ts` | `slugify()`, `createIdGenerator()` |

**Parsing pipeline** (`adapters/cucumber-gherkin.ts`):
1. `Parser` + `AstBuilder` + token matcher (classic, or Markdown-with-Gherkin for `.md`) → `GherkinDocument`.
2. `buildIndex()` walks the AST and records, per AST node id: step line/keyword/fromBackground, scenario + its
   rule, example rows (1-based index across all Examples blocks, row values), tag lines.
3. `compile()` (Cucumber's pickle compiler) expands backgrounds, outlines and tag inheritance → `Pickle[]`.
4. `pickleToInstance()` maps each pickle back through the index → `ScenarioInstance`.
5. `assignStableIds()`.

**Stable scenario ids** (used for dependencies, reruns, reports):
- `@id:<value>` tag wins → `<value>`; outline rows → `<value>[<row>]`; data rows → `<value>[<source>#<dataRow>]`.
- Otherwise `<uri>::<slug(template name)>` (+ the same suffixes). The TEMPLATE name is the name before
  `<placeholder>` substitution, so changing data values never changes ids. `<dataRow>` is the row's number in the
  source file (header excluded) BEFORE filtering, so filters never renumber.
- Collisions within a file get `@<line>` appended.
- URIs are POSIX paths relative to the config folder (rootDir).

**Tags**: `@key:value` and `@key=value` split at the first `:` or `=`. `meta` maps key → value (`'true'` for
bare tags). Effective tags = feature + rule + scenario + examples, de-duplicated by name.

**External data (`@data`)** — `parseSpecAsync` step 1b, between parsing and `compile()`:
1. Find `@data:` tags on Scenarios (feature- and rule-level children) and on Examples blocks.
2. Load each via the `DataLoader` (`createFileDataLoader`): resolve `<dataDir>/<profile>/<file>` → `<dataDir>/<file>`
   → next to the spec; pick a provider by extension; apply `?col=value` and `?rows=1-3,7` filters.
3. Inject into the AST: a Scenario tag appends a synthetic Examples block (header = all columns, renamed by
   `@dataField:<placeholder>=<column>`); an Examples tag replaces that block's body and keeps its header (the header
   decides which columns are used). Injected rows are remembered (`RowSources`) so `ExampleRef.source/sourceRow` and
   ids can name them.
4. Cucumber's `compile()` then expands them exactly like normal outline rows (it expands any scenario with Examples).
5. Any data problem → a `ParseErrorInfo` on the tag line and the scenario is removed from the document.
   The CLI exits 2 when there are parse errors (other scenarios still run).

### 2.2 `@bddx/runtime` (depends on core)

| File | Responsibility |
| --- | --- |
| `ports.ts`, `adapters/cucumber-expressions.ts` | `StepExpressionEngine` interface + Cucumber Expressions adapter |
| `registry.ts` | `SupportRegistry`: steps, hooks, parameter types (delegated to the engine), matching, snippets. `getGlobalRegistry()` (stored on `globalThis[Symbol.for('bddx.registry.v1')]`), `resetGlobalRegistry()`, `callerLocation()` |
| `api.ts` | Global user API: `Given/When/Then/Step`, `BeforeAll/AfterAll`, `BeforeFeature/AfterFeature`, `BeforeRule/AfterRule`, `Before/After` (= `BeforeScenario/AfterScenario`), `BeforeStep/AfterStep`, `defineParameterType`, `setDefaultTimeout` |
| `executor.ts` | `Executor` / `execute()`: the serial run loop, hooks, contexts, events, summary |
| `context.ts` | `Store` (typed key/value) and `Scope` (store + LIFO `defer()` cleanups) |
| `decorators.ts` | Class-based steps: `@Steps()` class decorator, pending-method collection, per-scenario DI container (`resolve`, `CONTEXT` token, `static inject`, `dispose()`) |
| `datatable.ts` | `DataTable` (`raw/rows/hashes/rowsHash/asObjects/transpose`), `DocString` |
| `signals.ts` | `PendingSignal`, `SkipSignal`, `TimeoutError`, `withTimeout()` |
| `types.ts` | `StepContext`, `FeatureContext`, `RunContext`, `ScenarioInfo`, hook/step option types |

**Step matching** (`SupportRegistry.match`):
- String patterns are Cucumber Expressions, RegExps are regular expressions.
- Expressions compile lazily (`finalize()`), so `defineParameterType` can come after the steps that use it.
- A definition with `tags` (scope) only matches scenarios whose tags satisfy it. If any scoped definition
  matches, unscoped ones are ignored ("more specific wins"). More than one winner → `ambiguous`.
- Keyword (Given/When/Then) does not affect matching, like Cucumber.

**Step function signature**: `(ctx: StepContext, ...expressionArgs, dataTable | docString?)`.
The context is always first (no `this`), so arrow functions work and the shape ports to Java.

**StepContext**:
- `ctx.state`: scenario store (fresh per scenario and per attempt)
- `ctx.feature`: feature store; `ctx.run`: run store
- `ctx.params`: config `params` + CLI `-D`
- `ctx.scenario`: id, name, tags, meta, example values, attempt
- `ctx.step`: current step (inside steps and step hooks)
- `ctx.log()`, `ctx.attach(body, mediaType, name)`: emit `log` / `attachment` events tagged with scenario/step
- `ctx.defer(fn)`: cleanup in the current scope (scenario for steps; feature for feature hooks; run for run hooks)
- `ctx.pending(reason)`, `ctx.skip(reason)`

**Class-based steps** (`decorators.ts`): `Given/When/Then/Before/After/BeforeStep/AfterStep` called WITHOUT a
function return a TC39 method decorator. Method decorators run before the class decorator, so they push onto a
module-level pending list that `@Steps()` drains and registers (`@Steps()` is required). Registered functions call
`resolve(ctx, Class)`, which creates one instance per class per scenario (stored in `ctx.state`), resolving
`static inject = [Dep, CONTEXT]` recursively with cycle detection. Instances with `dispose()` are disposed LIFO when
the scenario scope closes. Run/feature/rule hooks cannot decorate methods (no per-scenario instance exists).
**Trap:** never export a value named `then` from a package: its module namespace becomes thenable and
`await import()` hangs (this happened with an early lowercase `then` decorator).

**Hook levels implemented**: run (= suite: `BeforeAll`/`BeforeSuite`), feature, rule, scenario, step.
Hooks can be functions, instance methods of `@Steps()` classes (scenario/step levels), or **static methods at any level**
(`@BeforeSuite() static start(ctx)`), registered on class definition without `@Steps()`. (Planned: worker, group in phase 3; attempt in phase 4.)
- Tag filters: feature hooks → feature tags; rule hooks → rule tags; scenario/step hooks → scenario tags.
- Order: before-hooks by `order` asc then registration; after-hooks exactly reversed.
- `alwaysRun` (before-hooks): run even if an earlier before-hook at the same level failed.

**Failure semantics** (also in the header of executor.ts; change both together):

| Event | Effect |
| --- | --- |
| BeforeAll fails | every scenario skipped with reason; AfterAll still runs; run fails |
| BeforeGroup fails | that group's scenarios skipped with reason; AfterGroup still runs; run fails |
| hard dependency did not pass | scenario skipped `dependency failed: <id> (<status>)` (cascades); soft deps run anyway |
| BeforeFeature fails | that feature's scenarios skipped with reason; AfterFeature still runs; run fails |
| BeforeRule fails | the rule's scenarios skipped with reason; AfterRule still runs; run fails |
| Before (scenario) fails | later before-hooks skipped unless `alwaysRun`; steps skipped; After hooks run; scenario failed |
| Step fails | remaining steps skipped; After hooks run; scenario failed |
| BeforeStep fails | step failed, body not run; AfterStep still runs |
| After / AfterStep fails | scenario / step becomes failed |
| `defer()` cleanup throws | owning scenario or feature becomes failed (reported as a cleanup hook) |
| `ctx.pending()` | step pending, rest skipped, scenario pending |
| `ctx.skip(reason)` | step skipped, rest skipped, scenario skipped with reason |
| undefined / ambiguous step | that status; rest skipped |
| step/hook timeout (default 30 s) | failed with `TimeoutError` |

Scenario status = worst of its step and hook statuses (`failed > ambiguous > undefined > pending > skipped > passed`).
Run success (strict, default): no scenario failed/pending/undefined/ambiguous and no run/feature/rule hook failed.
`strict: false` lets pending/undefined/ambiguous pass.

**Dry run**: no hooks run, no step bodies run; matched steps are `skipped`, unmatched are `undefined` with snippets.

### 2.3 `@bddx/reporters` (depends on core)

| Reporter | Notes |
| --- | --- |
| `console` (`pretty`, `progress`) | Scenario lines, failing steps, failure list with first user stack frame, undefined-step snippets, summary. Options: `style`, `verbose`, `colors`, `write` |
| `ndjson` | Every event as one JSON line. Option `outputFile` (default `reports/bddx.ndjson`) |
| `html` | Single self-contained page: summary, groups, filters (status, log level, framework logs, search), scenarios with steps, errors, snippets, skip reasons, logs + images, attachments, run-level logs and hook failures. Options `outputFile` (default `reports/report.html`), `title`, `logLevel` |
| `cucumber-json` (alias `json`) | Legacy Cucumber JSON (features → elements → steps, ns durations, embeddings) for existing dashboards. Option `outputFile` (default `reports/cucumber.json`) |
| `junit` | One testsuite per feature. failed/undefined/ambiguous → `<failure>`, skipped/pending → `<skipped>`. Option `outputFile`, `suiteName` |

`createReporter(spec)` accepts `'name'`, `'name:outputFile'`, `['name', options]` or a `Reporter` object.

### 2.4 `@bddx/cli` (depends on all)

| File | Responsibility |
| --- | --- |
| `config.ts` | `BddxConfig`, `defineConfig`, `loadConfig()` (ts/mts/js/mjs/json), profiles, `mergeOptions()` (tags ANDed, params merged) |
| `run.ts` | `runBddx()` pipeline; `registerTypeScriptLoader()` (tsx `register()`); spec & support-file discovery |
| `main.ts` | Argument parsing (`node:util` `parseArgs`), `run`, `list` and `snippets` commands, help, exit codes |
| `bin.ts` | `#!/usr/bin/env node` entry |

**`runBddx()` pipeline**: register tsx → load config (+profile) → merge CLI overrides → discover specs
(paths/globs/`file:line`) → parse → select → import support files (they register on the global registry) →
create reporters (output paths resolved against the config folder; specs parsed with `parseSpecAsync` and a
file data loader built from `dataDir` + `--profile`) → `Executor.execute()` → flush bus →
close reporters → exit code.

Path rules: config globs are relative to the config file's folder (rootDir). CLI positional paths are relative to
the shell's cwd and converted to rootDir-relative URIs.

## 2c. Orchestration (Phase 3)

**Vocabulary.** Tags: `@group:<name>`, `@id:<id>`, `@dependsOn:<id>[:soft]`, `@dependsOn:group:<name>[:soft]`,
`@lock:<name>`, `@priority:<n>` (lower first), `@exclusive`. Config `groups.<name>`: `mode` (parallel | serial |
exclusive), `workers`, `dependsOn`, `onDependencyFailure` ('skip' | 'run'), `priority`, `locks`, `match` (tag
expression). Config/CLI `workers` (default 1). Full reference: `core/src/plan/types.ts` header.

**Planner** (`buildPlan(all, selected, options)`, pure):
1. Facts per scenario from tags (+ `match` groups). Dependency targets: exact id, or an id "family" (`rows` matches
   `rows[1]`, `rows[2]`, data rows `x[file#n]`).
2. Closure: hard deps of selected scenarios (and members of groups their groups depend on, unless soft) are pulled in,
   with `pulledInBy`. CLI parses ALL configured specs so targets in other files resolve.
3. Nodes in base order (features together, file order). Priority: `@priority` > min(group priority) > 0. Locks: own +
   group locks. Exclusive: `@exclusive` or group mode exclusive.
4. Deps resolved to node ids (hard wins over soft for duplicates); group `dependsOn` adds deps on every member.
5. Validation errors (never throws): unknown target/group, bad priority, bad workers, cycles (`a -> c -> b -> a`).
   The CLI exits 2 on plan errors; `Executor` throws for an invalid plan passed programmatically.

**Scheduler** (`schedule(plan, callbacks)`): loop { skip ready nodes whose HARD dep did not pass (cascades) or when a
stop reason exists (fail-fast, BeforeAll failure) → start ready nodes by (priority, order) while a slot is free and
locks/group caps/exclusivity allow → await any running }. Slots are named `w1..wN` (= `workerId` in events). Dry run
ignores dependency results. Safety net: if nothing runs and nothing can start, the rest is skipped (never hangs).

**Scopes under any order/concurrency**: feature, rule and group scopes OPEN lazily when their first scenario starts
(Before* hooks, memoised promise so concurrent members wait for the same hooks) and CLOSE when their last member
finishes or is skipped (reference counts). Close order when several end together: rule → feature → groups (group is
the outer scope). A scope never opened (all members skipped before starting) runs no hooks and emits no events.

**Exports**: `ctx.export(key, value)` stores a structured clone per scenario; `ctx.from(id).get(key)` returns a clone,
and throws if that scenario has not finished (hint: add `@dependsOn`) or is not in the plan.

**Ungrouped scenarios**: with `defaultMode` (config/`--set`) or a configured `groups.default`, scenarios without a group
join the group `default`. From `defaultMode` alone it is *implicit*: it constrains scheduling (e.g. serial) but has no
hooks, store or group events (`Executor.realGroups`). A configured `groups.default` is a normal group.

## 2c-bis. Step-level repeat / retry

**Syntax** (`core/src/step-tags.ts`): recognised tags at the END of a step's text are stripped before matching and
stored in `StepInstance.run`: `@repeat:N`, `@retry:N`, `@delay:<dur>`, `@backoff:<x>`, `@timeout:<dur>`,
`@concurrency:N` (durations: `500ms`, `2s`, `1m`, plain number = ms). Only these keys are taken; other trailing `@words`
(emails, `@team`) stay in the text. Scenario-level defaults: `@stepRetry:N`, `@stepDelay`, `@stepTimeout` (merged in the
parser; an explicit `@repeat` drops a scenario retry). Invalid values/combinations → parse errors on the step line.

**Precedence** for retry: step tag / scenario tag > step definition option `retry` (`3` or
`{attempts, delay, backoff}`); timeout: `@timeout` > definition `timeoutMs` > default.

**Execution** (`Executor.runStep`): match once → BeforeStep hooks (non-`eachAttempt`) once → attempt loop → AfterStep
once. Each attempt runs `eachAttempt` step hooks around the body, uses its own context view (`attemptContext`:
`ctx.step.attempt/of/mode`, logger tagging `attempt`) and emits `stepAttemptFinished`. `{{i}}`/`{{iteration}}` and
`{{n}}`/`{{total}}` are substituted per attempt in step text (re-matched when it changes), data tables and doc strings.
- `@retry`: re-run only `failed` (incl. timeouts) until pass or attempts exhausted; delay × backoff between attempts.
  Pass after retries = passed (`attempts` > 1 recorded); final failure = last error.
- `@repeat`: N runs, stop starting new ones at the first non-passed; `@concurrency` = in-flight limit (`runRepeat`).
  Step definitions with `{ concurrent: false }` (browser/Selenium-driving steps) reject `@concurrency` with an error.
- `ctx.pending()` / `ctx.skip()` / undefined / ambiguous are never retried. State is shared across attempts.
- `stepFinished` gains `mode`, `attempts`; console prints "(passed after 3 attempts)" / "(repeated 100×)" and
  "(1 step retried)" on the scenario line; HTML lists every attempt (status, text, duration, error) and tags logs `#n`;
  JUnit failure messages add the attempt info.

## 2d. Configuration sources and precedence

Lowest → highest: built-in defaults → `bddx.config.*` → `--profile <p>` (merged; tags ANDed, params/groups merged by
key) → `--set path=value` (repeatable, JSON-typed, unknown top-level keys rejected; `applySetOverrides`) → dedicated CLI
flags (`-t`, `-w`, `-D`, `--log-level`, `--fail-fast`, …). Orchestration facts per scenario come from tags in specs.

## 2e. Logging

- API: `ctx.log(msg)` (= info), `ctx.log.debug|info|warn|error(msg, data?)`, `ctx.log.image(msg, bytes, {level,
  mediaType, name})`; bytes (Uint8Array/Buffer) passed as `data` also become an image on that log line. Media type is
  sniffed (png, jpeg, gif, webp, svg, pdf). Global `log` from `@bddx/runtime` for code outside steps (page objects,
  API clients). `runtime/src/logger.ts`. Playwright: `ctx.log.image('after login', await page.screenshot())`.
- Attribution: steps and hooks run inside `withLogger(ctx.log, …)` (AsyncLocalStorage), so the global `log` resolves to
  the scenario/step/hook running in the current async context, correct under concurrency. Outside: the run-level
  logger (`setFallbackLogger`), else warn/error go to stderr.
- Every call → a `log` event `{level, source:'user', message, data?, scenarioId?, stepId?}`; Error data is normalised to
  `{name, message, stack}`. The framework emits `source:'bddx'` debug diagnostics (plan summary, `start <id> on wN after
  … holding …`, `skip <id>: reason`). The CLI writes its own pre-run diagnostics (config, --set, counts, support code) to
  stderr as `[bddx:debug]` at `--log-level debug`.
- Log events may carry `attachment {mediaType, encoding:'base64', body, name?, bytes}` (the image).
- Display: console reporters show logs at or above `logLevel` (default `info`; `silent` hides all); image logs are
  marked `[🖼 image: name]`. Scenario logs are
  buffered and printed under the scenario's result line (stable with concurrency); run-level logs print immediately.
  NDJSON always contains every log at every level.
- File reports (`reporters/src/logs.ts`: `LogIndex`, `formatLogLine`), each with its own `logLevel` option:
  | Reporter | Where logs go | Default level | Framework logs |
  | --- | --- | --- | --- |
  | `html` | under each step / scenario, images inline, level dropdown + search in the page | debug (page shows info+) | yes, toggle |
  | `junit` | `<system-out>` (debug/info), `<system-err>` (warn/error), prefixed by step text, CDATA-safe | info | no |
  | `cucumber-json` | step `output` lines; log images + attachments as step `embeddings`; hook logs in `before[].output` | info | no |
  | `ndjson` | every event | all | yes |

## 3. Event stream (schema v1)

Order for a normal run:

```
runStarted → specParsed* → planReady → … → runFinished

In between, with workers = 1 and no priorities, the order is as in Phase 1:
  (featureStarted → hook* → (scenarioStarted → hook* → (stepStarted → hook* → stepFinished)* → hook* →
  scenarioFinished)* → featureFinished)*
With workers > 1, events of different scenarios interleave; every scenario/step event carries `scenarioId`, and
`scenarioStarted.workerId` names the slot. `groupStarted`/`groupFinished` wrap each named group's members.
```

`log` and `attachment` can appear anywhere inside a scenario. Skipped-by-hook scenarios emit
`scenarioStarted` + `scenarioFinished` (with `reason`) and no step events.

## 4. Conformance suite

`conformance/features/*.feature` + `*.expected.json`, run by `conformance/ts/conformance.test.ts` with the shared step
vocabulary in `conformance/ts/steps.ts`. See `conformance/README.md`. The Java engine must pass the same files.

## 5. How to add things

- **A new step argument type / parameter type**: `SupportRegistry.defineParameterType`; add a conformance case.
- **A new hook level**: extend `HookLevel` in `core/events.ts`, add API in `runtime/api.ts`, call `runHooks` at the
  right place in `executor.ts`, document failure semantics in both places, add conformance coverage.
- **A new reporter**: implement `Reporter` in `packages/reporters/src`, register it in `builtInReporters`, add a test
  that drives it with a real `Executor` run.
- **A new CLI option**: `main.ts` (parseArgs + help text) → `RunRequest` in `run.ts` → `BddxOptions` in `config.ts`
  if it should also be configurable; add a CLI end-to-end test.
