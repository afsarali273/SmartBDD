/**
 * CI sharding: split a plan into `count` shards that can run on separate machines.
 *
 * Scenarios that must run together stay together, because shards share nothing at runtime:
 *   - dependencies (hard or soft, including `group:` references): exports and ordering only work in one process;
 *   - members of the same named group (group hooks, serial/exclusive modes, group retry, group dependencies);
 *   - scenarios holding the same lock.
 * These "units" are packed onto shards largest-first (LPT) by estimated duration, which is within 4/3 of optimal.
 * The result is deterministic for the same plan and durations, so every CI machine computes the same split.
 */
import type { Plan } from './types.js';

export interface ShardSpec {
  /** 1-based. */
  index: number;
  count: number;
}

export interface ShardUnit {
  ids: string[];
  ms: number;
}

export interface ShardResult {
  /** Node ids that belong to the requested shard, in plan order. */
  ids: string[];
  /** Estimated milliseconds per shard (index 0 = shard 1). */
  loads: number[];
  /** Largest dependency/group/lock cluster, so users can see when one unit limits the speed-up. */
  largestUnit: ShardUnit;
  /** Scenarios without a recorded duration (estimated from the others). */
  unknownDurations: number;
}

export function parseShard(text: string): ShardSpec {
  const m = /^(\d+)\/(\d+)$/.exec(text.trim());
  const index = m ? Number(m[1]) : NaN;
  const count = m ? Number(m[2]) : NaN;
  if (!m || index < 1 || count < 1 || index > count) {
    throw new Error(`--shard expects i/n with 1 <= i <= n, e.g. 2/4 (got "${text}")`);
  }
  return { index, count };
}

export function shardPlan(plan: Plan, spec: ShardSpec, durations: ReadonlyMap<string, number> = new Map()): ShardResult {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    for (let c = x; c !== r; ) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); // smaller id is the root: deterministic
  };
  for (const n of plan.nodes) parent.set(n.id, n.id);

  const byKey = new Map<string, string>();
  const join = (key: string, id: string) => {
    const first = byKey.get(key);
    if (first === undefined) byKey.set(key, id);
    else union(first, id);
  };
  for (const n of plan.nodes) {
    for (const d of n.deps) if (parent.has(d.target)) union(n.id, d.target);
    for (const g of n.groups) join(`g:${g}`, n.id);
    for (const l of n.locks) join(`l:${l}`, n.id);
  }

  const known = [...durations.values()].filter((v) => v > 0).sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)]! : 1; // median, or equal weights without history
  let unknown = 0;
  const units = new Map<string, ShardUnit>();
  for (const n of plan.nodes) {
    const d = durations.get(n.id);
    if (!d || d <= 0) unknown++;
    const u = units.get(find(n.id)) ?? { ids: [], ms: 0 };
    u.ids.push(n.id);
    u.ms += d && d > 0 ? d : fallback;
    units.set(find(n.id), u);
  }

  const sorted = [...units.entries()].sort(([ka, a], [kb, b]) => b.ms - a.ms || (ka < kb ? -1 : 1));
  const loads: number[] = Array.from({ length: spec.count }, () => 0);
  const owner = new Map<string, number>();
  for (const [, u] of sorted) {
    let best = 0;
    for (let s = 1; s < loads.length; s++) if (loads[s]! < loads[best]!) best = s;
    loads[best]! += u.ms;
    for (const id of u.ids) owner.set(id, best);
  }
  return {
    ids: plan.nodes.filter((n) => owner.get(n.id) === spec.index - 1).map((n) => n.id),
    loads,
    largestUnit: sorted[0]?.[1] ?? { ids: [], ms: 0 },
    unknownDurations: unknown,
  };
}
