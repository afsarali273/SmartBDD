import type { Plan } from './types.js';

/** Plain-text plan: groups, then every node with its waits. */
export function renderPlanText(plan: Plan): string {
  const out: string[] = [`Plan: ${plan.nodes.length} scenario(s), ${plan.groups.size} group(s), workers=${plan.workers}`];
  for (const g of plan.groups.values()) {
    out.push(
      `  group ${g.name}: ${g.mode}${g.workers ? ` x${g.workers}` : ''}, ${g.members.length} member(s)` +
        `${g.dependsOn.length ? `, after ${g.dependsOn.join(', ')}${g.onDependencyFailure === 'run' ? ' (soft)' : ''}` : ''}` +
        `${g.locks.length ? `, locks ${g.locks.join(', ')}` : ''}${g.priority ? `, priority ${g.priority}` : ''}`,
    );
  }
  out.push('');
  for (const n of plan.nodes) {
    const flags = [
      n.groups.length ? `[${n.groups.join(',')}]` : '',
      n.priority ? `p${n.priority}` : '',
      n.exclusive ? 'exclusive' : '',
      n.locks.length ? `locks:${n.locks.join(',')}` : '',
      n.pulledInBy ? '(dependency)' : '',
    ].filter(Boolean);
    out.push(`  ${n.id}${flags.length ? `  ${flags.join(' ')}` : ''}`);
    for (const d of n.deps) out.push(`      <- ${d.target}${d.soft ? ' (soft)' : ''}`);
  }
  if (plan.errors.length) {
    out.push('', 'Errors:');
    for (const e of plan.errors) out.push(`  ${e.uri ? `${e.uri}:${e.line} ` : ''}${e.message}`);
  }
  return out.join('\n') + '\n';
}

const mid = (i: number) => `n${i}`;
const label = (s: string) => s.replace(/"/g, "'");

/** Mermaid flowchart: one subgraph per group, edges = dependencies (dashed = soft). Paste into any Markdown viewer. */
export function renderPlanMermaid(plan: Plan): string {
  const idx = new Map(plan.nodes.map((n, i) => [n.id, mid(i)]));
  const out = ['flowchart LR'];
  const inGroup = new Set<string>();
  for (const g of plan.groups.values()) {
    if (!g.members.length) continue;
    out.push(`  subgraph ${label(g.name).replace(/\W/g, '_')}["${label(g.name)} (${g.mode})"]`);
    for (const m of g.members) {
      if (inGroup.has(m)) continue; // a node can only sit in one subgraph
      inGroup.add(m);
      const n = plan.byId.get(m)!;
      out.push(`    ${idx.get(m)}["${label(n.scenario.name)}"]`);
    }
    out.push('  end');
  }
  for (const n of plan.nodes) if (!inGroup.has(n.id)) out.push(`  ${idx.get(n.id)}["${label(n.scenario.name)}"]`);
  for (const n of plan.nodes) {
    for (const d of n.deps) out.push(`  ${idx.get(d.target)} ${d.soft ? '-.->' : '-->'} ${idx.get(n.id)}`);
  }
  return out.join('\n') + '\n';
}

/** JSON-friendly view (no ScenarioInstance objects). */
export function planToJSON(plan: Plan) {
  return {
    workers: plan.workers,
    groups: [...plan.groups.values()],
    nodes: plan.nodes.map((n) => ({
      id: n.id,
      name: n.scenario.name,
      uri: n.scenario.uri,
      line: n.scenario.line,
      groups: n.groups,
      deps: n.deps,
      locks: n.locks,
      priority: n.priority,
      exclusive: n.exclusive,
      ...(n.pulledInBy ? { pulledInBy: n.pulledInBy } : {}),
    })),
    errors: plan.errors,
  };
}
