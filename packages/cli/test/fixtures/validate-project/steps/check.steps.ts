import { Before, Given } from '@bddx/runtime';

Given('duplicated', () => {});
Given('duplicated', () => {});
Given('never used', () => {});

Before({ tags: '@never' }, () => {});
