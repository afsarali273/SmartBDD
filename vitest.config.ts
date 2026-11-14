import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (pkg: string) => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

// Tests run against the TypeScript sources directly, so `npm test` needs no build.
export default defineConfig({
  resolve: {
    alias: {
      '@bddx/core': src('core'),
      '@bddx/runtime': src('runtime'),
      '@bddx/reporters': src('reporters'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'conformance/**/*.test.ts'],
  },
});
