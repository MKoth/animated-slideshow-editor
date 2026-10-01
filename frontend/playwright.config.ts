import { defineConfig } from '@playwright/test'

const backendUrl = process.env.PERF_BACKEND_URL ?? 'http://localhost:8000'
const production = process.env.PERF_APP_MODE === 'production'
const port = production ? 4173 : 5173
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: process.env.PERF_HEADLESS !== '0',
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 1,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
    actionTimeout: 10_000,
  },
  webServer: {
    command: production
      ? 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort'
      : 'npm run dev -- --host 127.0.0.1',
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { VITE_BACKEND_URL: backendUrl },
  },
})
