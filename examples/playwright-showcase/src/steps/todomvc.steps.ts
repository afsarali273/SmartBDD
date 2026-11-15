import { strict as assert } from 'node:assert';
import { Given, Then, When, type DataTable, type StepContext } from '@bddx/runtime';
import type { Locator } from 'playwright';
import { page, requiredParam } from '../support/world.js';

Given('the TodoMVC application is open', async (ctx) => {
  await page(ctx).goto(requiredParam(ctx, 'todoBaseUrl'), { waitUntil: 'domcontentloaded' });
});

Given('TodoMVC contains items {string} and {string}', async (ctx, first: string, second: string) => {
  await addTodo(ctx, first);
  await addTodo(ctx, second);
});

Given('TodoMVC contains items {string}, {string} and {string}', async (ctx, first: string, second: string, third: string) => {
  await addTodo(ctx, first);
  await addTodo(ctx, second);
  await addTodo(ctx, third);
});

When('I add TodoMVC item {string}', async (ctx, title: string) => {
  await addTodo(ctx, title);
});

When('I add these TodoMVC items:', async (ctx, table: DataTable) => {
  for (const row of table.hashes()) await addTodo(ctx, row['title'] ?? '');
});

When('I complete TodoMVC item {string}', async (ctx, title: string) => {
  await todo(ctx, title).locator('.toggle').check();
});

When('I delete TodoMVC item {string}', async (ctx, title: string) => {
  const item = todo(ctx, title);
  await item.hover();
  await item.locator('.destroy').click();
});

When('I select TodoMVC filter {string}', async (ctx, filter: string) => {
  await page(ctx).getByRole('link', { name: filter, exact: true }).click();
  await page(ctx).getByRole('link', { name: filter, exact: true }).waitFor({ state: 'visible' });
  await page(ctx).locator('a.selected').filter({ hasText: filter }).waitFor();
});

When('I clear completed TodoMVC items', async (ctx) => {
  await page(ctx).locator('.clear-completed').click();
});

When('I mark all TodoMVC items complete', async (ctx) => {
  await page(ctx).locator('.toggle-all').check();
});

When('I rename TodoMVC item {string} to {string}', async (ctx, current: string, next: string) => {
  const item = todo(ctx, current);
  await item.locator('label').dblclick();
  await item.locator('.edit').fill(next);
  await item.locator('.edit').press('Enter');
});

When('I reload TodoMVC', async (ctx) => {
  await page(ctx).reload({ waitUntil: 'domcontentloaded' });
});

Then('TodoMVC displays {int} todo items', async (ctx, expected: number) => {
  assert.equal(await page(ctx).locator('.todo-list li').count(), expected);
});

Then('TodoMVC displays 1 todo item', async (ctx) => {
  assert.equal(await page(ctx).locator('.todo-list li').count(), 1);
});

Then('TodoMVC displays {int} visible todo items', async (ctx, expected: number) => {
  assert.equal(await page(ctx).locator('.todo-list li').count(), expected);
});

Then('TodoMVC displays {int} completed items', async (ctx, expected: number) => {
  assert.equal(await page(ctx).locator('.todo-list li.completed').count(), expected);
});

Then('TodoMVC contains item {string}', async (ctx, title: string) => {
  assert.equal(await todo(ctx, title).count(), 1);
});

Then('TodoMVC does not contain item {string}', async (ctx, title: string) => {
  assert.equal(await todo(ctx, title).count(), 0);
});

Then('TodoMVC item {string} is completed', async (ctx, title: string) => {
  assert.ok((await todo(ctx, title).getAttribute('class'))?.split(/\s+/).includes('completed'));
});

Then('the TodoMVC counter says {string}', async (ctx, expected: string) => {
  assert.equal((await page(ctx).locator('.todo-count').innerText()).trim(), expected);
});

async function addTodo(ctx: StepContext, title: string): Promise<void> {
  const input = page(ctx).locator('.new-todo');
  await input.fill(title);
  await input.press('Enter');
}

function todo(ctx: StepContext, title: string): Locator {
  return page(ctx).locator('.todo-list li').filter({ has: page(ctx).locator('label', { hasText: title }) });
}
