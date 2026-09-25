import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['electron/test-setup.ts'],
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node'
  }
})
