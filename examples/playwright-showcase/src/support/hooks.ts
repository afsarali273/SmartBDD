import {
  After,
  AfterAll,
  AfterFeature,
  AfterGroup,
  AfterStep,
  AfterWorker,
  Before,
  BeforeAll,
  BeforeFeature,
  BeforeGroup,
  BeforeStep,
  BeforeWorker,
} from '@bddx/runtime';
import { chromium, request, type APIRequestContext, type BrowserContext } from 'playwright';
import { API, BROWSER, BROWSER_CONTEXT, PAGE, browser, page, requiredParam } from './world.js';

BeforeAll((ctx) => {
  ctx.run.set('suiteStartedAt', new Date().toISOString());
  ctx.log.info('Starting Playwright showcase', {
    ui: requiredParam(ctx, 'uiBaseUrl'),
    api: requiredParam(ctx, 'apiBaseUrl'),
    pool: 'process',
  });
});

AfterAll((ctx) => {
  ctx.log.info('Playwright showcase finished', { startedAt: ctx.run.get<string>('suiteStartedAt') });
});

BeforeWorker(async (ctx) => {
  const headless = ctx.params['headless'] !== 'false';
  ctx.run.set(BROWSER, await chromium.launch({ headless }));
  ctx.run.set(API, await request.newContext({
    baseURL: requiredParam(ctx, 'apiBaseUrl'),
    extraHTTPHeaders: { Accept: 'application/json', 'User-Agent': 'bddx-playwright-showcase' },
    timeout: 15_000,
  }));
  ctx.log.debug('Playwright resources ready', { worker: process.env['BDDX_WORKER_ID'] ?? 'inline' });
});

AfterWorker(async (ctx) => {
  await ctx.run.get<APIRequestContext>(API).dispose();
  await browser(ctx).close();
});

BeforeGroup((ctx) => ctx.log.info(`Group ${ctx.groupName} started`));
AfterGroup((ctx) => ctx.log.info(`Group ${ctx.groupName} finished`));

BeforeFeature((ctx) => {
  ctx.feature.set('startedAt', Date.now());
  ctx.log.debug(`Feature started: ${ctx.featureInfo.name}`);
});

AfterFeature((ctx) => {
  ctx.log.debug(`Feature finished: ${ctx.featureInfo.name}`, {
    durationMs: Date.now() - ctx.feature.get<number>('startedAt'),
  });
});

Before('@ui', async (ctx) => {
  const context = await browser(ctx).newContext({
    baseURL: requiredParam(ctx, 'uiBaseUrl'),
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(10_000);
  const scenarioPage = await context.newPage();
  ctx.state.set(BROWSER_CONTEXT, context);
  ctx.state.set(PAGE, scenarioPage);
});

// After hooks run in reverse registration order. Register close first so capture runs before it.
After('@ui', async (ctx) => {
  const context = ctx.state.find<BrowserContext>(BROWSER_CONTEXT);
  if (context) await context.close();
});

After('@capture', async (ctx) => {
  const screenshot = await page(ctx).screenshot({ fullPage: true });
  ctx.attach(screenshot, 'image/png', `${ctx.scenario.id}.png`);
});

BeforeStep({ eachAttempt: true }, (ctx) => {
  ctx.log.debug(`Step attempt ${ctx.step?.attempt ?? 1}: ${ctx.step?.text ?? 'hook'}`);
});

AfterStep({ eachAttempt: true }, (ctx) => {
  ctx.log.debug(`Step attempt finished: ${ctx.step?.text ?? 'hook'}`);
});
