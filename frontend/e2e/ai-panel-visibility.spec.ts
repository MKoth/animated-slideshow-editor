import { test, expect } from '@playwright/test'

// Regression test: the AI panel and AI Settings dialog must appear inside the
// viewport when opened — mounting in the DOM below the fold is not "open".
async function inViewport(page: Parameters<Parameters<typeof test>[1]>[0]['page'], testId: string) {
  return page.getByTestId(testId).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  })
}

test('AI Assistant panel opens inside the viewport', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

  await page.goto('/')
  await page.getByRole('button', { name: 'AI', exact: true }).click()
  await page.getByRole('menuitem', { name: 'AI Assistant' }).click()
  await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: 10_000 })

  const geometry = await inViewport(page, 'ai-panel')
  expect(geometry.width, 'panel has width').toBeGreaterThan(0)
  expect(geometry.height, 'panel has height').toBeGreaterThan(0)
  expect(geometry.x, 'panel left edge inside viewport').toBeGreaterThanOrEqual(0)
  expect(geometry.x + geometry.width, 'panel right edge inside viewport').toBeLessThanOrEqual(
    geometry.viewport.width,
  )
  expect(geometry.y, 'panel top edge inside viewport').toBeGreaterThanOrEqual(0)
  expect(geometry.y, 'panel top edge reachable without scrolling').toBeLessThan(
    geometry.viewport.height,
  )
  expect(consoleErrors, 'console errors after opening AI panel').toEqual([])
})

test('AI Settings dialog opens inside the viewport', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

  await page.goto('/')
  await page.getByRole('button', { name: 'AI', exact: true }).click()
  await page.getByRole('menuitem', { name: 'AI Settings' }).click()
  await expect(page.getByTestId('ai-settings-dialog')).toBeVisible({ timeout: 10_000 })

  const geometry = await inViewport(page, 'ai-settings-dialog')
  expect(geometry.width, 'dialog has width').toBeGreaterThan(0)
  expect(geometry.height, 'dialog has height').toBeGreaterThan(0)
  expect(geometry.x, 'dialog left edge inside viewport').toBeGreaterThanOrEqual(0)
  expect(geometry.x + geometry.width, 'dialog right edge inside viewport').toBeLessThanOrEqual(
    geometry.viewport.width,
  )
  expect(geometry.y, 'dialog top edge inside viewport').toBeGreaterThanOrEqual(0)
  expect(geometry.y, 'dialog top edge reachable without scrolling').toBeLessThan(
    geometry.viewport.height,
  )
})
