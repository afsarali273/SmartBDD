import {
  AstBuilder,
  compile,
  GherkinClassicTokenMatcher,
  GherkinInMarkdownTokenMatcher,
  Parser,
} from '@cucumber/gherkin';
import {
  IdGenerator,
  PickleStepType,
  type Background,
  type GherkinDocument,
  type Pickle,
  type Rule,
  type Scenario,
  type Tag as GherkinTag,
} from '@cucumber/messages';
import { slugify } from './ids.js';
import type {
  ExampleRef,
  FeatureInfo,
  ParsedSpec,
  ParseErrorInfo,
  RuleRef,
  ScenarioInstance,
  StepInstance,
  StepKeywordType,
  Tag,
} from './model.js';
import { parseTag, tagsToMeta } from './tags.js';

export interface ParseOptions {
  /** Default Gherkin language when the file has no `# language:` header. Default 'en'. */
  language?: string;
  /** Force a format. Default: '.md' files are Markdown-with-Gherkin (MDG), everything else plain Gherkin. */
  format?: 'gherkin' | 'markdown';
}

interface StepAstInfo {
  line: number;
  keyword: string;
  fromBackground: boolean;
}

interface ScenarioAstInfo {
  scenario: Scenario;
  rule?: RuleRef;
}

interface RowAstInfo {
  example: ExampleRef;
}

/** Index of AST nodes by id, so pickles can be mapped back to lines/keywords/rules. */
interface AstIndex {
  steps: Map<string, StepAstInfo>;
  scenarios: Map<string, ScenarioAstInfo>;
  rows: Map<string, RowAstInfo>;
  tagLines: Map<string, number>;
}

function indexTags(tags: readonly GherkinTag[], index: AstIndex) {
  for (const t of tags) index.tagLines.set(t.id, t.location.line);
}

function indexBackground(bg: Background, index: AstIndex) {
  for (const s of bg.steps) {
    index.steps.set(s.id, { line: s.location.line, keyword: s.keyword, fromBackground: true });
  }
}

function indexScenario(sc: Scenario, rule: RuleRef | undefined, index: AstIndex) {
  index.scenarios.set(sc.id, rule ? { scenario: sc, rule } : { scenario: sc });
  indexTags(sc.tags, index);
  for (const s of sc.steps) {
    index.steps.set(s.id, { line: s.location.line, keyword: s.keyword, fromBackground: false });
  }
  let rowIndex = 0;
  for (const ex of sc.examples) {
    indexTags(ex.tags, index);
    const header = ex.tableHeader?.cells.map((c) => c.value) ?? [];
    for (const row of ex.tableBody) {
      rowIndex += 1;
      const values: Record<string, string> = {};
      row.cells.forEach((c, i) => {
        const key = header[i];
        if (key !== undefined) values[key] = c.value;
      });
      index.rows.set(row.id, {
        example: { name: ex.name, index: rowIndex, line: row.location.line, values },
      });
    }
  }
}

function buildIndex(doc: GherkinDocument): AstIndex {
  const index: AstIndex = { steps: new Map(), scenarios: new Map(), rows: new Map(), tagLines: new Map() };
  const feature = doc.feature;
  if (!feature) return index;
  indexTags(feature.tags, index);
  for (const child of feature.children) {
    if (child.background) indexBackground(child.background, index);
    if (child.scenario) indexScenario(child.scenario, undefined, index);
    if (child.rule) indexRule(child.rule, index);
  }
  return index;
}

function indexRule(rule: Rule, index: AstIndex) {
  indexTags(rule.tags, index);
  const ref: RuleRef = {
    id: rule.id,
    name: rule.name,
    line: rule.location.line,
    tags: rule.tags.map((t) => parseTag(t.name, t.location.line)),
  };
  for (const child of rule.children) {
    if (child.background) indexBackground(child.background, index);
    if (child.scenario) indexScenario(child.scenario, ref, index);
  }
}

function toKeywordType(t: PickleStepType | undefined): StepKeywordType {
  switch (t) {
    case PickleStepType.CONTEXT:
      return 'context';
    case PickleStepType.ACTION:
      return 'action';
    case PickleStepType.OUTCOME:
      return 'outcome';
    default:
      return 'unknown';
  }
}

function dedupeTags(tags: Tag[]): Tag[] {
  const seen = new Set<string>();
  const out: Tag[] = [];
  for (const t of tags) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    out.push(t);
  }
  return out;
}

