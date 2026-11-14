import { parse as parseTagExpressionRaw } from '@cucumber/tag-expressions';
import type { Tag } from './model.js';

/**
 * Split a tag into key/value.
 * Separators: the FIRST ':' or '=' after the '@'.
 */
export function parseTag(name: string, line?: number): Tag {
  const raw = name.startsWith('@') ? name.slice(1) : name;
  const sep = raw.search(/[:=]/);
  const tag: Tag = { name: name.startsWith('@') ? name : `@${name}`, key: raw };
  if (sep > 0) {
    tag.key = raw.slice(0, sep);
    tag.value = raw.slice(sep + 1);
  }
  if (line !== undefined) tag.line = line;
  return tag;
}

/** Key/value map of tags. Key-only tags map to 'true'. Later tags override earlier ones. */
export function tagsToMeta(tags: readonly Tag[]): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const t of tags) meta[t.key] = t.value ?? 'true';
  return meta;
}

export type TagPredicate = (tagNames: readonly string[]) => boolean;

/**
 * Compile a Cucumber tag expression ("@smoke and not @wip").
 * Empty / undefined expression matches everything.
 * Throws a readable error for invalid expressions.
 */
export function compileTagExpression(expression: string | undefined): TagPredicate {
  if (!expression || !expression.trim()) return () => true;
  try {
    const node = parseTagExpressionRaw(expression);
    return (tagNames) => node.evaluate([...tagNames]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid tag expression "${expression}": ${msg}`);
  }
}
