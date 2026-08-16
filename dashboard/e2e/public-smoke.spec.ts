import { expect, test } from '@playwright/test'

test('public auth surfaces render and protected routes fail closed', async ({ page, request }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByLabel('Email Address')).toBeVisible()
  await expect(page.getByRole('group', { name: '4-Digit Security PIN' })).toBeVisible()
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)

  await page.goto('/register')
  await expect(page.getByRole('heading', { name: 'Business', exact: true })).toBeVisible()
  await expect(page.getByText('Workspace outline')).toBeVisible()
  await page.getByLabel('Business or trading name').fill('Smoke Test Retail')
  await page.getByLabel('Account owner').fill('Smoke Test Owner')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'First store', exact: true })).toBeVisible()
  await page.getByLabel('Business phone').fill('0977123456')
  await page.getByLabel('Physical address').fill('Plot 42, Cairo Road, Lusaka')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: /Boutique Starter/ })).toBeChecked()
  await expect(page.getByText('1 store · 3 users')).toBeVisible()
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/retail-os-register.png', fullPage: true })

  await page.goto('/')
  await expect(page).toHaveURL(/\/login(?:\?|$)/)

  const unauthorizedCron = await request.get('/api/cron/metrics-rollup')
  expect(unauthorizedCron.status()).toBe(401)

  const metricsCron = await request.get('/api/cron/metrics-rollup', {
    headers: { authorization: 'Bearer validation-only' },
  })
  expect(metricsCron.status()).toBe(200)
  expect((await metricsCron.json()).ok).toBe(true)

  const lifecycleCron = await request.get('/api/cron/trial-check', {
    headers: { authorization: 'Bearer validation-only' },
  })
  expect(lifecycleCron.status()).toBe(200)
  expect((await lifecycleCron.json()).ok).toBe(true)

  expect(browserErrors).toEqual([])
})
