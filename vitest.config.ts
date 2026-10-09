import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['plugins/*/tests/test_*.ts'],
    testTimeout: 30_000,
  },
})
