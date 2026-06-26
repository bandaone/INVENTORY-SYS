import { expect, test, type Page } from '@playwright/test';

function uniqueTenant(prefix: string) {
  const stamp = Date.now().toString(36);
  return {
    businessName: `${prefix} ${stamp}`,
    ownerName: `${prefix} Owner`,
    phone: `+26097${Math.floor(Math.random() * 9000000 + 1000000)}`,
    email: `${prefix.toLowerCase().replace(/\s+/g, '')}${stamp}@example.com`,
    address: `${prefix} Address ${stamp}`,
  };
}

async function registerTenant(page: Page, tenant: ReturnType<typeof uniqueTenant>) {
  await page.goto('/register');
  await page.getByLabel('Business Name').fill(tenant.businessName);
  await page.getByLabel('Owner Full Name').fill(tenant.ownerName);
  await page.getByLabel('Phone Number (for SMS PIN)').fill(tenant.phone);
  await page.getByLabel('Email Address').fill(tenant.email);
  await page.getByLabel('Physical Store Address').fill(tenant.address);
  await page.getByLabel('Select Plan (Free 7-day Trial)').selectOption('boutique_starter');
  await page.getByRole('button', { name: /start 7-day free trial/i }).click();

  await expect(page.getByText('Store Created!')).toBeVisible();
}

async function loginTenant(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('4-Digit PIN').fill('1234');
  await page.getByRole('button', { name: /secure login/i }).click();

  await expect(page).toHaveURL(/\/$/);
}

test.describe('Tenant isolation and retail flow', () => {
  test('onboards a tenant, sells from POS, and keeps a second tenant clean', async ({ browser }) => {
    const tenantA = uniqueTenant('Alpha Retail');
    const tenantB = uniqueTenant('Bravo Retail');

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    await pageA.goto('/');
    await expect(pageA).toHaveURL(/\/login/);

    await registerTenant(pageA, tenantA);
    await loginTenant(pageA, tenantA.email);

    await expect(pageA.getByText(tenantA.businessName)).toBeVisible();
    await expect(pageA.getByText('No transactions yet.')).toBeVisible();

    await pageA.goto('/pos');
    await pageA.getByRole('button', { name: 'Cash Sale' }).click();

    const receiptText = await pageA.getByText(/Receipt:/).textContent();
    expect(receiptText).toContain('Receipt:');
    const receipt = receiptText?.replace(/^Receipt:\s*/, '').trim();
    expect(receipt).toBeTruthy();

    await pageA.goto('/stocktake');
    await expect(pageA.getByText('No stocktake sessions found in database.')).toBeVisible();

    await pageA.goto('/inventory');
    await expect(pageA.getByRole('heading', { name: 'Inventory Matrix' })).toBeVisible();

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    await registerTenant(pageB, tenantB);
    await loginTenant(pageB, tenantB.email);

    await expect(pageB.getByText(tenantB.businessName)).toBeVisible();
    await expect(pageB.getByText('No transactions yet.')).toBeVisible();
    await expect(pageB.getByText(receipt || '')).toHaveCount(0);

    await contextA.close();
    await contextB.close();
  });
});
