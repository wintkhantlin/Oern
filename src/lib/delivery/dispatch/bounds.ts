import { deliveryNode, pickupNode } from "./route-eval.ts";
import type { Instance, Matrix, Plan } from "./types.ts";

/*
 * A lower bound on the planner objective, so a plan can be certified as "at
 * most X% above the best any plan could possibly do".
 *
 * Objective = Σ route scores + unservedPenalty × (orders left out). Every
 * score term is ≥ 0, so dropping all but `time` and `cost` keeps a valid bound.
 * For one route (depot → stops → depot):
 *
 *   time ≥ loadBaseMin + Σ arcs time(i,j) + Σ service      (flood slowdown ≥ 1, waiting ≥ 0)
 *   cost ≥ fixedCost/m + Σ arcs costPerKm·km(i,j)/m        (m = mmkPerScoreMinute)
 *
 * The routes together connect every served stop to the depot, so their arcs
 * cost at least a minimum spanning tree over the depot and those stops
 * (undirected edge = cheaper direction). A plan serving every servable order
 * pays that whole tree. A plan dropping some order pays, per order, at least
 * min(unservedPenalty, its service + the cheapest edge at each of its stops),
 * because each served stop has its own tree edge, plus the penalty swap for the
 * dropped one. Orders no truck can ever carry or reach in time pay the full
 * penalty. If anything is served one route runs, adding the cheapest route
 * overhead. Taking the smaller of "serve nothing" and the relaxed total keeps
 * the bound valid for every plan.
 *
 * It is deliberately simple and provably valid, not tight: it ignores shared
 * trips, windows and capacity. Treat the gap as an upper limit on waste.
 */

export type LowerBound = {
  value: number;
  /** What each part contributed, for display. */
  parts: {
    servePerOrder: number;
    routeOverhead: number;
    allUnservedCap: number;
  };
};

