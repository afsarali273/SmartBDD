import type { Locator, Page } from 'playwright';

export class SauceDemoLoginPage {
  constructor(private readonly page: Page) {}

  private get usernameInput() {
    return this.page.getByTestId('username');
  }

  private get passwordInput() {
    return this.page.getByTestId('password');
  }

  private get loginButton() {
    return this.page.getByTestId('login-button');
  }

  async open(baseUrl: string): Promise<void> {
    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  }

  async login(username: string, password: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  get error() {
    return this.page.getByTestId('error');
  }

  async logout(): Promise<void> {
    await this.page.locator('#react-burger-menu-btn').click();
    await this.page.locator('#logout_sidebar_link').click();
  }

  async waitUntilVisible(): Promise<void> {
    await this.loginButton.waitFor({ state: 'visible' });
  }
}

export class SauceDemoInventoryPage {
  constructor(private readonly page: Page) {}

  private get inventoryList() {
    return this.page.getByTestId('inventory-list');
  }

  private get productSort() {
    return this.page.getByTestId('product-sort-container');
  }

  private get cartLink() {
    return this.page.getByTestId('shopping-cart-link');
  }

  private get cartBadge() {
    return this.page.getByTestId('shopping-cart-badge');
  }

  async waitUntilVisible(): Promise<void> {
    await this.inventoryList.waitFor();
  }

  product(product: string): Locator {
    return this.page.getByTestId('inventory-item').filter({ hasText: product });
  }

  get items() {
    return this.page.getByTestId('inventory-item');
  }

  get firstName() {
    return this.page.getByTestId('inventory-item-name').first();
  }

  get badge() {
    return this.cartBadge;
  }

  async sortBy(label: string): Promise<void> {
    await this.productSort.selectOption({ label });
  }

  async openProduct(product: string): Promise<void> {
    await this.product(product).locator('[data-test="inventory-item-name"]').click();
    await this.page.waitForURL(/inventory-item\.html\?id=/);
    await new SauceDemoProductPage(this.page).waitUntilVisible();
  }

  async addProduct(product: string): Promise<void> {
    await this.product(product).getByRole('button', { name: 'Add to cart' }).click();
  }

  async addProducts(products: string[]): Promise<void> {
    for (const product of products) await this.addProduct(product);
  }

  async openCart(): Promise<SauceDemoCartPage> {
    await this.cartLink.click();
    return new SauceDemoCartPage(this.page);
  }
}

export class SauceDemoProductPage {
  constructor(private readonly page: Page) {}

  async waitUntilVisible(): Promise<void> {
    await this.page.getByTestId('inventory-item-name').first().waitFor();
  }

  productId(): string | null {
    return new URL(this.page.url()).searchParams.get('id');
  }

  pathname(): string {
    return new URL(this.page.url()).pathname;
  }
}

export class SauceDemoCartPage {
  constructor(private readonly page: Page) {}

  async productNames(): Promise<string[]> {
    return this.page.getByTestId('inventory-item-name').allInnerTexts();
  }
}
