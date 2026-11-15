import type { Locator, Page } from 'playwright';

export class TodoMvcPage {
  constructor(private readonly page: Page) {}

  private get newTodoInput() {
    return this.page.locator('.new-todo');
  }

  private get todoList() {
    return this.page.locator('.todo-list li');
  }

  async open(baseUrl: string): Promise<void> {
    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  }

  async addTodo(title: string): Promise<void> {
    await this.newTodoInput.fill(title);
    await this.newTodoInput.press('Enter');
  }

  async addTodos(titles: string[]): Promise<void> {
    for (const title of titles) await this.addTodo(title);
  }

  item(title: string): Locator {
    return this.todoList.filter({
      has: this.page.locator('label').filter({ hasText: title }),
    });
  }

  async complete(title: string): Promise<void> {
    await this.item(title).locator('.toggle').check();
  }

  async delete(title: string): Promise<void> {
    const item = this.item(title);
    await item.hover();
    await item.locator('.destroy').click();
  }

  async selectFilter(filter: string): Promise<void> {
    const link = this.page.getByRole('link', { name: filter, exact: true });
    await link.click();
    await link.waitFor({ state: 'visible' });
    await this.page.locator('a.selected').filter({ hasText: filter }).waitFor();
  }

  async clearCompleted(): Promise<void> {
    await this.page.locator('.clear-completed').click();
  }

  async markAllComplete(): Promise<void> {
    await this.page.locator('.toggle-all').check();
  }

  async rename(current: string, next: string): Promise<void> {
    const item = this.item(current);
    await item.locator('label').dblclick();
    await item.locator('.edit').fill(next);
    await item.locator('.edit').press('Enter');
  }

  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }

  get items() {
    return this.todoList;
  }

  get visibleItems() {
    return this.page.locator('.todo-list li:visible');
  }

  get completedItems() {
    return this.page.locator('.todo-list li.completed');
  }

  get counter() {
    return this.page.locator('.todo-count');
  }
}
