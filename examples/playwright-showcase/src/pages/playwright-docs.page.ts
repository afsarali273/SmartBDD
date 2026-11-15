import type { Page } from 'playwright';

export class PlaywrightDocsPage {
  constructor(private readonly page: Page) {}

  async open(baseUrl: string, path = '/'): Promise<void> {
    await this.page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  }

  async title(): Promise<string> {
    return this.page.title();
  }

  async heading(name: string): Promise<string> {
    return (await this.page.getByRole('heading', { name, exact: true }).first().innerText()).trim();
  }

  async openGettingStarted(): Promise<void> {
    await this.page.getByRole('link', { name: 'Get started', exact: true }).click();
  }

  currentPath(): string {
    return new URL(this.page.url()).pathname;
  }
}
