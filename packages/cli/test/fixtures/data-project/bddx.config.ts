import { defineConfig } from '@bddx/cli';

export default defineConfig({
  dataDir: 'data',
  reporters: [['console', { colors: false }]],
  profiles: { ci: {} },
});
