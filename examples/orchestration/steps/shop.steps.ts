import { strict as assert } from 'node:assert';
import { AfterGroup, BeforeGroup, Given, Then, When, log } from '@bddx/runtime';

/** A helper outside any step: the global `log` is attributed to the running scenario. */
const paymentGateway = {
  async charge(amount: number, method: string) {
    log.debug('gateway request', { amount, method });
    if (method === 'wallet') log.warn(`wallet payments are slow in this environment (${amount})`);
    await sleep(30);
  },
};

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
  ctx.log.debug('logged in', { user });
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

When('I pay {int} by {string}', async (ctx, amount: number, method: string) => {
  ctx.log.info(`paying ${amount} by ${method}`);
  await paymentGateway.charge(amount, method);
});

Then('the report lists all orders', (ctx) => {
  ctx.attach(JSON.stringify(orders), 'application/json', 'orders');
  assert.equal(orders.length, 4);
});
