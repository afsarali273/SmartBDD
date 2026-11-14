# Architecture decision records

Newest last. Each record: context, decision, consequences. Do not edit old records; supersede them.

## ADR-001 Own runner instead of compiling to Playwright Test (2026-11-15)

**Context.** playwright-bdd compiles features into Playwright Test files and gets parallelism, fixtures and
trace viewer for free. But Playwright Test cannot express cross-file scenario dependencies, group-level retry,
named resource locks or mixed serial/parallel groups in one run, which are our main differentiators.

**Decision.** bddx has its own executor and (phase 3) scheduler. Playwright will be an integration (phase 6).

**Consequences.** More work (workers, timeouts, reporting are ours). Full control over the plan graph.
The decision is still open for the user to overturn (comment in the plan doc); if overturned, `core` and the
event schema survive, `runtime/executor.ts` would be replaced by a code generator.

## ADR-002 Working name "bddx", npm scope `@bddx/*` (2026-11-15)

Placeholder name. Renaming = search/replace of `bddx` / `@bddx` + config file names (`bddx.config.*`) +
the global registry symbol (`bddx.registry.v1`).

## ADR-003 npm workspaces + TypeScript project references (2026-11-15)

npm ships with Node, so contributors need nothing extra (the plan doc said pnpm; npm was chosen for zero setup).
`tsc -b` builds `core → runtime → reporters → cli` in order. TypeScript pinned to 5.9 (TS 7 native compiler exists
but we wait until its API/ecosystem settle).

## ADR-004 Reuse Cucumber's open-source building blocks (2026-11-15)

`@cucumber/gherkin` (parser + pickle compiler), `@cucumber/messages` (AST types), `@cucumber/cucumber-expressions`,
`@cucumber/tag-expressions`, all MIT. We get exact Gherkin syntax, all languages, Markdown-with-Gherkin, and the same
expression semantics as Cucumber. We do not use Cucumber's runner.

## ADR-005 Context-first step signature (2026-11-15)

`Given('x {int}', (ctx, n) => …)` instead of Cucumber's `this` world. Works with arrow functions, is explicit about
scope (`ctx.state` / `ctx.feature` / `ctx.run`), and maps 1:1 to a Java method parameter. Class/decorator steps with
dependency injection come later as an alternative style (Phase 1 remainder).

## ADR-006 Stable ids are text-based, not position-based (2026-11-15)

`@id:` tag or `<uri>::<slug(name)>[row]`. Dependencies and reruns need ids that survive reordering and line changes.
Renaming a scenario without `@id` changes its id; teams that depend on a scenario should give it an `@id`.

## ADR-007 Own event schema (v1), Cucumber Messages via adapter later (2026-11-15)

Cucumber Messages lacks concepts we need (groups, attempts per group, locks, hook levels beyond scenario).
We emit our own flat, documented NDJSON schema and will add a Messages adapter (phase 5) for ecosystem tools.

## ADR-008 TypeScript step files loaded with tsx (2026-11-15)

The CLI calls tsx's `register()` before importing config and support files, so users need no build step.
The global registry lives on `globalThis` under a `Symbol.for` key so duplicate package copies still share it.

## ADR-009 Strict by default (2026-11-15)

Pending, undefined and ambiguous scenarios fail the run unless `strict: false` / `--no-strict`, so a green CI run
means every step really ran.

## ADR-010 Decorators are the normal API functions; `@Steps()` required (2026-11-15)

`Given('x', fn)` registers a function step; `Given('x')` returns a TC39 method decorator. Same for scenario/step
hooks. One vocabulary for both styles, and it maps to Java annotations. Standard (TC39) decorators, not
`experimentalDecorators`: method decorators cannot see their class, so `@Steps()` collects them. DI uses
`static inject = [...]` (no reflection metadata, no `emitDecoratorMetadata`). Lowercase decorator names were tried
and dropped: an export named `then` makes the module thenable and `await import()` hangs.

Vite 8 (vitest 5) transpiles with oxc, which does not lower TC39 decorators yet; `vitest.config.ts` pre-compiles
decorator files with the TypeScript compiler. tsx (esbuild) at runtime handles them natively.

## ADR-011 @data expansion by AST injection (2026-11-15)

Data rows are injected into the Gherkin AST as Examples rows before Cucumber's pickle compiler runs, so placeholders in
step text, data tables and doc strings behave exactly like normal outlines and the compiler stays unmodified.
Loading is async (`parseSpecAsync`); the sync `parseSpec` flags `@data` scenarios as errors rather than running
them with unresolved placeholders. Missing data is an error, never a silent zero-row pass.

## ADR-012 exceljs for XLSX, uuid forced to 11 (2026-11-15)

SheetJS's npm package is unmaintained (the maintained build is off-registry); exceljs is MIT and on npm.
exceljs 4.4 depends on uuid 8 (advisory GHSA-w5hq-g745-h8pq); root `overrides` pins uuid ^11.1.1, verified
by the XLSX tests. Remove the override when exceljs updates. XLSX/YAML are loaded with dynamic `import()`
so they cost nothing unless used.

## ADR-013 Stable ids use the template name (supersedes part of ADR-006) (2026-11-15)

Ids are built from the scenario name BEFORE `<placeholder>` substitution and, for data rows, from the source row
number BEFORE filtering. Inline outline rows keep `[<row index>]`; data rows use `[<source>#<row>]`.
