import { AfterAll, BeforeAll, BeforeFeature } from '@bddx/runtime';
import '@bddx/selenium'; // types for ctx.driver / ctx.open / inject('driver'); the plugin itself is in bddx.config.ts

BeforeAll((ctx) => {
  ctx.log.info('Starting Selenium showcase', { sauce: ctx.params['sauceBaseUrl'], browser: ctx.params['browser'] ?? 'chrome (config)' });
});

BeforeFeature((ctx) => ctx.log.debug(`Feature started: ${ctx.featureInfo.name}`));

AfterAll((ctx) => ctx.log.info('Selenium showcase finished'));
