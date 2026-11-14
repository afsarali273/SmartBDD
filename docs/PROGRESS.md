# Progress log

The single source of truth for "where are we". Update it at the end of every work session (see CLAUDE.md).

## Current state (2026-11-15, session 2)

- **Phase 0:** done (CCK parse gate deferred).
- **Phase 1:** done except the "real project" gate (run the user's own app end to end).
- **Phase 2:** core done: `@data` with CSV/TSV/JSON/YAML/XLSX, filters, `@dataField`, `dataDir` + per-profile data,
  stable data-row ids, data errors as parse errors. Remaining Phase 2 items below.
- **Health:** `npm run verify` green on the user's Mac. 65 tests.
- **Working copy:** `/Users/afsarali/Repository/AI_Projects/BDD_Framework`, git remote `git@github.com:afsarali273/SmartBDD.git`
  (SSH; the user pushes from their Mac).

## Next up

1. **Gauge-style Markdown specs** (Phase 2): second parser in `core/src/markdown.ts`. `# Spec` = feature,
   `## Scenario` = scenario, `* step` lines, Markdown tables as data tables / spec-level data table, `tags:` line.
   Map to the same `ScenarioInstance`; choose by extension `.spec.md` (keep `.feature.md` = Cucumber MDG). ADR first.
2. **Text-defined composite steps** (Gauge concepts / JBehave composites): `*.concept.md` files defining
   `# Login as <user>` followed by `* steps`; register as step definitions that run sub-steps (each sub-step
   reported as nested events → needs additive `parentStepId` on step events).
3. **Call a scenario from a step**: `Given I run scenario "X" from "y.feature"` (runtime step that executes another
   instance's steps inline, sharing the scenario store).
4. **Phase 2 gate**: same feature from inline Examples, CSV and XLSX with identical results (add to conformance).
5. Then **Phase 3** (planner, groups, dependencies, workers): start with `packages/core/src/plan/` and `bddx plan`.

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
