# @bddx/playwright

Playwright for [bddx](../../README.md), as a plugin. bddx has no dependency on Playwright: your project installs
both, and this plugin connects them through bddx fixtures.

```bash
npm i -D @bddx/playwright playwright
npx playwright install chromium
```

```ts
// bddx.config.ts
import { defineConfig } from '@bddx/cli';
import { playwright } from '@bddx/playwright';

export default defineConfig({
  plugins: [playwright({ browser: 'chromium', screenshot: 'only-on-failure', trace: 'only-on-failure' })],
  // or untyped: plugins: [['@bddx/playwright', { browser: 'firefox' }]]
});
```

```ts
// steps: ask for what you need
Given('I open {string}', ({ page }, path: string) => page.goto(path));
When('I GET {string}', async ({ request, state }, path: string) => state.set('res', await request.get(path)));

// page objects and step classes: inject()
class LoginPage { private page = inject('page'); open() { return this.page.goto('/login'); } }
@Steps() class LoginSteps { private login = inject(LoginPage); /* @Given(...) methods */ }
```

Add `import '@bddx/playwright';` (or `"types": ["@bddx/playwright"]` in tsconfig) in one support file so `ctx.page`,
`({ page })` and `inject('page')` are typed. Importing `playwright()` in the config does not do this for step files.

## Fixtures

| name | scope | what |
|---|---|---|
| `playwright` | worker | the `playwright` module (devices, selectors) |
| `browser` | worker | launched on first use; one per worker process (pool `inline`: one for the run, shared by concurrent scenarios) |
| `context` | scenario | fresh `BrowserContext` per scenario attempt (isolated cookies and storage); trace and video |
| `page` | scenario | a page in that context; screenshot at the end |
| `request` | scenario | `APIRequestContext` for API tests; never launches a browser |

With `reuseContext`, a `@serial` feature uses one context and page for all its scenarios instead (feature-scoped
`sharedContext` / `sharedPage`); see below. Scenarios that use none of these start nothing. Retries get a fresh context and page. Groups, dependencies, locks,
`--pool process`, `--shard` and `--watch` work as usual.

## Options

| option | default | |
|---|---|---|
| `browser` | `'chromium'` | `'chromium' \| 'firefox' \| 'webkit'`; `-D browser=firefox` overrides |
| `channel` | | chromium only: `'chrome'`, `'msedge'` ... |
| `headless` | `true` | `-D headed=true` overrides |
| `launch` | | extra `launch()` options (`slowMo`, `args`, `proxy` ...) |
| `context` | | `newContext()` options (`baseURL`, `viewport`, `locale`, `storageState` ...); `-D baseURL=...` overrides `baseURL` |
| `request` | | `request.newContext()` options; `baseURL` defaults to the context's |
| `actionTimeoutMs`, `navigationTimeoutMs` | Playwright's | context default timeouts |
| `screenshot` | `'only-on-failure'` | `'off' \| 'on' \| 'only-on-failure'`; full page, attached to the report |
| `trace` | `'off'` | same values; saved under `outputDir/traces`, path logged (`npx playwright show-trace <file>`) |
| `video` | `'off'` | same values; saved under `outputDir/videos` |
| `outputDir` | `'reports/playwright'` | relative to the working directory |
| `reuseContext` | `'off'` | `'serial'`: every `@serial` feature shares one context and page |

## One browser session per feature

```gherkin
@serial @reuseContext
Feature: Checkout journey
  Scenario: log in             # opens the context and page
  Scenario: add to basket      # same page, still logged in
  Scenario: pay                # same page
```

- Needs `@serial` on the Feature (sharing a page only works one scenario at a time); `@reuseContext` without it is an
  error. `reuseContext: 'serial'` turns it on for every serial feature; `@freshContext` opts one out.
- The browser stays open; the context and page are closed when the feature ends. In `--pool process` the whole feature
  runs in one worker process, so nothing is lost between scenarios.
- Screenshots are still per failed scenario (from the shared page). The trace and video cover the whole feature and are
  kept when any of its scenarios failed (`only-on-failure`).
- A retried scenario continues on the same page, in whatever state the failed attempt left it.
- Selecting one scenario of the feature (`-t`, `file:line`) runs it alone on a new shared session: it does not replay the
  earlier scenarios, so make it able to start on its own or run the whole feature.

## Example

`example/` is a complete project that runs offline (a local HTTP server is a worker fixture): UI login scenarios in a
serial group with a page object, and API scenarios that never open a browser.

```bash
cd plugins/playwright && npm install && npx playwright install chromium
cd example && npx bddx            # or: npx bddx --pool process -w 2, -D headed=true, --tags @api
```

## Developing

`npm run verify` (typecheck, build, tests). Tests use a fake Playwright module, so they need no browsers.
