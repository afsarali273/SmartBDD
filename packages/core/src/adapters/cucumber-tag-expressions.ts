/**
 * ADAPTER: tag expressions via @cucumber/tag-expressions (the only file importing it).
 * Syntax: `@a and (@b or not @c)`.
 */
import { parse } from '@cucumber/tag-expressions';
import type { TagExpressionEngine } from '../ports.js';

export const cucumberTagExpressions: TagExpressionEngine = {
  name: 'tag-expressions (cucumber)',
  compile(expression) {
    const node = parse(expression);
    return (tagNames) => node.evaluate([...tagNames]);
  },
};