function pickleToInstance(pickle: Pickle, feature: FeatureInfo, index: AstIndex): ScenarioInstance {
  const [scenarioNodeId, rowNodeId] = pickle.astNodeIds;
  const scInfo = scenarioNodeId ? index.scenarios.get(scenarioNodeId) : undefined;
  const row = rowNodeId ? index.rows.get(rowNodeId) : undefined;

  const tags = dedupeTags(pickle.tags.map((t) => parseTag(t.name, index.tagLines.get(t.astNodeId))));

  const steps: StepInstance[] = pickle.steps.map((ps) => {
    const ast = index.steps.get(ps.astNodeIds[0] ?? '');
    const step: StepInstance = {
      id: ps.id,
      keyword: ast?.keyword ?? '* ',
      keywordType: toKeywordType(ps.type),
      text: ps.text,
      line: ast?.line ?? 0,
      fromBackground: ast?.fromBackground ?? false,
    };
    if (ps.argument?.dataTable) {
      step.argument = { kind: 'dataTable', rows: ps.argument.dataTable.rows.map((r) => r.cells.map((c) => c.value)) };
    } else if (ps.argument?.docString) {
      const ds = ps.argument.docString;
      step.argument = { kind: 'docString', content: ds.content, ...(ds.mediaType ? { mediaType: ds.mediaType } : {}) };
    }
    return step;
  });

  const instance: ScenarioInstance = {
    id: '', // assigned later, needs all siblings for collision handling
    pickleId: pickle.id,
    name: pickle.name,
    description: scInfo?.scenario.description.trim() ?? '',
    uri: pickle.uri,
    line: row?.example.line ?? scInfo?.scenario.location.line ?? pickle.location?.line ?? 0,
    feature,
    tags,
    meta: tagsToMeta(tags),
    steps,
  };
  if (scInfo?.rule) instance.rule = scInfo.rule;
  if (row) instance.example = row.example;
  return instance;
}

function assignStableIds(instances: ScenarioInstance[]): void {
  const used = new Map<string, number>();
  for (const inst of instances) {
    const explicit = inst.meta['id'];
    const base = explicit && explicit !== 'true' ? explicit : `${inst.uri}::${slugify(inst.name)}`;
    let id = inst.example ? `${base}[${inst.example.index}]` : base;
    if (used.has(id)) id = `${id}@${inst.line}`;
    used.set(id, (used.get(id) ?? 0) + 1);
    inst.id = id;
  }
}

/**
 * Parse one spec file into executable ScenarioInstances.
 * Never throws for syntax errors: they are returned in `errors` with line numbers.
 */
export function parseSpec(source: string, uri: string, options: ParseOptions = {}): ParsedSpec {
  const language = options.language ?? 'en';
  const format = options.format ?? (uri.endsWith('.md') ? 'markdown' : 'gherkin');
  const newId = IdGenerator.incrementing();
  const matcher =
    format === 'markdown' ? new GherkinInMarkdownTokenMatcher(language) : new GherkinClassicTokenMatcher(language);
  const parser = new Parser(new AstBuilder(newId), matcher);

  let doc: GherkinDocument;
  try {
    doc = parser.parse(source);
  } catch (err) {
    return { uri, scenarios: [], errors: toParseErrors(err, uri) };
  }
  doc = { ...doc, uri };
  if (!doc.feature) return { uri, scenarios: [], errors: [] };

  const f = doc.feature;
  const feature: FeatureInfo = {
    uri,
    name: f.name,
    description: f.description.trim(),
    language: f.language,
    line: f.location.line,
    tags: f.tags.map((t) => parseTag(t.name, t.location.line)),
  };

  const index = buildIndex(doc);
  const pickles = compile(doc, uri, newId);
  const scenarios = pickles.map((p) => pickleToInstance(p, feature, index));
  assignStableIds(scenarios);
  return { uri, feature, scenarios, errors: [] };
}

function toParseErrors(err: unknown, uri: string): ParseErrorInfo[] {
  const e = err as { errors?: Array<{ message: string; location?: { line: number; column?: number } }>; message?: string };
  const list = e.errors && e.errors.length ? e.errors : [{ message: e.message ?? String(err) }];
  return list.map((x) => {
    const info: ParseErrorInfo = { uri, message: x.message };
    const loc = (x as { location?: { line: number; column?: number } }).location;
    if (loc?.line !== undefined) info.line = loc.line;
    if (loc?.column !== undefined) info.column = loc.column;
    return info;
  });
}
