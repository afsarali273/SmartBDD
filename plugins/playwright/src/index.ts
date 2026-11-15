/**
 * @bddx/playwright: Playwright for bddx, as a plugin. bddx does not depend on Playwright; your project does.
 *
 *   // bddx.config.ts
 *   import { playwright } from '@bddx/playwright';
 *   export default defineConfig({ plugins: [playwright({ browser: 'chromium', screenshot: 'only-on-failure' })] });
 *
 *   // steps
 *   Given('I open {string}', ({ page }, url: string) => page.goto(url));
 *   class LoginPage { private page = inject('page'); }
 *
 * Fixtures:
 *   playwright  worker    the `playwright` module (devices, selectors ...)
 *   browser     worker    launched on first use, one per worker process (pool 'inline': shared by the run)
 *   context     scenario  a fresh BrowserContext per scenario attempt (isolated cookies/storage); trace and video
 *   page        scenario  a page in that context; screenshot at the end per `screenshot`
 *               With `reuseContext` a @serial feature gets ONE context and page for all its scenarios instead
 *               (sharedContext / sharedPage, feature scoped): log in once, keep cookies and the open page.
 *   request     scenario  an APIRequestContext (no browser is launched for API-only scenarios)
 *
 * Run-time overrides with -D: `-D browser=firefox`, `-D headed=true`, `-D baseURL=https://staging.example.com`.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  APIRequestContext,
  APIRequest,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  LaunchOptions,
  Page,
  Video,
} from 'playwright';
import { defineFixture, definePlugin, type BddxPlugin, type FeatureContext, type RunContext, type StepContext } from '@bddx/runtime';

type PlaywrightModule = typeof import('playwright');
/** Options of `playwright.request.newContext()`. */
export type APIRequestContextOptions = NonNullable<Parameters<APIRequest['newContext']>[0]>;

declare module '@bddx/runtime' {
  interface Fixtures {
    playwright: PlaywrightModule;
    browser: Browser;
    context: BrowserContext;
    page: Page;
    request: APIRequestContext;
    /** The context shared by a feature's scenarios when it reuses one (see `reuseContext`). */
    sharedContext: BrowserContext;
    sharedPage: Page;
  }
}

export type BrowserName = 'chromium' | 'firefox' | 'webkit';
/** `only-on-failure`: kept/attached only when the scenario failed. */
export type ArtifactMode = 'off' | 'on' | 'only-on-failure';

export interface PlaywrightPluginOptions {
  /** Default 'chromium'. `-D browser=firefox` overrides. */
  browser?: BrowserName;
  /** Branded browser for chromium: 'chrome', 'msedge', 'chrome-beta' ... */
  channel?: string;
  /** Default true. `-D headed=true` overrides. */
  headless?: boolean;
  /** Extra `browserType.launch()` options (slowMo, args, proxy ...). */
  launch?: LaunchOptions;
  /** `browser.newContext()` options (baseURL, viewport, locale, storageState ...). `-D baseURL=` overrides baseURL. */
  context?: BrowserContextOptions;
  /** `request.newContext()` options for the `request` fixture. baseURL defaults to the context baseURL. */
  request?: APIRequestContextOptions;
  /** Default timeout for actions (ms), `context.setDefaultTimeout`. */
  actionTimeoutMs?: number;
  /** Default timeout for navigations (ms), `context.setDefaultNavigationTimeout`. */
  navigationTimeoutMs?: number;
  /** Full-page screenshot at the end of the scenario, attached to the report. Default 'only-on-failure'. */
  screenshot?: ArtifactMode;
  /** Playwright trace (open with `npx playwright show-trace <file>`). Default 'off'. */
  trace?: ArtifactMode;
  /** Video of every page. Default 'off'. */
  video?: ArtifactMode;
  /** Where traces and videos go, relative to the working directory. Default 'reports/playwright'. */
  outputDir?: string;
  /**
   * Reuse one browser context and page for every scenario of a @serial feature (one session: cookies, storage and the
   * open page carry over; the browser is never closed in between). 'off' (default): a fresh context per scenario.
   * 'serial': every @serial feature reuses. Per feature: `@reuseContext` (needs @serial) / `@freshContext`.
   * The trace and video then cover the whole feature; screenshots are still taken per failed scenario.
   */
  reuseContext?: 'off' | 'serial';
}

