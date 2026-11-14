# Implementation guide

How bddx works today, module by module. Keep this in sync with the code; it is the first thing a new
contributor (human or AI) reads after PROGRESS.md.

Last updated: 2026-11-15 (Phase 0 + most of Phase 1).

## 1. Big picture

```
 .feature / .feature.md ──► core.parseSpec ──► ScenarioInstance[] ──► core.selectScenarios
                                                                          │
 steps/*.ts ──(import)──► runtime global API ──► SupportRegistry          │
                                                        │                 ▼
                                                        └──────► runtime.Executor ──► EventBus ──► reporters
                                                                                          (console, ndjson, junit)
```

- **Everything becomes `ScenarioInstance`s first.** One instance = one executable test (an outline row is
  its own instance). Later phases will expand `@data:` tags the same way.
- **Everything observable is an event.** Reporters never look at runtime internals.
- **The CLI is a thin shell** around `runBddx()` (packages/cli/src/run.ts), which is also the programmatic API.

Phase 3 inserts a **Planner** between selection and execution (a graph of groups, dependencies, locks) and
a **Scheduler** that hands ready instances to worker processes. `Executor.runScenario()` is the unit
those workers will call, so keep it free of global state.

## 2. Packages

### 2.1 `@bddx/core` (no internal deps)

| File | Responsibility |
| --- | --- |
| `model.ts` | The internal model: `ScenarioInstance`, `StepInstance`, `Tag`, `FeatureInfo`, `RuleRef`, `ExampleRef`, `Status`, `worstStatus()`, `toErrorInfo()` |
| `gherkin.ts` | `parseSpec(source, uri, {language, format})` using `@cucumber/gherkin`. Never throws on syntax errors; returns `errors[]` with lines |
| `tags.ts` | `parseTag()` (key/value split), `tagsToMeta()`, `compileTagExpression()` (wraps `@cucumber/tag-expressions`) |
| `selection.ts` | `selectScenarios(all, {tags, name, lines, ids})`, `parsePathWithLines('a.feature:12')` |
| `events.ts` | Event schema v1 (`BddxEvent` union), `EventBus`, `emptySummary()` |
| `ids.ts` | `slugify()`, `createIdGenerator()` |

**Parsing pipeline** (`gherkin.ts`):
1. `Parser` + `AstBuilder` + token matcher (classic, or Markdown-with-Gherkin for `.md`) → `GherkinDocument`.
2. `buildIndex()` walks the AST and records, per AST node id: step line/keyword/fromBackground, scenario + its
   rule, example rows (1-based index across all Examples blocks, row values), tag lines.
3. `compile()` (Cucumber's pickle compiler) expands backgrounds, outlines and tag inheritance → `Pickle[]`.
4. `pickleToInstance()` maps each pickle back through the index → `ScenarioInstance`.
5. `assignStableIds()`.

**Stable scenario ids** (used for dependencies, reruns, reports):
- `@id:<value>` tag wins → `<value>`; outline rows → `<value>[<row>]`.
- Otherwise `<uri>::<slug(name)>` (+ `[<row>]`).
- Collisions within a file get `@<line>` appended.
- URIs are POSIX paths relative to the config folder (rootDir).

**Tags**: `@key:value` and `@key=value` split at the first `:` or `=`. `meta` maps key → value (`'true'` for
bare tags). Effective tags = feature + rule + scenario + examples, de-duplicated by name.

### 2.2 `@bddx/runtime` (depends on core)

| File | Responsibility |
| --- | --- |
| `registry.ts` | `SupportRegistry`: steps, hooks, parameter types, matching, snippets. `getGlobalRegistry()` (stored on `globalThis[Symbol.for('bddx.registry.v1')]`), `resetGlobalRegistry()`, `callerLocation()` |
| `api.ts` | Global user API: `Given/When/Then/Step`, `BeforeAll/AfterAll`, `BeforeFeature/AfterFeature`, `BeforeRule/AfterRule`, `Before/After` (= `BeforeScenario/AfterScenario`), `BeforeStep/AfterStep`, `defineParameterType`, `setDefaultTimeout` |
| `executor.ts` | `Executor` / `execute()`: the serial run loop, hooks, contexts, events, summary |
| `context.ts` | `Store` (typed key/value) and `Scope` (store + LIFO `defer()` cleanups) |
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

**Hook levels implemented**: run, feature, rule, scenario, step. (Planned: worker, group in phase 3; attempt in phase 4.)
- Tag filters: feature hooks → feature tags; rule hooks → rule tags; scenario/step hooks → scenario tags.
- Order: before-hooks by `order` asc then registration; after-hooks exactly reversed.
- `alwaysRun` (before-hooks): run even if an earlier before-hook at the same level failed.

**Failure semantics** (also in the header of executor.ts; change both together):

| Event | Effect |
| --- | --- |
| BeforeAll fails | every scenario skipped with reason; AfterAll still runs; run fails |
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
| `junit` | One testsuite per feature. failed/undefined/ambiguous → `<failure>`, skipped/pending → `<skipped>`. Option `outputFile`, `suiteName` |

`createReporter(spec)` accepts `'name'`, `'name:outputFile'`, `['name', options]` or a `Reporter` object.

### 2.4 `@bddx/cli` (depends on all)

| File | Responsibility |
| --- | --- |
| `config.ts` | `BddxConfig`, `defineConfig`, `loadConfig()` (ts/mts/js/mjs/json), profiles, `mergeOptions()` (tags ANDed, params merged) |
| `run.ts` | `runBddx()` pipeline; `registerTypeScriptLoader()` (tsx `register()`); spec & support-file discovery |
| `main.ts` | Argument parsing (`node:util` `parseArgs`), `run` and `list` commands, help, exit codes |
| `bin.ts` | `#!/usr/bin/env node` entry |

**`runBddx()` pipeline**: register tsx → load config (+profile) → merge CLI overrides → discover specs
(paths/globs/`file:line`) → parse → select → import support files (they register on the global registry) →
create reporters (output paths resolved against the config folder) → `Executor.execute()` → flush bus →
close reporters → exit code.

Path rules: config globs are relative to the config file's folder (rootDir). CLI positional paths are relative to
the shell's cwd and converted to rootDir-relative URIs.

## 3. Event stream (schema v1)

Order for a normal run:

```
runStarted → specParsed* → planReady → (featureStarted → (hookStarted/hookFinished)* →
  (scenarioStarted → hook* → (stepStarted → hook* → stepFinished)* → hook* → scenarioFinished)* →
  featureFinished)* → runFinished
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
