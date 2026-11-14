import { strict as assert } from 'node:assert';
import { AfterGroup, BeforeGroup, Given, Then, When } from '@bddx/runtime';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const orders: string[] = []; // process-wide fake backend

BeforeGroup('@group:checkout', (ctx) => {
  ctx.group.set('cart-service', 'http://localhost:4000');
  ctx.log('checkout group: cart service ready');
});
AfterGroup('@group:checkout', (ctx) => ctx.log(`checkout group done: ${orders.length} orders`));

Given('I create user {string}', async (ctx, name: string) => {
  await sleep(20);
  ctx.export('user', { name, id: 'u-1' });
});

When('I log in as {string}', async (ctx, name: string) => {
  const user = ctx.from('create-user').get<{ name: string; id: string }>('user');
  assert.equal(user.name, name);
  await sleep(20);
  ctx.export('token', `token-for-${user.id}`);
});

Given('I am logged in', (ctx) => {
  ctx.state.set('token', ctx.from('login').get<string>('token'));
});

When('I buy {string}', async (ctx, product: string) => {
  assert.ok(ctx.groups['checkout']?.get('cart-service'));
  await sleep(50);
  orders.push(product);
  ctx.state.set('order', product);
});

Then('the order is confirmed', (ctx) => {
  assert.ok(orders.includes(ctx.state.get<string>('order')));
});

When('I pay {int} by {string}', async (_ctx, _amount: number, _method: string) => {
  await sleep(30);
});

Then('the report lists all orders', (ctx) => {
  ctx.attach(JSON.stringify(orders), 'application/json', 'orders');
  assert.equal(orders.length, 4);
});
