import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.{test,spec}.ts',
        'src/**/index.ts',
        // Test fixture minters (real crypto helpers) — exercised by tests but
        // not production surface; kept under src/ only so NodeNext relative
        // imports resolve.
        'src/**/__fixtures__/**',
        // Default no-op publisher transport is an interface seam whose real
        // implementation is a human-gated VPS ops step (rsync + caddy reload).
        // It deliberately does nothing but log; excluded so the coverage floor
        // measures real verification + supervision logic, not the documented stub.
        'src/ingest/publisher-transport-noop.ts',
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
});
