import { strict as assert } from 'node:assert';
import { Given, Then, When, type DataTable, type StepContext } from '@bddx/runtime';
import type { Locator } from 'playwright';
import { page, requiredParam } from '../support/world.js';

Given('the SauceDemo login page is open', async (ctx) => {
  await page(ctx).goto(requiredParam(ctx, 'sauceBaseUrl'), { waitUntil: 'domcontentloaded' });
});

Given('I am signed in to SauceDemo as {string}', async (ctx, username: string) => {
  await openAndLogin(ctx, username, 'secret_sauce');
  await page(ctx).locator('[data-test="inventory-list"]').waitFor();
});

When('I sign in to SauceDemo as {string} with password {string}', async (ctx, username: string, password: string) => {
  await login(ctx, username, password);
});

Then('the SauceDemo inventory page is displayed', async (ctx) => {
  assert.equal(new URL(page(ctx).url()).pathname, '/inventory.html');
  await page(ctx).locator('[data-test="inventory-list"]').waitFor();
});

Then('the SauceDemo login error contains {string}', async (ctx, expected: string) => {
  assert.ok((await page(ctx).locator('[data-test="error"]').innerText()).includes(expected));
});

When('I log out of SauceDemo', async (ctx) => {
  await page(ctx).locator('#react-burger-menu-btn').click();
  await page(ctx).locator('#logout_sidebar_link').click();
});

Then('the SauceDemo login page is displayed', async (ctx) => {
  assert.equal(new URL(page(ctx).url()).pathname, '/');
  await page(ctx).locator('[data-test="login-button"]').waitFor({ state: 'visible' });
});

Then('SauceDemo displays {int} inventory products', async (ctx, expected: number) => {
  assert.equal(await page(ctx).locator('[data-test="inventory-item"]').count(), expected);
});

When('I sort SauceDemo inventory by {string}', async (ctx, label: string) => {
  await page(ctx).locator('[data-test="product-sort-container"]').selectOption({ label });
});

Then('the first SauceDemo product is {string}', async (ctx, expected: string) => {
  assert.equal((await page(ctx).locator('[data-test="inventory-item-name"]').first().innerText()).trim(), expected);
});

When('I open SauceDemo product {string}', async (ctx, product: string) => {
  const item = inventoryItem(ctx, product);
  await item.locator('[data-test="inventory-item-name"]').click();
  await page(ctx).waitForURL(/inventory-item\.html\?id=/);
  await page(ctx).locator('[data-test="inventory-item-name"]').first().waitFor();
});

Then('the SauceDemo product detail name is {string}', async (ctx, expected: string) => {
  const ids: Record<string, string> = {
    'Sauce Labs Backpack': '4',
    'Sauce Labs Bike Light': '0',
    'Sauce Labs Bolt T-Shirt': '1',
  };
  assert.equal(new URL(page(ctx).url()).pathname, '/inventory-item.html');
  assert.equal(new URL(page(ctx).url()).searchParams.get('id'), ids[expected]);
});

When('I add SauceDemo product {string} to the cart', async (ctx, product: string) => {
  await inventoryItem(ctx, product).getByRole('button', { name: 'Add to cart' }).click();
});

When('I add these SauceDemo products to the cart:', async (ctx, table: DataTable) => {
  for (const row of table.hashes()) {
    await inventoryItem(ctx, row['product'] ?? '').getByRole('button', { name: 'Add to cart' }).click();
  }
});

Then('the SauceDemo cart badge is {int}', async (ctx, expected: number) => {
  assert.equal(Number(await page(ctx).locator('[data-test="shopping-cart-badge"]').innerText()), expected);
});

Then('the SauceDemo cart contains {string}', async (ctx, product: string) => {
  await page(ctx).locator('[data-test="shopping-cart-link"]').click();
  const names = await page(ctx).locator('[data-test="inventory-item-name"]').allInnerTexts();
  assert.ok(names.includes(product));
});

async function openAndLogin(ctx: StepContext, username: string, password: string): Promise<void> {
  await page(ctx).goto(requiredParam(ctx, 'sauceBaseUrl'), { waitUntil: 'domcontentloaded' });
  await login(ctx, username, password);
}

async function login(ctx: StepContext, username: string, password: string): Promise<void> {
  await page(ctx).locator('[data-test="username"]').fill(username);
  await page(ctx).locator('[data-test="password"]').fill(password);
  await page(ctx).locator('[data-test="login-button"]').click();
}

function inventoryItem(ctx: StepContext, product: string): Locator {
  return page(ctx).locator('[data-test="inventory-item"]').filter({ hasText: product });
}
