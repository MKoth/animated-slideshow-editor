import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    define: {
      global: 'globalThis',
    },
    plugins: [react()],
    server: {
      port: 5173,
      fs: {
        allow: ['..'],
      },
      proxy: {
        '/health': env.VITE_BACKEND_URL || 'http://localhost:8000',
        '/ping': env.VITE_BACKEND_URL || 'http://localhost:8000',
        '/api': env.VITE_BACKEND_URL || 'http://localhost:8000',
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/tests/setup.ts'],
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  }
})
