# Progress log

The single source of truth for "where are we". Update it at the end of every work session (see CLAUDE.md).

## Current state (2026-11-15)

- **Phase 0:** done (CCK parse gate deferred, see ROADMAP).
- **Phase 1:** done except class/decorator steps with DI, Cucumber JSON reporter, `snippets` command, and the
  "real project" gate.
- **Health:** `npm run verify` green. 47 tests: 12 core, 19 runtime, 4 reporters, 7 CLI end-to-end, 5 conformance.
- **Working name:** bddx (ADR-002). **Runner:** own (ADR-001), still open for the user to overturn.

## Next up

Do these in order. Each is small enough for one session.

1. **Decorator steps + DI (Phase 1).** Add `packages/runtime/src/decorators.ts`:
   - `@Steps()` class decorator, `@Given/@When/@Then(pattern, options?)` method decorators, `@BeforeScenario` etc.
   - Use TC39 standard decorators (TS 5 default, no `experimentalDecorators`). Collect metadata with `context.addInitializer`
     or a static map keyed by class.
   - Per-scenario instances: executor creates one instance per class per scenario (lazy, on first use), stored in
     `ctx.state` under a symbol. Constructor injection: classes declare `static inject = [OtherClass]`;
     resolve recursively, detect cycles.
   - Method receives `(...args)` and gets context via `this.ctx` (inject `StepContext` as a token).
   - Conformance: add `conformance/features/class-steps.feature` reusing existing vocabulary? (Vocabulary is
     language-level; keep conformance unchanged, add runtime unit tests instead.)
   - Record design in an ADR.
2. **Cucumber JSON reporter** (`packages/reporters/src/cucumber-json.ts`): needs feature/step keyword data, which
   `planReady` already carries; add `description`/`keyword` fields to `PlannedScenario` if needed (additive).
3. **`bddx snippets`**: dry-run + print unique snippets grouped by file, nothing else.
4. **CCK parse gate**: vendor a handful of Cucumber Compatibility Kit `.feature` files into `conformance/cck/`
   (MIT, keep their licence header) and assert `parseSpec` yields no errors.
5. Start **Phase 2** with the `DataProvider` interface and the CSV loader.

## Known gaps / caveats

- `.md` specs use Cucumber's Markdown-with-Gherkin (MDG) syntax (`# Feature:`, `## Scenario:`, `* Given`), not Gauge's
  format. Gauge-style Markdown is a Phase 2 item.
- Hook levels `worker`, `group`, `attempt` do not exist yet (phases 3–4).
- Console reporter does not print attachments or logs (they are in NDJSON).
- Run-level hook failures are summarised under "Hook failures:" in console output, not per scenario.
- `bddx list` does not load support code, so it cannot flag undefined steps (use `--dry-run`).
- Working copy: `/Users/afsarali/Repository/AI_Projects/BDD_Framework` (all future work goes here directly).
- No git repository yet. Suggested first commit after extracting: `git init && git add -A && git commit -m "Phase 0 + Phase 1 core"`.

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
