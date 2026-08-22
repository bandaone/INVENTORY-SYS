import { expect, test } from '@playwright/test'

test('guides a customer through tenant, store, plan, and owner access', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    const expectedLocalDatabaseError = text.includes('[Registration plans]') && text.includes('ENOTFOUND postgres')
    if (message.type() === 'error' && !expectedLocalDatabaseError) browserErrors.push(text)
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.route('**/api/register/tenant', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const payload = route.request().postDataJSON()
    expect(payload).toMatchObject({
      business_name: 'Northstar Retail',
      owner_name: 'Mwamba Phiri',
      location_name: 'Arcades Store',
      tier: 'growth',
      email: 'mwamba@northstar.test',
    })
    expect(payload.request_id).toMatch(/^[0-9a-f-]{36}$/i)
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, tenantId: 'test-tenant', redirect: '/setup' }) })
  })
  await page.route('**/setup**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<main><h1>Setup handoff complete</h1></main>' })
  })

  await page.goto('/register')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Enter your registered or trading name.')).toBeVisible()

  await page.getByLabel('Business or trading name').fill('Northstar Retail')
  await page.getByLabel('Account owner').fill('Mwamba Phiri')
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByLabel('Store name').fill('Arcades Store')
  await page.getByLabel('Business phone').fill('+260 977 123 456')
  await page.getByLabel('Physical address').fill('Arcades Shopping Centre, Lusaka')
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByRole('radio', { name: /Growth/ }).check()
  await expect(page.getByText('3 stores · 10 users')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByLabel('Owner email').fill('mwamba@northstar.test')
  await page.getByLabel('4-digit security PIN').fill('4826')
  await page.getByLabel('Confirm PIN').fill('4826')
  await page.screenshot({ path: '/tmp/retail-os-registration-review.png', fullPage: true })
  await page.getByRole('button', { name: 'Start 7-day trial' }).click()

  await expect(page.getByRole('heading', { name: 'Workspace created securely' })).toBeVisible()
  await expect(page.getByText('Tenant isolated')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Setup handoff complete' })).toBeVisible()
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
  expect(browserErrors).toEqual([])
})

test('registration remains directional on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/register')
  await expect(page.getByRole('heading', { name: 'Business', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Registration steps' })).toBeVisible()
  await expect(page.getByText('Workspace outline')).toBeVisible()
  await page.screenshot({ path: '/tmp/retail-os-registration-mobile.png', fullPage: true })
})
