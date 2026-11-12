import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: { name: 'dossier', include: ['plugins/dossier/tests/test_*.ts'], setupFiles: ['plugins/dossier/tests/setup.ts'] },
      },
      { extends: true, test: { name: 'plugins', include: ['plugins/*/tests/test_*.ts'], exclude: ['plugins/dossier/**', '**/node_modules/**'] } },
    ],
  },
})
