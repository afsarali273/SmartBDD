/**
 * Scheduler (Phase 3): runs a Plan with bounded concurrency.
 *
 * A node is READY when every dependency has finished. Among ready nodes it starts the lowest
 * `priority` first (ties: plan order), as long as:
 *   - a worker slot is free (plan.workers),
 *   - none of its locks is held (`@lock`, group `locks`),
 *   - its groups have capacity (serial = 1, parallel = `workers` or unlimited),
 *   - exclusivity holds (an exclusive node starts only when nothing runs, and blocks others).
 * A ready node whose HARD dependency did not pass is skipped ("dependency failed: <id> (<status>)").
 * Retry groups: a dependency on a member counts as done only when the member's retry group has SETTLED
 * (no further group retry), unless the dependent is in that same group.
 *
 * In-process concurrency (async). Worker processes (true isolation) plug in later behind `runNode`.
 */
import type { Plan, PlanNode, Status } from '@bddx/core';

export interface SchedulerCallbacks {
  /** Run the node on worker `workerId` ('w1'…). Must resolve to the node's status (never reject). */
  runNode(node: PlanNode, workerId: string): Promise<Status>;
  /** Mark the node skipped without running it. */
  skipNode(node: PlanNode, reason: string): Promise<void>;
  /** A reason to stop starting new nodes (fail-fast, fatal BeforeAll), or undefined. */
  stopReason(): string | undefined;
  /**
   * Retry groups (plan.groups[g].retry > 0): called when every member has a result. Return member ids to run again
   * (group retry), or undefined to settle the group. Dependents of members wait until their groups settle.
   */
  settleGroup?(group: string): Promise<string[] | undefined>;
}

export interface ScheduleOptions {
  /** Dry run: dependency results do not cause skips. */
  ignoreDependencyResults?: boolean;
}

export async function schedule(plan: Plan, cb: SchedulerCallbacks, options: ScheduleOptions = {}): Promise<Map<string, Status>> {
  const results = new Map<string, Status>();
  const pending = new Set(plan.nodes.map((n) => n.id));
  const running = new Map<string, Promise<void>>();
  const heldLocks = new Map<string, number>();
  const groupRunning = new Map<string, number>();
  const freeSlots = Array.from({ length: plan.workers }, (_, i) => `w${i + 1}`);
  let exclusiveRunning = false;
  const retryGroups = new Set([...plan.groups.values()].filter((g) => g.retry > 0).map((g) => g.name));
  const settled = new Set<string>();
  const toCheck: string[] = [];

  const targetSettled = (target: string, dependent: PlanNode) =>
    plan.byId.get(target)!.groups.every((g) => !retryGroups.has(g) || settled.has(g) || dependent.groups.includes(g));
  const depsDone = (n: PlanNode) => n.deps.every((d) => results.has(d.target) && targetSettled(d.target, n));
  const groupCap = (g: string) => {
    const pg = plan.groups.get(g);
    if (!pg) return Infinity;
    if (pg.mode === 'serial') return 1;
    return pg.workers ?? Infinity;
  };
  const canStart = (n: PlanNode) => {
    if (exclusiveRunning) return false;
    if (n.exclusive && running.size > 0) return false;
    if (n.locks.some((l) => (heldLocks.get(l) ?? 0) > 0)) return false;
    return n.groups.every((g) => (groupRunning.get(g) ?? 0) < groupCap(g));
  };

  const start = (n: PlanNode) => {
    const slot = freeSlots.shift()!;
    pending.delete(n.id);
    for (const l of n.locks) heldLocks.set(l, (heldLocks.get(l) ?? 0) + 1);
    for (const g of n.groups) groupRunning.set(g, (groupRunning.get(g) ?? 0) + 1);
    if (n.exclusive) exclusiveRunning = true;
    const p = cb
      .runNode(n, slot)
      .catch((): Status => 'failed')
      .then((status) => {
        results.set(n.id, status);
        for (const l of n.locks) heldLocks.set(l, heldLocks.get(l)! - 1);
        for (const g of n.groups) groupRunning.set(g, groupRunning.get(g)! - 1);
        if (n.exclusive) exclusiveRunning = false;
        freeSlots.push(slot);
        freeSlots.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
        running.delete(n.id);
        queueGroupChecks(n);
      });
    running.set(n.id, p);
  };

  const queueGroupChecks = (n: PlanNode) => {
    for (const g of n.groups) {
      if (!retryGroups.has(g) || settled.has(g) || toCheck.includes(g)) continue;
      if (plan.groups.get(g)!.members.every((id) => results.has(id))) toCheck.push(g);
    }
  };

  const checkGroups = async (): Promise<boolean> => {
    let changed = false;
    while (toCheck.length) {
      const g = toCheck.shift()!;
      const rerun = cb.settleGroup ? await cb.settleGroup(g) : undefined;
      if (rerun?.length) {
        for (const id of rerun) {
          results.delete(id);
          pending.add(id);
        }
      } else settled.add(g);
      changed = true;
    }
    return changed;
  };

  for (;;) {
    // 0. Retry groups whose members all finished: settle or re-run.
    await checkGroups();
    // 1. Skip what can never run (stop reason, failed hard dependency). Repeat: skips cascade.
    let changed = true;
    while (changed) {
      changed = false;
      if (await checkGroups()) changed = true;
      for (const n of plan.nodes) {
        if (!pending.has(n.id) || !depsDone(n)) continue;
        const stop = cb.stopReason();
        const failed = options.ignoreDependencyResults
          ? undefined
          : n.deps.find((d) => !d.soft && results.get(d.target) !== 'passed');
        if (stop || failed) {
          pending.delete(n.id);
          results.set(n.id, 'skipped');
          await cb.skipNode(n, stop ?? `dependency failed: ${failed!.target} (${results.get(failed!.target)})`);
          queueGroupChecks(n);
          changed = true;
        }
      }
    }

    // 2. Start ready nodes by priority, then plan order.
    const ready = plan.nodes
      .filter((n) => pending.has(n.id) && depsDone(n))
      .sort((a, b) => a.priority - b.priority || a.order - b.order);
    for (const n of ready) {
      if (!freeSlots.length) break;
      if (canStart(n)) start(n);
    }

    if (!running.size) {
      if (toCheck.length) continue;
      if (!pending.size) break;
      // Nothing running, nothing startable: only possible with an unvalidated cycle. Never hang.
      for (const id of [...pending]) {
        pending.delete(id);
        results.set(id, 'skipped');
        await cb.skipNode(plan.byId.get(id)!, 'not schedulable (dependency cycle?)');
      }
      break;
    }
    await Promise.race(running.values());
  }
  return results;
}