export function lowerBound(inst: Instance, matrix: Matrix): LowerBound {
  const p = inst.params;
  const n = matrix.n;
  const minCostPerKm = inst.trucks.length
    ? Math.min(...inst.trucks.map((t) => t.costPerKm))
    : 0;
  const minFixed = inst.trucks.length
    ? Math.min(...inst.trucks.map((t) => t.fixedCost))
    : 0;
  const arcCost = (i: number, j: number) => {
    const a = i * n + j;
    if (matrix.blocked?.[a]) return Number.POSITIVE_INFINITY;
    return matrix.time[a] + (minCostPerKm * matrix.km[a]) / p.mmkPerScoreMinute;
  };
  /** Undirected edge cost: the cheaper direction can only under-count. */
  const edge = (i: number, j: number) => Math.min(arcCost(i, j), arcCost(j, i));

  /** Cheapest travel time (minutes only, no money term) into node v. */
  const minIn = (v: number) => {
    let best = Number.POSITIVE_INFINITY;
    for (let u = 0; u < n; u++) {
      if (u === v || matrix.blocked?.[u * n + v]) continue;
      best = Math.min(best, matrix.time[u * n + v]);
    }
    return best;
  };

  // Orders that cannot be served by any plan pay the full penalty and are left
  // out of the tree. Capacity only worsens as stops are added, and a pickup
  // cannot be reached sooner than the cheapest arc into it.
  const nodesOf = (r: number) =>
    inst.requests[r].origin === "door"
      ? [pickupNode(r), deliveryNode(r)]
      : [deliveryNode(r)];
  let unservable = 0;
  const servable: number[] = [];
  inst.requests.forEach((request, r) => {
    const fitsSomeTruck = inst.trucks.some(
      (t) =>
        request.weightKg <= t.capKg * p.utilisation + 1e-9 &&
        request.volumeM3 <= t.capM3 * p.utilisation + 1e-9,
    );
    const earliestPickup =
      Math.max(p.shiftStart, inst.earliestDepart) +
      p.loadBaseMin +
      (request.origin === "door" ? minIn(pickupNode(r)) : 0);
    const windowOpen =
      request.origin === "depot" || earliestPickup <= request.windowEnd + 1e-9;
    if (fitsSomeTruck && windowOpen) servable.push(r);
    else unservable++;
  });
  const fixedPenalty = unservable * p.unservedPenalty;

  // Minimum spanning tree (Prim) over the depot and every servable stop.
  const nodes = [0, ...servable.flatMap(nodesOf)];
  const inTree = new Array<boolean>(nodes.length).fill(false);
  const reach = new Array<number>(nodes.length).fill(Number.POSITIVE_INFINITY);
  reach[0] = 0;
  let mst = 0;
  for (let step = 0; step < nodes.length; step++) {
    let pick = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!inTree[i] && (pick < 0 || reach[i] < reach[pick])) pick = i;
    if (pick < 0 || !Number.isFinite(reach[pick])) break;
    inTree[pick] = true;
    mst += reach[pick];
    for (let i = 0; i < nodes.length; i++)
      if (!inTree[i])
        reach[i] = Math.min(reach[i], edge(nodes[pick], nodes[i]));
  }

  // Every stop in a served tree has its own parent edge, which costs at least
  // the cheapest edge at that stop. That holds however many other orders are
  // dropped, so an order served adds at least its service plus those edges.
  const minEdge = (v: number) => {
    let best = Number.POSITIVE_INFINITY;
    for (const u of nodes) if (u !== v) best = Math.min(best, edge(u, v));
    return best;
  };
  let servePerOrder = 0;
  let serveAllService = 0;
  let extraIfDropping = servable.length ? Number.POSITIVE_INFINITY : 0;
  for (const r of servable) {
    const request = inst.requests[r];
    const service =
      request.deliveryService +
      (request.origin === "door" ? request.pickupService : 0);
    const give = nodesOf(r).reduce((sum, v) => sum + minEdge(v), 0);
    const part = Math.min(
      p.unservedPenalty,
      service + (Number.isFinite(give) ? give : 0),
    );
    servePerOrder += part;
    serveAllService += service;
    extraIfDropping = Math.min(extraIfDropping, p.unservedPenalty - part);
  }

  let minReturn = Number.POSITIVE_INFINITY;
  for (let u = 1; u < n; u++) minReturn = Math.min(minReturn, arcCost(u, 0));
  const routeOverhead = servable.length
    ? p.loadBaseMin + minFixed / p.mmkPerScoreMinute
    : 0;
  const allUnservedCap = inst.requests.length * p.unservedPenalty;

  const overhead = Number.isFinite(routeOverhead) ? routeOverhead : 0;
  // A plan that serves every servable order pays at least the spanning tree.
  const serveAll =
    fixedPenalty + (Number.isFinite(mst) ? mst : 0) + serveAllService + overhead;
  // A plan that drops one pays that order's penalty instead of its share.
  const dropSome = fixedPenalty + servePerOrder + extraIfDropping + overhead;
  const relaxed = Math.min(serveAll, dropSome);
  void minReturn;
  return {
    value: Math.max(0, Math.min(allUnservedCap, relaxed)),
    parts: { servePerOrder, routeOverhead, allUnservedCap },
  };
}

export type Certificate = {
  objective: number;
  lowerBound: number;
  /** (objective − bound) / bound, as a percentage; null when the bound is 0. */
  gapPct: number | null;
  /** True only if an exhaustive search ran and proved the optimum. */
  exactOptimum: number | null;
  exactGapPct: number | null;
};

export function certify(
  inst: Instance,
  matrix: Matrix,
  plan: Plan,
  exactOptimum: number | null = null,
): Certificate {
  const bound = lowerBound(inst, matrix).value;
  const objective = plan.objective.total;
  const pct = (a: number, b: number) => (b > 1e-9 ? ((a - b) / b) * 100 : null);
  return {
    objective,
    lowerBound: bound,
    gapPct: pct(objective, bound),
    exactOptimum,
    exactGapPct: exactOptimum == null ? null : pct(objective, exactOptimum),
  };
}
