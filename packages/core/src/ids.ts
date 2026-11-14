/** URL/file friendly slug: lower-case, words joined by '-'. */
export function slugify(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'unnamed';
}

/** Monotonic id generator for ids that only need to be unique within one run. */
export function createIdGenerator(prefix = ''): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}
