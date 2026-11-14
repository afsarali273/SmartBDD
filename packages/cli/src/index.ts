export { defineConfig, loadConfig, mergeOptions, UsageError, type BddxConfig, type BddxOptions } from './config.js';
export { runBddx, prepareRun, type PreparedRun, discoverSpecs, discoverSupportFiles, registerTypeScriptLoader, type RunRequest, type RunOutcome } from './run.js';
export { main } from './main.js';
