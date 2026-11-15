import type { APIRequestContext, Browser, BrowserContext, Page } from 'playwright';
import type { RunContext, StepContext } from '@bddx/runtime';

export const BROWSER = 'playwright.browser';
export const API = 'playwright.api';
export const BROWSER_CONTEXT = 'playwright.browserContext';
export const PAGE = 'playwright.page';
export const RESPONSE = 'playwright.response';
export const HEALTH_STATUS = 'health.status';

export interface ResponseSnapshot {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  url: string;
}

export function browser(ctx: RunContext): Browser {
  return ctx.run.get<Browser>(BROWSER);
}

export function api(ctx: RunContext): APIRequestContext {
  return ctx.run.get<APIRequestContext>(API);
}

export function browserContext(ctx: StepContext): BrowserContext {
  return ctx.state.get<BrowserContext>(BROWSER_CONTEXT);
}

export function page(ctx: StepContext): Page {
  return ctx.state.get<Page>(PAGE);
}

export function response(ctx: StepContext): ResponseSnapshot {
  return ctx.state.get<ResponseSnapshot>(RESPONSE);
}

export function requiredParam(ctx: RunContext, name: string): string {
  const value = ctx.params[name];
  if (!value) throw new Error(`Missing required bddx parameter: ${name}`);
  return value.replace(/\/$/, '');
}

export async function snapshotResponse(
  ctx: StepContext,
  result: { status(): number; headers(): Record<string, string>; text(): Promise<string>; url(): string },
): Promise<ResponseSnapshot> {
  const text = await result.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      // Some health endpoints return HTML. Preserve it as text.
    }
  }
  const snapshot = { status: result.status(), headers: result.headers(), body, url: result.url() };
  ctx.state.set(RESPONSE, snapshot);
  ctx.attach(JSON.stringify(snapshot.body, null, 2), 'application/json', 'api-response.json');
  return snapshot;
}
