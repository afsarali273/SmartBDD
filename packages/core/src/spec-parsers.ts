import { cucumberGherkinParser } from './adapters/cucumber-gherkin.js';
import type { ParsedSpec } from './model.js';
import type { SpecParseOptions, SpecParser } from './ports.js';

/**
 * Spec parser registry. Gherkin is registered by default; new formats (e.g. the planned
 * code-linked Markdown specs) register here and are picked by file suffix.
 */
const parsers: SpecParser[] = [cucumberGherkinParser];

export function registerSpecParser(parser: SpecParser): void {
  const i = parsers.findIndex((p) => p.name === parser.name);
  if (i >= 0) parsers.splice(i, 1);
  parsers.unshift(parser);
}

export function specParsers(): readonly SpecParser[] {
  return parsers;
}

/** The parser whose LONGEST extension matches the uri, or undefined. */
export function specParserFor(uri: string): SpecParser | undefined {
  let best: { p: SpecParser; len: number } | undefined;
  for (const p of parsers) {
    for (const ext of p.extensions) {
      if (uri.endsWith(ext) && (!best || ext.length > best.len)) best = { p, len: ext.length };
    }
  }
  return best?.p;
}

/** Glob suffixes for every registered format, e.g. `{feature,feature.md}`. */
export function specFileGlobSuffix(): string {
  const exts = [...new Set(parsers.flatMap((p) => p.extensions.map((e) => e.replace(/^\./, ''))))];
  return exts.length === 1 ? exts[0]! : `{${exts.join(',')}}`;
}

/** Parse any supported spec file. Unknown suffix -> a parse error, not an exception. */
export async function parseSpecFile(source: string, uri: string, options: SpecParseOptions = {}): Promise<ParsedSpec> {
  const parser = specParserFor(uri);
  if (!parser) {
    return {
      uri,
      scenarios: [],
      errors: [{ uri, message: `No spec parser for "${uri}". Known suffixes: ${parsers.flatMap((p) => p.extensions).join(', ')}` }],
    };
  }
  return parser.parse(source, uri, options);
}