const keep = (mode: ArtifactMode | undefined, status: string | undefined) => mode === 'on' || (mode === 'only-on-failure' && status === 'failed');
const slug = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'scenario';
const bool = (v: string | undefined) => (v === undefined ? undefined : /^(1|true|yes|on)$/i.test(v));
const BROWSERS: readonly BrowserName[] = ['chromium', 'firefox', 'webkit'];

/** Build the plugin. `load` is how the `playwright` module is imported (tests pass a fake). */
export function createPlaywrightPlugin(load: () => Promise<PlaywrightModule> = () => import('playwright')): BddxPlugin<PlaywrightPluginOptions> {
  return definePlugin<PlaywrightPluginOptions>({
    name: 'playwright',
    setup(o = {}) {
      const outputDir = resolve(o.outputDir ?? 'reports/playwright');
      const screenshot = o.screenshot ?? 'only-on-failure';
      const trace = o.trace ?? 'off';
      const video = o.video ?? 'off';
      const baseURLOf = (ctx: { params: Readonly<Record<string, string>> }) => ctx.params['baseURL'] ?? o.context?.baseURL;
      const artifactName = (ctx: StepContext) => `${slug(ctx.scenario.id)}${ctx.scenario.attempt > 1 ? `-attempt${ctx.scenario.attempt}` : ''}`;

      defineFixture('playwright', () => load(), { scope: 'worker' });

      defineFixture(
        'browser',
        async ({ playwright, params }) => {
          const name = (params['browser'] ?? o.browser ?? 'chromium') as BrowserName;
          if (!BROWSERS.includes(name)) throw new Error(`@bddx/playwright: browser must be ${BROWSERS.join(', ')} (got "${name}")`);
          const headed = bool(params['headed']);
          return playwright[name].launch({
            ...o.launch,
            headless: headed !== undefined ? !headed : (o.headless ?? o.launch?.headless ?? true),
            ...(o.channel && name === 'chromium' ? { channel: o.channel } : {}),
          });
        },
        { scope: 'worker', teardown: (b) => b.close() },
      );

      // ---- contexts: one per scenario, or one per @serial feature when it reuses
      const openContext = async (browser: Browser, ctx: RunContext, title: string): Promise<BrowserContext> => {
        const baseURL = baseURLOf(ctx);
        const context = await browser.newContext({
          ...o.context,
          ...(baseURL ? { baseURL } : {}),
          ...(video !== 'off' ? { recordVideo: { dir: join(outputDir, 'videos'), ...o.context?.recordVideo } } : {}),
        });
        if (o.actionTimeoutMs !== undefined) context.setDefaultTimeout(o.actionTimeoutMs);
        if (o.navigationTimeoutMs !== undefined) context.setDefaultNavigationTimeout(o.navigationTimeoutMs);
        if (trace !== 'off') await context.tracing.start({ screenshots: true, snapshots: true, sources: true, title });
        return context;
      };
      const closeContext = async (context: BrowserContext, status: string | undefined, name: string, ctx: RunContext) => {
        if (trace !== 'off') {
          if (keep(trace, status)) {
            const path = join(outputDir, 'traces', `${name}.zip`);
            await context.tracing.stop({ path });
            ctx.log.info(`Playwright trace: ${path}  (npx playwright show-trace "${path}")`);
          } else {
            await context.tracing.stop();
          }
        }
        const videos = video !== 'off' ? context.pages().flatMap((p) => (p.video() ? [p.video() as Video] : [])) : [];
        await context.close();
        for (const [i, v] of videos.entries()) {
          if (keep(video, status)) {
            const path = join(outputDir, 'videos', `${name}${videos.length > 1 ? `-${i + 1}` : ''}.webm`);
            await v.saveAs(path);
            await v.delete();
            ctx.log.info(`Playwright video: ${path}`);
          } else {
            await v.delete();
          }
        }
      };
      const screenshotTo = async (page: Page, status: string | undefined, ctx: RunContext) => {
        if (!keep(screenshot, status) || page.isClosed()) return;
        try {
          ctx.attach(await page.screenshot({ fullPage: true }), 'image/png', `screenshot ${status ?? ''}`.trim());
        } catch (e) {
          ctx.log.warn(`@bddx/playwright: could not take a screenshot: ${e instanceof Error ? e.message : String(e)}`);
        }
      };

      const shared = new WeakSet<object>();
      const featureFailed = new WeakMap<object, boolean>();
      const contextOf = new WeakMap<Page, BrowserContext>();
      /** Does this scenario use the feature's shared context? */
      const reuses = (ctx: StepContext): boolean => {
        const tags = ctx.featureInfo.tags.map((t) => t.name);
        if (tags.includes('@freshContext')) return false;
        const asked = tags.includes('@reuseContext');
        if (asked && ctx.scenario.serial !== 'feature') {
          throw new Error(
            `@reuseContext on feature "${ctx.featureInfo.name}" needs @serial on the Feature: scenarios sharing one browser context must run one at a time, in order`,
          );
        }
        return asked || (o.reuseContext === 'serial' && ctx.scenario.serial === 'feature');
      };

      defineFixture(
        'sharedContext',
        async (ctx: FeatureContext) => {
          const context = await openContext(await ctx.fixture('browser'), ctx, ctx.featureInfo.name);
          shared.add(context);
          return context;
        },
        {
          scope: 'feature',
          afterScenario: (context, { status }) => {
            if (status === 'failed') featureFailed.set(context, true);
          },
          teardown: (context, { ctx }) =>
            closeContext(context, featureFailed.get(context) ? 'failed' : 'passed', slug((ctx as FeatureContext).featureInfo.uri), ctx),
        },
      );
      defineFixture(
        'sharedPage',
        async (ctx: FeatureContext) => {
          const context = await ctx.fixture('sharedContext');
          const page = await context.newPage();
          shared.add(page);
          contextOf.set(page, context);
          return page;
        },
        {
          scope: 'feature',
          afterScenario: async (page, { status, ctx }) => {
            const context = contextOf.get(page);
            if (status === 'failed' && context) featureFailed.set(context, true);
            await screenshotTo(page, status, ctx);
          },
        },
      );

      defineFixture(
        'context',
        async (ctx: StepContext) => (reuses(ctx) ? ctx.fixture('sharedContext') : openContext(await ctx.fixture('browser'), ctx, ctx.scenario.name)),
        { teardown: (context, { status, ctx }) => (shared.has(context) ? undefined : closeContext(context, status, artifactName(ctx as StepContext), ctx)) },
      );

      defineFixture('page', async (ctx: StepContext) => (reuses(ctx) ? ctx.fixture('sharedPage') : (await ctx.fixture('context')).newPage()), {
        teardown: (page, { status, ctx }) => (shared.has(page) ? undefined : screenshotTo(page, status, ctx)),
      });

      defineFixture(
        'request',
        async (ctx) => {
          const baseURL = o.request?.baseURL ?? baseURLOf(ctx);
          return ctx.playwright.request.newContext({ ...o.request, ...(baseURL ? { baseURL } : {}) });
        },
        { teardown: (r) => r.dispose() },
      );

      mkdirSync(outputDir, { recursive: true });
    },
  });
}

/** The plugin with Playwright from your project. Use as `plugins: ['@bddx/playwright']` or `plugins: [playwright({ ... })]`. */
const plugin = createPlaywrightPlugin();
export default plugin;

/** Typed form for bddx.config.ts: `plugins: [playwright({ browser: 'firefox', trace: 'only-on-failure' })]`. */
export function playwright(options: PlaywrightPluginOptions = {}): { name: string; setup(): void | Promise<void> } {
  return { name: plugin.name, setup: () => plugin.setup(options) };
}
