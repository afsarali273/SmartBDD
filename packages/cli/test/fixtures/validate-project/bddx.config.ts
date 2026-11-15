import { defineConfig } from '@bddx/cli';

export default defineConfig({
  features: 'features/**/*.feature',
  steps: 'steps/**/*.ts',
  reporters: ['console'],
  validation: { allowedTagKeys: ['known'] },
});
